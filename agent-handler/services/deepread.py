"""Reading whole documents, part by part, for requests a search cannot answer ("answer all the questions in both books").

The documents' passages are grouped in order into parts of a few thousand words (kept to chapter boundaries where the
headings show them). Each part is read by the model on its own: it returns the key points and every exercise with an
answer, with page numbers. Their results are put together by plain code, not by another model call, so the length of
the output never depends on what one model reply can hold, and one more call looks for the pattern in the questions.
The work is spread over a few threads, paced to the provider: it starts quickly and slows down when a provider says
"too many requests" (a free key allows a few a minute), then speeds up again.
"""
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from db.metadata import load_metadata
from services.jobs import Cancelled
from utils.artifacts import build_reply, extract_json
from utils.chunking import split_by_page

MIN_PART_WORDS = 3500
MAX_PART_WORDS = 12000
MAX_PARTS = 40
SECTION_CHARS = 5600          # the document artifact holds 6000 characters in a section
WORKERS = int(os.environ.get("THINKER_DEEP_WORKERS", "3"))
START_RPM = float(os.environ.get("THINKER_DEEP_RPM", "24"))
_CHAPTER = re.compile(r"^(?:chapter\s+\d+|part\s+[ivx\d]+|\d{1,2}\s+\S.*|unit\s+\d+|lesson\s+\d+)", re.I)
_BUSY = re.compile(r"429|resource_exhausted|rate.?limit|quota|too many requests|503|unavailable|overloaded|timed? ?out|deadline", re.I)


# ---------------------------------------------------------------- planning the parts
def _words(text):
    return len(text.split())


def _strip_overlap(previous, current):
    """`current` without the opening words it shares with the end of `previous` (passages overlap)."""
    a, b = previous.split(), current.split()
    for n in range(min(90, len(a), len(b)), 4, -1):
        if a[-n:] == b[:n]:
            return " ".join(b[n:])
    return current


def passages_of(storage, pdf_id):
    path = os.path.join(storage, f"{pdf_id}.json")
    if not os.path.exists(path):
        return []
    return load_metadata(path)


def plan_parts(documents, target=None, max_parts=MAX_PARTS):
    """documents: [{"title", "pdfId", "chunks"}] -> (parts, words_total, words_planned).

    A part: {"doc", "pdfId", "first", "last", "text", "words", "heading", "number"} with "[p.N]" markers in the text.
    """
    prepared = []
    total = 0
    for d in documents:
        pieces = []
        previous = ""
        for chunk in d.get("chunks") or []:
            parts = split_by_page(chunk)
            if not parts:
                continue
            page, text = parts[0]
            text = _strip_overlap(previous, text) if previous else text
            previous = chunk.get("text", "")
            pieces.append((page, text, chunk.get("heading") or ""))
            pieces.extend((p, t, chunk.get("heading") or "") for p, t in parts[1:])
        total += sum(_words(t) for _, t, _ in pieces)
        prepared.append((d, pieces))
    if not total:
        return [], 0, 0
    size = target or max(MIN_PART_WORDS, min(MAX_PART_WORDS, int(total / max_parts * 1.05)))

    def group(size):
        parts = []
        for d, pieces in prepared:
            cur, words, heading = [], 0, ""

            def close():
                nonlocal cur, words, heading
                if cur:
                    text = "\n".join(f"[p.{p}] {t}" for p, t, _ in cur)
                    parts.append({"doc": d["title"], "pdfId": d.get("pdfId", ""), "first": cur[0][0], "last": cur[-1][0], "text": text, "words": words, "heading": heading})
                cur, words, heading = [], 0, ""

            last_heading = None
            for page, text, head in pieces:
                w = _words(text)
                new_chapter = bool(head) and head != last_heading and bool(_CHAPTER.match(head.strip()))
                if cur and ((words + w > size and words >= size * 0.5) or (new_chapter and words >= size * 0.6)):
                    close()
                if not cur:
                    heading = head
                cur.append((page, text, head))
                words += w
                last_heading = head or last_heading
            close()
        return parts

    parts = group(size)
    # Too many parts for the budget: make the parts bigger so that all of the text is still read; only when
    # that would make them too big for one reading are parts sampled instead.
    while not target and len(parts) > max_parts and size < MAX_PART_WORDS * 1.6:
        size = int(size * 1.2)
        parts = group(size)

    planned = sum(p["words"] for p in parts)
    if len(parts) > max_parts:   # more than the budget: read parts spread evenly through the documents
        step = len(parts) / max_parts
        parts = [parts[int(i * step)] for i in range(max_parts)]
        planned = sum(p["words"] for p in parts)
    for i, p in enumerate(parts, 1):
        p["number"] = i
    return parts, total, planned


# ---------------------------------------------------------------- pacing
class Limiter:
    """Starts at START_RPM calls a minute, halves when a provider pushes back, speeds up again while calls succeed."""

    def __init__(self, rpm=None):
        self.rate = float(rpm or START_RPM)
        self.lock = threading.Lock()
        self.next = 0.0
        self.good = 0

    def wait(self, job):
        with self.lock:
            now = time.time()
            start = max(now, self.next)
            self.next = start + 60.0 / self.rate
        while True:
            job.check()
            left = start - time.time()
            if left <= 0:
                return
            time.sleep(min(0.5, left))

    def slow_down(self):
        with self.lock:
            self.rate = max(5.0, self.rate * 0.5)
            self.good = 0

    def success(self):
        with self.lock:
            self.good += 1
            if self.good % 8 == 0:
                self.rate = min(60.0, self.rate * 1.25)


def _retry_seconds(message):
    found = re.search(r"retry(?:ing)? (?:in|after)\s*([\d.]+)\s*s", str(message), re.I)
    return float(found.group(1)) + 1 if found else 15.0


def ask(call, prompt, node, job, limiter, tries=6):
    """One model call, paced and retried when the provider is busy."""
    for attempt in range(tries):
        limiter.wait(job)
        try:
            reply = call(prompt, node)
            limiter.success()
            return reply
        except Cancelled:
            raise
        except Exception as error:
            if attempt == tries - 1 or not _BUSY.search(str(error)):
                raise
            limiter.slow_down()
            pause = min(_retry_seconds(error), 60.0)
            end = time.time() + pause
            while time.time() < end:
                job.check()
                time.sleep(0.5)
    raise RuntimeError("The AI service stayed busy.")


# ---------------------------------------------------------------- reading one part
MAP_PROMPT = """You are reading part {number} of {count} of "{doc}" (pages {first} to {last}). A marker like [p.12] shows where a page starts.
The person asked: "{request}"
Use only this part of the text. Return JSON only, no other words:
{{"section": "a short title for this part", "notes": [{{"t": "one key idea in 25 words or fewer", "p": 12}}], "questions": [{{"q": "the question or exercise worded as the book words it, with its number if it has one", "a": "a correct, concise answer or solution", "p": 12, "ai": false}}]}}
Rules:
{rules}
- "p" is the page marker the item is under.
TEXT:
{text}"""

NOTES_RULE = "- notes: at most 8 key ideas worth revising, each short and specific (a definition, a rule, a formula in words, a distinction)."
NO_NOTES_RULE = '- notes: return [].'
QUESTIONS_RULE = ('- questions: every question, exercise, problem or review question the text puts to the reader (not rhetorical questions inside an explanation). '
                  'If the text gives the answer, use it and set "ai": false; otherwise work it out yourself and set "ai": true. '
                  'Keep each answer under 80 words; for programming exercises, say in words what the code or approach is. If there are none, return [].')
NO_QUESTIONS_RULE = '- questions: return [].'


def _clean(items, keys, limit):
    out = []
    for it in items if isinstance(items, list) else []:
        if isinstance(it, str):
            it = {keys[0]: it}
        if isinstance(it, dict) and str(it.get(keys[0]) or "").strip():
            out.append(it)
    return out[:limit]


def read_part(part, count, request, want, call, job, limiter):
    prompt = MAP_PROMPT.format(
        number=part["number"], count=count, doc=part["doc"], first=part["first"], last=part["last"], request=str(request)[:300],
        rules="\n".join([NOTES_RULE if want["notes"] else NO_NOTES_RULE, QUESTIONS_RULE if want["questions"] else NO_QUESTIONS_RULE]),
        text=part["text"])
    last_error = ""
    for attempt in range(2):
        reply = ask(call, prompt if attempt == 0 else prompt + "\n\nYour last reply was not valid JSON. Return only the JSON object.", "deep_read", job, limiter)
        try:
            data = extract_json(reply)
        except ValueError as error:
            last_error = str(error)
            continue
        return {"section": str(data.get("section") or "").strip()[:120],
                "notes": _clean(data.get("notes"), ["t"], 12),
                "questions": _clean(data.get("questions"), ["q"], 40)}
    raise ValueError(last_error or "unreadable reply")


# ---------------------------------------------------------------- the pattern in the questions
PATTERN_PROMPT = """Below are {n} questions and exercises collected from {docs}. Each line: Q number | document | section | question (shortened).
Study them for a student who must prepare. Return JSON only:
{{"summary": "3 to 4 sentences: what the questions emphasise and how they are worded", "patterns": [{{"name": "short name", "description": "what this kind of question asks for and how to approach it", "count": 12, "examples": [3, 17]}}], "difficulty": "one sentence on how difficulty changes through the material", "tips": ["a short study tip"]}}
At most 7 patterns, 5 tips. "count" is how many of these questions fit; "examples" are Q numbers from the list.
{lines}"""


def analyse_questions(questions, docs, call, job, limiter):
    if len(questions) < 3:
        return None
    pick = questions
    if len(pick) > 320:
        step = len(pick) / 320
        pick = [pick[int(i * step)] for i in range(320)]
    lines = "\n".join(f"{q['n']} | {q['doc']} | {q['section'][:40]} | {q['q'][:150]}" for q in pick)
    prompt = PATTERN_PROMPT.format(n=len(questions), docs=" and ".join(docs), lines=lines)
    try:
        return extract_json(ask(call, prompt, "deep_pattern", job, limiter))
    except Cancelled:
        raise
    except Exception as error:
        print(f"[deepread] pattern analysis failed: {error}", flush=True)
        return None


# ---------------------------------------------------------------- putting it together
def _page_range(first, last):
    return f"p. {first}" if first == last else f"pp. {first}–{last}"


def _split_text(text, limit=SECTION_CHARS):
    """The text in pieces of at most `limit` characters, cut between paragraphs."""
    blocks, pieces, cur = text.split("\n\n"), [], ""
    for b in blocks:
        if cur and len(cur) + len(b) + 2 > limit:
            pieces.append(cur)
            cur = ""
        cur = f"{cur}\n\n{b}" if cur else b
    if cur:
        pieces.append(cur)
    return [p[:6000] for p in pieces]


def assemble(parts, results, failed, analysis, request, total_words, planned_words):
    """The sections of the document artifact, the cited pages, and counts."""
    sections, sources, seen = [], [], set()
    questions = []

    def cite_page(doc, page):
        try:
            page = int(page)
        except (TypeError, ValueError):
            return None
        if (doc, page) not in seen:
            seen.add((doc, page))
            sources.append({"doc": doc, "page": page})
        return page

    body = []
    n_notes = n_ai = 0
    for part in parts:
        res = results.get(part["number"])
        if not res:
            continue
        doc = part["doc"]
        cite_page(doc, part["first"])
        blocks = []
        if res["notes"]:
            blocks.append("**Key points**")
            lines = []
            for it in res["notes"]:
                page = cite_page(doc, it.get("p"))
                lines.append(f"- {str(it['t']).strip()}" + (f" (p. {page})" if page else ""))
            blocks.append("\n".join(lines))
            n_notes += len(res["notes"])
        if res["questions"]:
            blocks.append("**Questions and answers**")
            for it in res["questions"]:
                n = len(questions) + 1
                page = cite_page(doc, it.get("p"))
                ai = bool(it.get("ai"))
                n_ai += ai
                questions.append({"n": n, "doc": doc, "section": res["section"], "q": str(it["q"]).strip()})
                answer = str(it.get("a") or "").strip() or "No answer was given."
                blocks.append(f"**Q{n}.** {questions[-1]['q']}\n**Answer:** {answer}" + (f" (p. {page})" if page else "") + (" *(worked out by the AI; the book does not give it)*" if ai else ""))
        if not blocks:
            continue
        heading = f"{doc} · {res['section'] or part['heading'] or 'Part ' + str(part['number'])} ({_page_range(part['first'], part['last'])})"
        for i, piece in enumerate(_split_text("\n\n".join(blocks))):
            body.append({"heading": heading if i == 0 else f"{heading} (continued)", "text": piece, "cite": f"{doc}|{part['first']}"})

    covered = sum(p["words"] for p in parts if p["number"] in results)
    coverage = round(100 * covered / total_words) if total_words else 0
    docs = sorted({p["doc"] for p in parts})
    overview = [f"Read {len(results)} of {len(parts)} parts of {' and '.join(docs)}, about {coverage}% of the text.",
                f"Collected {n_notes} key points and {len(questions)} questions with answers" + (f"; {n_ai} answers were worked out by the AI because the book does not give them." if n_ai else ".")]
    if planned_words < total_words:
        overview.append(f"The material was longer than one request can read in full, so parts were sampled evenly through it ({round(100 * planned_words / total_words)}% planned).")
    if failed:
        overview.append("Parts that could not be read: " + "; ".join(f"{p['doc']} {_page_range(p['first'], p['last'])}" for p in failed) + ".")
    sections.append({"heading": "Overview", "text": "\n\n".join(overview), "cite": ""})

    if analysis:
        text = []
        if analysis.get("summary"):
            text.append(str(analysis["summary"]).strip())
        pats = [p for p in analysis.get("patterns") or [] if isinstance(p, dict) and p.get("name")]
        if pats:
            lines = []
            for p in pats[:7]:
                ex = ", ".join(f"Q{e}" for e in (p.get("examples") or [])[:5] if str(e).isdigit())
                lines.append(f"- **{str(p['name']).strip()}** ({p.get('count', '?')} questions): {str(p.get('description') or '').strip()}" + (f" For example {ex}." if ex else ""))
            text.append("**Patterns**\n" + "\n".join(lines))
        if analysis.get("difficulty"):
            text.append(f"**Difficulty.** {str(analysis['difficulty']).strip()}")
        tips = [str(t).strip() for t in analysis.get("tips") or [] if str(t).strip()]
        if tips:
            text.append("**How to prepare**\n" + "\n".join(f"- {t}" for t in tips[:5]))
        if text:
            sections.append({"heading": "Pattern of the questions", "text": "\n\n".join(text)[:6000], "cite": ""})
    per = {}
    for q in questions:
        per.setdefault(q["doc"], {}).setdefault(q["section"] or "Other", 0)
        per[q["doc"]][q["section"] or "Other"] += 1
    if per:
        lines = [f"- **{doc}**: {sum(v.values())} questions. " + "; ".join(f"{s} ({c})" for s, c in v.items()) for doc, v in per.items()]
        sections.append({"heading": "Questions per part", "text": "\n".join(lines)[:6000], "cite": ""})
    sections.extend(body)
    return sections[:150], sources, {"questions": len(questions), "notes": n_notes, "coverage": coverage, "parts_read": len(results), "parts": len(parts), "ai_answers": n_ai}


def as_markdown(title, sections):
    out = [f"# {title}"]
    for s in sections:
        out.append(f"## {s['heading']}\n\n{s['text']}")
    return "\n\n".join(out)


# ---------------------------------------------------------------- the whole job
def run(documents, request, want, call, job, as_artifact=True, title=""):
    """documents: [{"title", "pdfId", "chunks"}]. Returns {"text", "sources", "stats"}."""
    job.update(label="Planning", done=0, total=0)
    parts, total_words, planned = plan_parts(documents)
    if not parts:
        raise ValueError("These documents have no text to read yet. Open them once so they can be prepared, then try again.")
    job.update(label=f"Reading part 1 of {len(parts)}", done=0, total=len(parts) + 2)
    limiter = Limiter()
    results, failed = {}, []
    lock = threading.Lock()

    def work(part):
        job.check()
        job.update(label=f"Reading {part['doc']}, {_page_range(part['first'], part['last'])} (part {part['number']} of {len(parts)})")
        try:
            res = read_part(part, len(parts), request, want, call, job, limiter)
            with lock:
                results[part["number"]] = res
        except Cancelled:
            raise
        except Exception as error:
            print(f"[deepread] part {part['number']} failed: {error}", flush=True)
            with lock:
                failed.append(part)
        with lock:
            job.done += 1

    with ThreadPoolExecutor(max_workers=max(1, WORKERS)) as pool:
        for future in [pool.submit(work, p) for p in parts]:
            future.result()
    job.check()
    if not results:
        raise ValueError("None of the parts could be read. The AI service may be busy or out of quota; please try again in a few minutes.")

    flat = []
    for part in parts:
        res = results.get(part["number"])
        for it in (res or {}).get("questions", []):
            flat.append({"n": len(flat) + 1, "doc": part["doc"], "section": res["section"], "q": str(it["q"]).strip()})
    analysis = None
    if want.get("pattern") and flat:
        job.update(label="Looking for patterns in the questions")
        analysis = analyse_questions(flat, sorted({p["doc"] for p in parts}), call, job, limiter)
    job.update(label="Putting it together", done=len(parts) + 1)
    sections, sources, stats = assemble(parts, results, sorted(failed, key=lambda p: p["number"]), analysis, request, total_words, planned)
    docs = sorted({p["doc"] for p in parts})
    title = (title or f"Notes and answers: {' and '.join(docs)}")[:80]
    intro = f"Here is the whole of {' and '.join(docs)}, read part by part: {stats['notes']} key points and {stats['questions']} questions with answers, about {stats['coverage']}% of the text."
    if as_artifact:
        text = build_reply(intro, title, "document", {"sections": sections})
    else:
        text = f"{intro}\n\n{as_markdown(title, sections)}"
    job.update(label="Done", done=job.total)
    return {"text": text, "sources": sources, "stats": stats}
