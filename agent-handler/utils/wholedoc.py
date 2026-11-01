"""Telling a request about a whole document or book from an ordinary question.

"Answer all the questions in both textbooks", "notes for every chapter", "summarise the whole book" cannot be answered from
the handful of passages a search returns: they need the document read from start to finish. Questions about one page, one
paragraph or the text the person has selected are not those.
"""
import re

_ALL = r"(?:all|every|each|entire|whole|complete|full|every single)"
_THINGS = r"(?:questions?|exercises?|problems?|chapters?|sections?|topics?|units?|lessons?|examples?|definitions?|formulas?|theorems?|concepts?|terms)"
_BOOKS = r"(?:books?|textbooks?|documents?|pdfs?|papers?|files?|syllabus|course|module|notes)"

# "all the questions", "every chapter", "each of the exercises"
_ALL_THINGS = re.compile(rf"\b{_ALL}\s+(?:of\s+)?(?:the\s+|these\s+|those\s+|my\s+|its\s+|their\s+)?(?:\w+\s+){{0,2}}?{_THINGS}\b", re.I)
# "the whole book", "entire textbook", "both books", "cover to cover", "chapter by chapter"
_WHOLE_BOOK = re.compile(rf"\b(?:{_ALL}\s+(?:of\s+)?(?:the\s+|this\s+|that\s+|both\s+|these\s+)?{_BOOKS}|both\s+(?:the\s+)?{_BOOKS}|cover\s+to\s+cover|chapter[- ]by[- ]chapter|page[- ]by[- ]page|from\s+start\s+to\s+(?:end|finish))\b", re.I)
# something the person wants made or done with it
_WORK = re.compile(r"\b(answer|solve|work\s+out|summari[sz]e|notes?|analy[sz]e|analysis|pattern|list|extract|collect|compile|make|create|prepare|give|write|go\s+through|study|revise|cover|explain)\b", re.I)
# a narrower scope than the document
_NARROW = re.compile(r"\b(this|that|the\s+selected|selected|current|above|following)\s+(page|paragraph|section|passage|sentence|line|slide|figure|table|text|part)\b|\bon\s+page\s+\d+|\bpages?\s+\d+", re.I)


def wants_whole_document(query, has_selection=False, pages_named=False):
    """True when the request needs the whole of the document(s) read, not just the best few passages."""
    text = str(query or "")
    if has_selection or pages_named or _NARROW.search(text):
        return False
    if not _WORK.search(text):
        return False
    return bool(_ALL_THINGS.search(text) or _WHOLE_BOOK.search(text))


def wants(query):
    """What to collect from each part: {"notes": bool, "questions": bool, "pattern": bool}. When the request says nothing
    specific, notes and questions are both collected."""
    text = str(query or "")
    questions = bool(re.search(r"\b(questions?|exercises?|problems?|quiz|answers?|solve|solutions?|mcq|practice|past\s+papers?)\b", text, re.I))
    notes = bool(re.search(r"\b(notes?|summar\w+|key\s+(?:points|ideas|concepts)|revise|revision|overview|study\s+guide|explain|concepts?)\b", text, re.I))
    pattern = bool(re.search(r"\b(patterns?|trends?|analy[sz]\w*|types?\s+of\s+questions|frequently|common(?:ly)?\s+asked|weightage|important\s+topics)\b", text, re.I))
    if not questions and not notes:
        questions = notes = True
    return {"notes": notes, "questions": questions, "pattern": pattern or questions}
