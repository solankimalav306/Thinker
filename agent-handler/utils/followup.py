"""The words to search with for a question that leans on the one before it.

"And what about its cost?" means nothing to a search on its own. When a question is short or points back ("it", "that",
"the second one", "and ..."), the previous question of the chat is searched together with it. No model call is needed.
"""
import re

_POINTS_BACK = re.compile(
    r"\b(it|its|it's|this|that|these|those|they|them|their|he|she|his|her|the same|the former|the latter|the (?:first|second|third|last|other|previous|next) (?:one|ones|point|step|item|part|section|case)?|"
    r"above|previous|earlier|before|again|too|also|more|another|else|instead|such|there|here)\b", re.I)
_STARTS_LIKE_A_CONTINUATION = re.compile(r"^\s*(and|but|so|then|also|or|what about|how about|why|how so|really|ok|okay|what else|more|go on|explain)\b", re.I)
SHORT_WORDS = 6
MAX_PREVIOUS_CHARS = 300


def depends_on_context(query):
    words = str(query or "").split()
    if not words:
        return False
    return len(words) <= SHORT_WORDS or bool(_STARTS_LIKE_A_CONTINUATION.match(query)) or bool(_POINTS_BACK.search(query))


def previous_question(messages, query):
    """The latest earlier question the person asked in this chat, or ''."""
    current = str(query or "").strip()
    seen_current = False
    for message in reversed(list(messages or [])):
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        text = str(message.get("text") or "").strip()
        if not text:
            continue
        if not seen_current and text == current:   # the question being answered may already be in the list
            seen_current = True
            continue
        return text[:MAX_PREVIOUS_CHARS]
    return ""


def retrieval_query(query, messages, selected=""):
    """`query` as it should be searched: itself, or, when it leans on what came before, with the selected text and the
    earlier question in front of it."""
    query = str(query or "")
    if not depends_on_context(query):
        return query
    front = [str(selected or "").strip()[:MAX_PREVIOUS_CHARS], previous_question(messages, query)]
    return " ".join([p for p in front if p] + [query]).strip()
