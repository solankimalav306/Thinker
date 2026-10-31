def sources_from_hits(hits):
    """The (document, page) pairs an answer was allowed to cite, without repeats, in the order retrieved.

    The interface checks every citation in an artifact against this list, so a citation the model made up
    is shown as plain text instead of a clickable reference.
    """
    seen = set()
    out = []
    for hit in hits or []:
        if not isinstance(hit, dict):
            continue
        pages = hit.get("pages") if isinstance(hit.get("pages"), list) and hit.get("pages") else [hit.get("page")]
        doc = str(hit.get("doc") or "")
        for raw in pages:   # a passage that crosses a page break may be cited by either page
            try:
                page = int(raw)
            except (TypeError, ValueError):
                continue
            key = (doc, page)
            if key in seen:
                continue
            seen.add(key)
            out.append({"doc": doc, "page": page})
    return out
