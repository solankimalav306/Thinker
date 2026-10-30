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


def test_saying_artifact_always_gets_one():
    from utils.intents import apply_artifact_intent
    q = "make an artifact on what I have to do for this assignment with steps"
    for routed in ("note", "ask", "highlight", "comment", "define", "search", "mindmap"):
        assert apply_artifact_intent(routed, q, True) == "ask"


def test_a_named_visual_document_beats_notes_but_not_a_mind_map():
    from utils.intents import apply_artifact_intent
    assert apply_artifact_intent("note", "Make a checklist of the submission steps", True) == "ask"
    assert apply_artifact_intent("note", "build a timeline of the deadlines", True) == "ask"
    assert apply_artifact_intent("mindmap", "make a mind map as a diagram", True) == "mindmap"
    assert apply_artifact_intent("highlight", "highlight the table of fees", True) == "ask"


def test_plain_requests_and_disabled_artifacts_are_left_alone():
    from utils.intents import apply_artifact_intent
    assert apply_artifact_intent("note", "take notes on chapter two", True) == "note"
    assert apply_artifact_intent("note", "make notes on this", True) == "note"
    assert apply_artifact_intent("define", "what does entropy mean", True) == "define"
    assert apply_artifact_intent("note", "make an artifact", False) == "note"
    assert apply_artifact_intent("note", "", True) == "note"
    assert apply_artifact_intent("note", None, True) == "note"


def test_wants_artifact_recognises_the_words_people_use():
    from utils.intents import wants_artifact
    assert wants_artifact("Make an Artifact for me") == "explicit"
    assert wants_artifact("show it as a web page") == "explicit"
    assert wants_artifact("a step-by-step plan") == "visual"
    assert wants_artifact("compare the two in a table") == "visual"
    assert wants_artifact("what is the deadline?") is None
    assert wants_artifact("tablet computers") is None
