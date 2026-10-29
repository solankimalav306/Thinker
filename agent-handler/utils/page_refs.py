import re

MAX_PAGES = 5

_RANGE = re.compile(r"\b(?:pages?|pp?\.)\s*(\d{1,4})(?:\s*(?:-|–|—|to|through|and|&)\s*(\d{1,4}))?", re.IGNORECASE)
_LIST = re.compile(r"\b(?:pages?|pp?\.)\s*((?:\d{1,4}\s*,\s*)+\d{1,4})", re.IGNORECASE)


def extract_page_refs(query, page_count=None):
    """Page numbers a question names ("page 10", "pages 3-5", "p. 7", "pages 2, 4, 9").

    Meaning-based search cannot answer "summarise page 10", so these pages are fetched directly.
    Returns at most MAX_PAGES numbers, in ascending order, inside the document when its length is known.
    """
    text = str(query or "")
    found = []
    for match in _LIST.finditer(text):
        found.extend(int(n) for n in re.findall(r"\d{1,4}", match.group(1)))
    for match in _RANGE.finditer(text):
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else start
        if end < start:
            start, end = end, start
        found.extend(range(start, min(end, start + MAX_PAGES - 1) + 1))
    pages = sorted({p for p in found if p >= 1 and (page_count is None or p <= page_count)})
    return pages[:MAX_PAGES]
