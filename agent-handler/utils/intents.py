import re

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


# Asking for an artifact by name, or for a kind of visual document that is not notes.
_EXPLICIT = re.compile(r"\b(artifacts?|web ?pages?|html)\b", re.I)
_VISUAL = re.compile(
    r"\b(tables?|charts?|graphs?|timelines?|flash ?cards?|slides?|slide ?deck|checklists?|diagrams?|cheat ?sheets?|"
    r"infographics?|step[- ]by[- ]step|one[- ]page(?:r)?)\b",
    re.I,
)
# routes that produce something other than an answer in the chat
_OTHER_ROUTES = {"note", "highlight", "comment", "define", "search"}


def wants_artifact(query):
    """"explicit" when the person says artifact (or web page), "visual" when they name a visual document, else None."""
    text = str(query or "")
    if _EXPLICIT.search(text):
        return "explicit"
    if _VISUAL.search(text):
        return "visual"
    return None


def apply_artifact_intent(intent, query, artifacts_enabled):
    """Route a request for an artifact to the answer, which is where artifacts are written.

    The router reads "make ... with steps" as a request for notes and sends it to the notes panel. When artifacts
    are on, saying "artifact" always wins; naming a table, chart, timeline, checklist and so on wins over notes,
    highlights, comments, definitions and web search (but not over a mind map, which has its own picture).
    """
    if not artifacts_enabled:
        return intent
    kind = wants_artifact(query)
    if kind == "explicit":
        return "ask"
    if kind == "visual" and intent in _OTHER_ROUTES:
        return "ask"
    return intent
