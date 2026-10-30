"""Artifacts: deciding that one is wanted, which kind, and making it.

An artifact is an interactive or visual document made from the document(s): a checklist, a quiz, a diagram and so on.
The kinds are a small fixed list. For most of them the model does not write a page: it writes small data (a list of
tasks, the questions of a quiz) in a format that is checked here and again in the app, and the app draws and runs it.
That is cheaper to produce, always looks right, and needs no code from the model.

The work is its own path through the agent, so an ordinary question never carries any of this in its prompt.
"""

import json
import re

# kind -> (label, what it is for). "live" kinds are made of data; the others are written as a page.
KINDS = {
    "checklist": ("Checklist", "things to do, with progress", True),
    "steps": ("Steps", "a plan or guide to follow, one step at a time", True),
    "quiz": ("Quiz", "questions with answers and a score", True),
    "flashcards": ("Flashcards", "cards to flip and review", True),
    "table": ("Table", "rows and columns that can be sorted", True),
    "chart": ("Chart", "a bar, line or pie chart of numbers from the document", True),
    "diagram": ("Diagram", "a flowchart or a mind map", True),
    "timeline": ("Timeline", "events in order", True),
    "document": ("Document", "a written report or summary", True),
    "slides": ("Slides", "a slide deck", False),
    "page": ("Web page", "any page: a calculator, a game, anything else", False),
}
LIVE = {k for k, v in KINDS.items() if v[2]}

# ---- deciding ---------------------------------------------------------------------------------------------------

# Asking for an artifact by name always gets one.
_EXPLICIT = re.compile(r"\b(artifacts?|web ?pages?|html)\b", re.I)
# Asking to be given something made.
_VERB = re.compile(r"\b(make|create|build|generate|give|show|draw|write|prepare|produce|turn|put|design|need|want|can you|could you|please|quiz me|test me)\b", re.I)

# Words that name a kind, in the order they win. A document or report alone is not a request for an artifact
# (that is a summary, or notes); it only counts when the person also says "artifact".
_KIND_WORDS = [
    ("quiz", r"\b(quiz|quizzes|test me|mcqs?|multiple[- ]choice|practice (?:questions|test)|exam questions)\b"),
    ("flashcards", r"\b(flash ?cards?|revision cards?|memori[sz]e)\b"),
    ("slides", r"\b(slides?|slide ?deck|presentation|powerpoint)\b"),
    ("page", r"\b(web ?pages?|html|calculator|simulat(?:or|ion)|mini[- ]?game|interactive (?:page|tool|demo))\b"),
    ("timeline", r"\b(timelines?|deadlines?|milestones?|chronolog\w*|schedule)\b"),
    ("diagram", r"\b(diagrams?|flow ?charts?|workflow|process map|architecture|mind ?maps?|concept map)\b"),
    ("chart", r"\b(charts?|graphs?|plots?|bar chart|pie chart|line chart)\b"),
    ("table", r"\b(tables?|comparison|matrix)\b"),
    ("steps", r"\b(steps?|step[- ]by[- ]step|walk ?through|roadmap|procedure|instructions|how to|plan)\b"),
    ("checklist", r"\b(check ?lists?|to[- ]?do|todo|task list|tasks|things to do|(?:what|everything) (?:i|we|you) (?:have|has|need|must|should) to do|requirements?)\b"),
    ("document", r"\b(one[- ]page(?:r)?|cheat ?sheet|study guide|write-?up|report|essay|summary document|document)\b"),
]
_KIND_RE = [(kind, re.compile(pattern, re.I)) for kind, pattern in _KIND_WORDS]
# kinds a person may ask for plainly, without saying "artifact"; the vaguer ones need the word
_NEEDS_THE_WORD = {"document", "steps", "checklist", "table", "page"}
# but these read as unmistakable when put with a verb of making
_PLAIN_WITH_VERB = {"steps": r"\b(step[- ]by[- ]step|walk ?through|roadmap|study plan|plan of|action plan)\b", "checklist": r"\b(check ?lists?|to-do|todo|task list)\b",
                    "table": r"\b(tables?|comparison table)\b", "document": r"\b(one[- ]page(?:r)?|cheat ?sheet)\b"}
_PLAIN_RE = {k: re.compile(v, re.I) for k, v in _PLAIN_WITH_VERB.items()}


def identify(query):
    """What the words say: {"kind": a kind or None, "explicit": said "artifact", "plain": names a kind outright, "verb": asks for something made}."""
    text = str(query or "")
    named = [name for name, pattern in _KIND_RE if pattern.search(text)]

    def outright(name):
        return name not in _NEEDS_THE_WORD or bool(_PLAIN_RE.get(name) and _PLAIN_RE[name].search(text))

    plain_kind = next((name for name in named if outright(name)), None)
    kind = plain_kind or (named[0] if named else None)
    return {"kind": kind, "explicit": bool(_EXPLICIT.search(text)), "plain": bool(plain_kind), "verb": bool(_VERB.search(text))}


# routes that make something other than a chat answer
_OTHER_ROUTES = {"ask", "note", "highlight", "comment", "define", "search"}


def decide(intent, query, enabled, llm_kind=None):
    """(route, kind): "artifact" and its kind when one is wanted, otherwise the route unchanged.

    Saying "artifact" always gets one. Naming a kind and asking for it to be made gets one too, ahead of notes,
    highlights, definitions and web search. A mind map keeps its own mind map unless the word "artifact" is used.
    """
    if not enabled:
        return intent, None
    found = identify(query)
    kind = found["kind"]
    if llm_kind not in KINDS:
        llm_kind = None
    if found["explicit"]:
        return "artifact", kind or llm_kind or "document"
    if intent == "mindmap":
        return intent, None
    if kind and found["verb"] and found["plain"] and intent in _OTHER_ROUTES:
        return "artifact", kind
    if llm_kind and found["verb"] and intent in _OTHER_ROUTES:
        return "artifact", llm_kind
    return intent, None


# ---- the instructions for each kind ---------------------------------------------------------------------------------

_COMMON = """You are making ONE artifact: {label} ({hint}), from the document context below.
Use only what the context says. If something the person needs is not in it, say so in one line inside the artifact. Do not invent facts, numbers, dates or page numbers.
Reply with ONE short plain sentence, then the artifact exactly like this:
<artifact title="A short title" type="{kind}">
{shape}
</artifact>
Inside the artifact write ONLY valid JSON of that shape: no markdown fences, no comments, no extra keys. Keep the text short and concrete.
Write maths as LaTeX between dollar signs, like $x^2$. Text may use **bold**, *italic* and `code`.
"cite" is optional. When a passage in the context supports an item, set "cite" to "Exact document title|page number" using the label of that passage; otherwise leave it out."""

_SHAPES = {
    "checklist": ('{"groups":[{"title":"","items":[{"text":"","note":"","cite":""}]}]}',
                  "Group the tasks when there are several phases (use one group with an empty title otherwise). Each task is one action, starting with a verb. At most 25 tasks."),
    "steps": ('{"intro":"","steps":[{"title":"","detail":"","due":"","cite":""}]}',
              "Steps in the order to do them. Title is the action; detail says how and what counts as done. Put a date or time in \"due\" only when the context gives one. At most 15 steps."),
    "quiz": ('{"questions":[{"q":"","options":["",""],"answer":0,"why":"","cite":""}]}',
             "5 to 10 questions that test understanding of the context. 3 or 4 options each, one correct; \"answer\" is the position of the correct option, starting at 0. \"why\" explains the answer in one sentence."),
    "flashcards": ('{"cards":[{"front":"","back":"","cite":""}]}',
                   "8 to 20 cards: a term, question or prompt on the front; a short answer on the back."),
    "table": ('{"caption":"","columns":[""],"rows":[["",""]]}',
              "Every row has one value per column. Columns are the things being compared; keep cells short. At most 8 columns."),
    "chart": ('{"kind":"bar","labels":[""],"series":[{"name":"","values":[0]}],"unit":"","caption":""}',
              "\"kind\" is bar, line or pie. Use ONLY numbers that appear in the context; if there are none, make a table instead. One value per label per series."),
    "diagram": ('{"kind":"flow","direction":"LR","nodes":[{"id":"a","label":"","detail":"","group":""}],"edges":[{"from":"a","to":"b","label":""}]}',
                "\"kind\" is flow (a process, with arrows) or mindmap (the first node is the centre, edges join it to its branches). Ids are short and unique. Labels are 1 to 5 words; put the explanation in \"detail\". At most 20 nodes."),
    "timeline": ('{"events":[{"when":"","title":"","detail":"","cite":""}]}',
                 "Events in time order. \"when\" is the date or period exactly as the context gives it."),
    "document": ('{"sections":[{"heading":"","text":"","cite":""}]}',
                 "A well organised written document. Each section has a heading and one or more paragraphs (separate paragraphs with a blank line; bullets start with \"- \")."),
}

_HTML_RULES = """You are making ONE artifact: {label} ({hint}), written as HTML, from the document context below.
Use only what the context says; do not invent facts or numbers.
Reply with ONE short plain sentence, then exactly one block:
<artifact title="A short title" type="{kind}">
...HTML...
</artifact>
Rules for the HTML: plain HTML plus an optional <style> block; no <script>, no forms, no external files or links. Inline <svg> is fine.
Prefer these ready-made classes (they match the app's look and theme): tk-card, tk-grid (tk-cols-2, tk-cols-3), tk-table, tk-badge (tk-good, tk-warn, tk-bad, tk-info), tk-callout, tk-stat, tk-chips, tk-bar (width set with style="--v:70%").
{extra}
Cite sources only as <a class="tk-cite" data-cite="Exact document title|page number">label</a>, and only for passages in the context. Write maths as LaTeX between dollar signs. Keep it under about 1,000 words."""

_HTML_EXTRA = {
    "slides": "Make 4 to 10 slides. Each slide is <section class=\"tk-slide\"> holding one <h2> and at most five short points.",
    "page": "Make it a clear, self-contained page that serves the request.",
}


def prompt_for(kind, doc_title=""):
    """The instructions that go with the question when making an artifact of this kind. Only this kind's shape is included."""
    label, hint, live = KINDS.get(kind, KINDS["document"])
    if not live:
        text = _HTML_RULES.format(label=label, hint=hint, kind=kind, extra=_HTML_EXTRA.get(kind, ""))
    else:
        shape, notes = _SHAPES[kind]
        text = _COMMON.format(label=label, hint=hint, kind=kind, shape=shape) + "\n" + notes
    if doc_title:
        text += f'\nThe only document is titled "{doc_title}", so cite as "{doc_title}|page number".'
    return text


def schema_hint(kind):
    return _SHAPES[kind][0] if kind in _SHAPES else ""


# ---- checking what came back ------------------------------------------------------------------------------------------

_BLOCK = re.compile(r"<artifact\b([^>]*)>(.*?)(?:</artifact>|$)", re.I | re.S)
_TITLE = re.compile(r"""\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)


def split_reply(text):
    """(sentence before, title, body) of the artifact block in a reply, or None when there is none."""
    text = str(text or "")
    text = re.sub(r"```(?:html|json)?\s*(<artifact\b)", r"\1", text, flags=re.I)
    text = re.sub(r"(</artifact>)\s*```", r"\1", text, flags=re.I)
    m = _BLOCK.search(text)
    if not m:
        return None
    t = _TITLE.search(m.group(1))
    return text[: m.start()].strip(), (t.group(1) or t.group(2) or "").strip() if t else "", m.group(2).strip()


def extract_json(body):
    body = str(body or "").strip()
    body = re.sub(r"^```(?:json)?\s*", "", body, flags=re.I)
    body = re.sub(r"\s*```$", "", body)
    start, end = body.find("{"), body.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("No data was found.")
    try:
        return json.loads(body[start : end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"The data could not be read ({e.msg}).")


def _s(v, limit=1200):
    return "" if v is None or isinstance(v, (dict, list)) else str(v).strip()[:limit]


def _items(v, limit):
    return v[:limit] if isinstance(v, list) else []


def validate(kind, data):
    """A cleaned copy of the data, or ValueError saying what is wrong (the message is fed back to the model to repair it)."""
    if not isinstance(data, dict):
        raise ValueError("The data must be an object.")
    if kind == "checklist":
        src = data.get("groups") if isinstance(data.get("groups"), list) else [{"title": "", "items": data.get("items")}]
        groups = []
        for g in _items(src, 12):
            items = []
            for it in _items(g.get("items") if isinstance(g, dict) else None, 80):
                if isinstance(it, str):
                    it = {"text": it}
                text = _s(it.get("text") or it.get("title")) if isinstance(it, dict) else ""
                if text:
                    items.append({"text": text, "note": _s(it.get("note")), "cite": _s(it.get("cite"), 200)})
            if items:
                groups.append({"title": _s(g.get("title"), 160), "items": items})
        if not groups:
            raise ValueError('Provide "groups", each with "items" that have "text".')
        return {"groups": groups}
    if kind == "steps":
        out = []
        for s in _items(data.get("steps") or data.get("items"), 80):
            if isinstance(s, str):
                s = {"title": s}
            title = _s(s.get("title") or s.get("text"), 160) if isinstance(s, dict) else ""
            if title:
                out.append({"title": title, "detail": _s(s.get("detail"), 6000), "due": _s(s.get("due"), 60), "cite": _s(s.get("cite"), 200)})
        if not out:
            raise ValueError('Provide "steps", each with a "title".')
        return {"intro": _s(data.get("intro")), "steps": out}
    if kind == "quiz":
        out = []
        for q in _items(data.get("questions") or data.get("items"), 40):
            if not isinstance(q, dict):
                continue
            text = _s(q.get("q") or q.get("question"))
            options = [_s(o, 400) for o in _items(q.get("options"), 6) if _s(o, 400)]
            answer = q.get("answer")
            if isinstance(answer, bool):
                options = options if len(options) >= 2 else ["True", "False"]
                answer = 0 if answer else 1
            try:
                answer = int(answer)
            except (TypeError, ValueError):
                continue
            if text and len(options) >= 2 and 0 <= answer < len(options):
                out.append({"q": text, "options": options, "answer": answer, "why": _s(q.get("why")), "cite": _s(q.get("cite"), 200)})
        if not out:
            raise ValueError('Provide "questions", each with "q", at least two "options" and "answer" as the position (from 0) of the correct option.')
        return {"questions": out}
    if kind == "flashcards":
        out = [{"front": _s(c.get("front")), "back": _s(c.get("back"), 6000), "cite": _s(c.get("cite"), 200)}
               for c in _items(data.get("cards") or data.get("items"), 100) if isinstance(c, dict) and _s(c.get("front")) and _s(c.get("back"))]
        if not out:
            raise ValueError('Provide "cards", each with "front" and "back".')
        return {"cards": out}
    if kind == "table":
        columns = [_s(c, 120) for c in _items(data.get("columns") or data.get("headers"), 12)]
        rows = []
        for r in _items(data.get("rows"), 200):
            if isinstance(r, list):
                rows.append([_s(r[i], 600) if i < len(r) else "" for i in range(len(columns))])
        if not columns or not rows:
            raise ValueError('Provide "columns" and "rows" (each row a list with one value per column).')
        return {"caption": _s(data.get("caption")), "columns": columns, "rows": rows}
    if kind == "chart":
        labels = [_s(x, 60) for x in _items(data.get("labels"), 60)]
        series = []
        for s in _items(data.get("series"), 6):
            if not isinstance(s, dict):
                continue
            values = []
            for v in _items(s.get("values"), 60):
                try:
                    values.append(float(v))
                except (TypeError, ValueError):
                    values.append(None)
            if any(v is not None for v in values):
                series.append({"name": _s(s.get("name"), 60), "values": values})
        if not series:
            raise ValueError('Provide "series", each with "values" that are numbers.')
        kind_name = data.get("kind") if data.get("kind") in ("bar", "line", "pie") else "bar"
        return {"kind": kind_name, "labels": labels, "series": series, "unit": _s(data.get("unit"), 20), "caption": _s(data.get("caption"))}
    if kind == "diagram":
        nodes, seen = [], set()
        for i, n in enumerate(_items(data.get("nodes"), 60)):
            if isinstance(n, str):
                n = {"label": n}
            if not isinstance(n, dict):
                continue
            nid = re.sub(r"[^\w.-]", "", _s(n.get("id"), 40)) or f"n{i + 1}"
            label = _s(n.get("label") or n.get("title"), 120)
            if label and nid not in seen:
                seen.add(nid)
                nodes.append({"id": nid, "label": label, "detail": _s(n.get("detail"), 400), "group": _s(n.get("group"), 30)})
        edges = []
        for e in _items(data.get("edges"), 120):
            if isinstance(e, dict) and e.get("from") in seen and e.get("to") in seen and e.get("from") != e.get("to"):
                edges.append({"from": e["from"], "to": e["to"], "label": _s(e.get("label"), 60)})
        if len(nodes) < 2:
            raise ValueError('Provide at least two "nodes" (each with "id" and "label") and "edges" that join their ids.')
        return {"kind": "mindmap" if data.get("kind") == "mindmap" else "flow", "direction": "TB" if data.get("direction") == "TB" else "LR", "nodes": nodes, "edges": edges}
    if kind == "timeline":
        out = [{"when": _s(e.get("when") or e.get("date"), 80), "title": _s(e.get("title"), 160), "detail": _s(e.get("detail")), "cite": _s(e.get("cite"), 200)}
               for e in _items(data.get("events") or data.get("items"), 80) if isinstance(e, dict) and _s(e.get("title"), 160)]
        if not out:
            raise ValueError('Provide "events", each with "when" and "title".')
        return {"events": out}
    if kind == "document":
        out = []
        for s in _items(data.get("sections"), 50):
            if isinstance(s, str):
                s = {"text": s}
            if isinstance(s, dict) and (_s(s.get("text"), 6000) or _s(s.get("heading"))):
                out.append({"heading": _s(s.get("heading"), 160), "text": _s(s.get("text"), 6000), "cite": _s(s.get("cite"), 200)})
        if not out:
            raise ValueError('Provide "sections", each with "heading" and "text".')
        return {"sections": out}
    raise ValueError("That kind is written as a page.")


def build_reply(intro, title, kind, spec):
    """The reply text the app reads: a sentence, then the artifact block holding the data."""
    # the data sits in a tag, so nothing in it may be able to close the tag
    body = json.dumps(spec, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    safe_title = re.sub(r'["<>&\n]', " ", title or KINDS[kind][0]).strip()[:80]
    sentence = intro.strip() or f"Here is your {KINDS[kind][0].lower()}."
    return f'{sentence}\n<artifact title="{safe_title}" type="{kind}">{body}</artifact>'


def finalize(kind, reply, repair=None):
    """Turn the model's reply into the text the app shows.

    A kind made of data is parsed and checked; if it is not right, `repair(bad_text, message)` is asked once for a fixed
    version. When it still is not usable the person gets the model's words as plain text instead of a broken card.
    """
    reply = str(reply or "")
    if kind not in LIVE:
        return reply
    parts = split_reply(reply)
    intro, title, body = parts if parts else (reply.strip(), "", reply)
    for attempt in (0, 1):
        try:
            spec = validate(kind, extract_json(body))
            return build_reply(intro, title, kind, spec)
        except ValueError as problem:
            if attempt == 0 and repair is not None:
                fixed = repair(body, str(problem))
                if fixed:
                    again = split_reply(fixed)
                    body = again[2] if again else fixed
                    continue
            break
    # not usable: say what we have as words
    return re.sub(r"</?artifact[^>]*>", "", reply).strip() or "I could not make that. Please try asking again."
