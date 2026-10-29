# In Document-only mode the answer must come from the document. Two routes would leave it:
# "define" asks a dictionary (general knowledge) and "search" sends the question to the web.
DOCUMENT_ONLY_ALLOWED = {"ask", "highlight", "note", "mindmap", "comment"}


def constrain_intent(intent, mode):
    """Return the intent to run for this mode. Anything that would leave the document becomes "ask"."""
    if mode == "document" and intent not in DOCUMENT_ONLY_ALLOWED:
        return "ask"
    return intent
