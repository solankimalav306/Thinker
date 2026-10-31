"""Turns the pages of a PDF into passages worth searching.

A passage is a few whole sentences (about TARGET_WORDS words), overlapping the one before it, and it may run across a
page break: it remembers every page it touches. The heading it sits under travels with it. Text that repeats on every
page (running titles, page numbers) is dropped, and words split by a line-end hyphen are joined.

The reader sends each page's text with its line breaks when it can; text without any is handled too.
"""
import re

VERSION = 2            # bumped whenever the way passages are made or stored changes, so old indexes are rebuilt
TARGET_WORDS = 140
OVERLAP_WORDS = 35
MAX_SENTENCE_WORDS = 220
MIN_SECTION_WORDS = 40

_SENTENCE_END = re.compile(r"(?<=[.!?।。])\s+(?=\S)")
_ABBREVIATIONS = ("et al.", "e.g.", "i.e.", "fig.", "figs.", "eq.", "eqs.", "vs.", "no.", "dr.", "sec.", "cf.", "approx.", "etc.", "resp.", "vol.", "pp.", "p.", "mr.", "mrs.", "ms.", "prof.", "st.", "inc.", "ltd.", "co.")
_HEADING = re.compile(
    r"^(?:(?:\d+(?:\.\d+)*\.?|[A-Z]\.|[IVX]+\.)\s+\S.{1,90}|Appendix(?: [A-Z0-9]+)?(?:[.:]?\s.{0,80})?|"
    r"Abstract|Introduction|Conclusions?|References|Bibliography|Acknowledg\w+|Related Work|Background|Methods?|Methodology|Experiments?|Results|Discussion|Summary|Overview|Chapter\s+\d+.{0,80})$"
)


def _words(text):
    return len(text.split())


def _is_heading(line):
    line = line.strip()
    if not line or len(line.split()) > 12 or line[-1] in ".,;:" and not re.match(r"^\d", line):
        return False
    if not _HEADING.match(line):
        return False
    # a numbered line that reads like a sentence or a table row is not a heading
    if re.match(r"^\d+(?:\.\d+)*\.?\s", line) and (len(line.split()) > 10 or sum(c.isdigit() for c in line) > 8):
        return False
    return True


def _norm_line(line):
    return re.sub(r"\d+", "#", re.sub(r"\s+", " ", line.strip().lower()))


def _repeated_edges(page_lines):
    """Lines that open or close many pages (running titles, page numbers): their normalised text."""
    if len(page_lines) < 4:
        return set()
    seen = {}
    for lines in page_lines:
        edge = lines[:3] + lines[-3:]
        for key in {_norm_line(l) for l in edge if l.strip() and _words(l) <= 14}:
            seen[key] = seen.get(key, 0) + 1
    need = max(3, int(len(page_lines) * 0.35))
    return {k for k, v in seen.items() if v >= need}


def clean_pages(pages):
    """[(page number, [lines])] with running headers and footers removed and hyphenated line ends joined."""
    raw = []
    for p in pages:
        text = str(p.get("text") or "").replace("\r", "")
        raw.append((int(p.get("page") or len(raw) + 1), [l for l in text.split("\n") if l.strip()] if "\n" in text else [text] if text.strip() else []))
    repeated = _repeated_edges([lines for _, lines in raw])
    cleaned = []
    for number, lines in raw:
        out = []
        for i, line in enumerate(lines):
            edge = i < 3 or i >= len(lines) - 3
            key = _norm_line(line)
            if edge and (key in repeated or re.fullmatch(r"[-–— ]*(?:page )?#(?: of #)?[-–— ]*", key)):
                continue
            out.append(line.strip())
        cleaned.append((number, out))
    kept = sum(_words(l) for _, lines in cleaned for l in lines)
    total = sum(_words(l) for _, lines in raw for l in lines)
    if total and kept < total * 0.4:   # most of the text "repeats": this is not a running header, keep everything
        return [(number, [l.strip() for l in lines]) for number, lines in raw]
    return cleaned


def _split_sentences(paragraph):
    pieces = [s for s in _SENTENCE_END.split(paragraph) if s.strip()]
    merged = []
    for piece in pieces:
        if merged:
            tail = merged[-1].rstrip().lower()
            last = merged[-1].rstrip().split(" ")[-1] if merged[-1].strip() else ""
            if tail.endswith(_ABBREVIATIONS) or (len(last) <= 2 and last[:1].isupper() and last.endswith(".")):
                merged[-1] = f"{merged[-1]} {piece}"
                continue
        merged.append(piece)
    out = []
    for s in merged:
        w = s.split()
        if len(w) <= MAX_SENTENCE_WORDS:
            out.append(s)
        else:  # a run-on line (a table, an unpunctuated list): cut it into word windows
            out += [" ".join(w[i:i + TARGET_WORDS]) for i in range(0, len(w), TARGET_WORDS)]
    return out


def _sentences(pages):
    """[(sentence, page, heading)] in reading order."""
    out = []
    heading = ""
    for number, lines in pages:
        buf = []

        def flush():
            if buf:
                paragraph = re.sub(r"\s+", " ", " ".join(buf)).strip()
                buf.clear()
                out.extend((s, number, heading) for s in _split_sentences(paragraph))

        for line in lines:
            if _is_heading(line):
                flush()
                heading = line
                continue
            if buf and buf[-1].endswith("-") and line[:1].islower():
                buf[-1] = buf[-1][:-1] + line   # "retriev-" + "al" -> "retrieval"
            else:
                buf.append(line)
        flush()
    return out


def chunk_pages(pages, target=TARGET_WORDS, overlap=OVERLAP_WORDS):
    """Passages for a whole document: [{"text", "page", "pages", "heading", "chunk_id", "v"}]."""
    sents = _sentences(clean_pages(pages))
    chunks = []
    i = 0
    while i < len(sents):
        words = 0
        j = i
        cur = []
        broke = False
        while j < len(sents) and (words < target or not cur):
            if cur and sents[j][2] != cur[0][2] and words >= MIN_SECTION_WORDS:
                broke = True   # a new section starts here: this passage ends, and the next one does not reach back into this one
                break
            cur.append(sents[j])
            words += _words(sents[j][0])
            j += 1
        text = " ".join(s[0] for s in cur)
        page_list = sorted({s[1] for s in cur})
        chunk = {"text": text, "page": page_list[0], "pages": page_list, "heading": cur[0][2],
                 "chunk_id": f"{page_list[0]}_{len(chunks)}", "v": VERSION}
        if len(page_list) > 1:   # where each page begins inside the text, so a quotation can say which page it came from
            marks, offset, seen = [], 0, None
            for sentence, page, _ in cur:
                if page != seen:
                    marks.append([offset, page])
                    seen = page
                offset += len(sentence) + 1
            chunk["marks"] = marks
        chunks.append(chunk)
        if j >= len(sents):
            break
        if broke:
            i = j
            continue
        back = 0
        k = j
        while k - 1 > i and back < overlap:   # start the next one a little earlier, on a sentence boundary
            k -= 1
            back += _words(sents[k][0])
        i = k if k > i else j
    return chunks


def split_by_page(chunk):
    """[(page, text)]: a passage that runs across a page break, cut where the page changes."""
    marks = chunk.get("marks") or []
    text = chunk.get("text", "")
    if len(marks) < 2:
        return [(chunk.get("page", "?"), text)]
    out = []
    for n, (start, page) in enumerate(marks):
        end = marks[n + 1][0] if n + 1 < len(marks) else len(text)
        piece = text[start:end].strip()
        if piece:
            out.append((page, piece))
    return out


def embed_text(chunk):
    """What is embedded for a passage: the heading it sits under, then its words."""
    heading = chunk.get("heading") or ""
    return f"{heading}\n{chunk['text']}" if heading else chunk["text"]
