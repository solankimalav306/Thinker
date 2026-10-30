from utils.intents import constrain_intent


def test_document_only_never_leaves_the_document():
    assert constrain_intent("define", "document") == "ask"
    assert constrain_intent("search", "document") == "ask"
    assert constrain_intent("ask", "document") == "ask"
    assert constrain_intent("note", "document") == "note"
    assert constrain_intent("mindmap", "document") == "mindmap"


def test_auto_mode_keeps_every_route():
    for intent in ("ask", "define", "search", "highlight", "note", "mindmap", "comment"):
        assert constrain_intent(intent, "auto") == intent
