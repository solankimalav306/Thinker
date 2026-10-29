# In Document-only mode the answer must come from the document. Two routes would leave it:
# "define" asks a dictionary (general knowledge) and "search" sends the question to the web.
DOCUMENT_ONLY_ALLOWED = {"ask", "highlight", "note", "mindmap", "comment"}


def constrain_intent(intent, mode, multi=False):
    """Return the intent to run for this mode. Anything that would leave the document becomes "ask".

    A question asked across several documents is always an "ask": notes, highlights, mind maps and
    sticky notes belong to one document at a time.
    """
    if multi:
        return "ask"
    if mode == "document" and intent not in DOCUMENT_ONLY_ALLOWED:
        return "ask"
    return intent
