import json

import pytest

from utils.artifacts import KINDS, LIVE, build_reply, decide, extract_json, finalize, identify, prompt_for, split_reply, validate


# ---- deciding that an artifact is wanted, and which -------------------------------------------------------------

@pytest.mark.parametrize("query,kind", [
    ("make an artifact on what I have to do for this assignment with steps", "steps"),
    ("make an artifact of the things I have to do", "checklist"),
    ("quiz me on chapter 2", "quiz"),
    ("make a quiz about the safety rules", "quiz"),
    ("make flashcards for the key terms", "flashcards"),
    ("draw a flowchart of the arrival process", "diagram"),
    ("make a timeline of the deadlines", "timeline"),
    ("show the fees as a bar chart", "chart"),
    ("make a comparison table of the rules", "table"),
    ("make slides from this", "slides"),
    ("build a web page that calculates the port fee", "page"),
    ("create a checklist for submission", "checklist"),
    ("give me a step-by-step plan", "steps"),
])
def test_the_words_name_the_kind(query, kind):
    assert identify(query)["kind"] == kind
    route, found = decide("ask", query, True)
    assert (route, found) == ("artifact", kind), query


@pytest.mark.parametrize("query", [
    "what is the muster time limit?",
    "how often must lifeboats be inspected according to each document",
    "summarise this document",
    "write a report on page 3",          # a document or report alone is a summary, not an artifact
    "what are the steps in section 2?",  # asking about steps in the text is a question
    "explain the table on page 4",
    "where do these documents disagree?",
    "take notes on this chapter",
])
def test_plain_questions_stay_plain(query):
    assert decide("ask", query, True)[0] != "artifact", query


def test_the_word_artifact_always_wins_and_picks_a_sensible_kind():
    assert decide("note", "make an artifact on what i have to do", True)[0] == "artifact"
    assert decide("note", "make an artifact of this chapter", True) == ("artifact", "document")
    assert decide("mindmap", "make an artifact mind map", True)[0] == "artifact"
    for route in ("ask", "note", "highlight", "comment", "define", "search", "mindmap"):
        assert decide(route, "build me an artifact", True)[0] == "artifact", route


def test_a_named_kind_beats_notes_but_a_mind_map_keeps_its_own_route():
    assert decide("note", "make a checklist of the submission steps", True)[0] == "artifact"
    assert decide("highlight", "make a table of fees", True)[0] == "artifact"
    assert decide("mindmap", "make a mind map", True) == ("mindmap", None)
    assert decide("note", "make notes on this", True) == ("note", None)


def test_nothing_changes_when_artifacts_are_off():
    assert decide("note", "make an artifact", False) == ("note", None)
    assert decide("ask", "make a quiz", False) == ("ask", None)


def test_the_router_can_ask_for_one_when_the_words_do_not():
    assert decide("ask", "please prepare something I can practise with", True, llm_kind="quiz") == ("artifact", "quiz")
    assert decide("ask", "what time is it", True, llm_kind="quiz")[0] == "ask"   # no wish to have something made
    assert decide("ask", "make something", True, llm_kind="bogus")[0] == "ask"


# ---- the instructions are only for the kind that was asked for --------------------------------------------------

def test_each_kind_has_its_own_short_instructions():
    assert set(KINDS) == {"checklist", "steps", "quiz", "flashcards", "table", "chart", "diagram", "timeline", "document", "slides", "page"}
    sizes = {}
    for kind in KINDS:
        text = prompt_for(kind, "Field Guide")
        assert f'type="{kind}"' in text
        assert "Field Guide|page number" in text
        sizes[kind] = len(text)
    quiz = prompt_for("quiz")
    assert "answer" in quiz and "flashcards" not in quiz.lower() and '"groups"' not in quiz   # only its own shape
    assert max(sizes.values()) < 2600   # well under the old catch-all kit


# ---- checking the data ---------------------------------------------------------------------------------------

def test_valid_data_is_cleaned_for_every_live_kind():
    samples = {
        "checklist": {"groups": [{"title": "", "items": [{"text": "Read"}, "Write", {"text": ""}]}]},
        "steps": {"steps": [{"title": "Pick data", "detail": "3M cells"}, "Run tests"]},
        "quiz": {"questions": [{"q": "Q?", "options": ["a", "b"], "answer": 1}, {"q": "T?", "answer": True}]},
        "flashcards": {"cards": [{"front": "f", "back": "b"}]},
        "table": {"columns": ["A", "B"], "rows": [["1", "2"], ["3"]]},
        "chart": {"kind": "pie", "labels": ["x", "y"], "series": [{"name": "s", "values": [1, "2"]}]},
        "diagram": {"nodes": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}], "edges": [{"from": "a", "to": "b"}]},
        "timeline": {"events": [{"when": "1 Mar", "title": "Change"}]},
        "document": {"sections": [{"heading": "H", "text": "T"}]},
    }
    assert set(samples) == LIVE
    for kind, data in samples.items():
        assert validate(kind, data), kind
    assert [len(g["items"]) for g in validate("checklist", samples["checklist"])["groups"]] == [2]
    assert validate("quiz", samples["quiz"])["questions"][1]["options"] == ["True", "False"]
    assert validate("table", samples["table"])["rows"][1] == ["3", ""]
    assert validate("chart", samples["chart"])["series"][0]["values"] == [1.0, 2.0]


@pytest.mark.parametrize("kind,data", [
    ("checklist", {"groups": []}), ("steps", {"steps": []}), ("quiz", {"questions": [{"q": "x", "options": ["a"], "answer": 0}]}),
    ("quiz", {"questions": [{"q": "x", "options": ["a", "b"], "answer": 5}]}), ("flashcards", {"cards": [{"front": "only"}]}),
    ("table", {"columns": [], "rows": [["a"]]}), ("chart", {"series": [{"values": ["a"]}]}), ("diagram", {"nodes": [{"id": "a", "label": "A"}]}),
    ("timeline", {"events": []}), ("document", {"sections": []}), ("steps", []), ("steps", "text"),
])
def test_unusable_data_says_what_is_wrong(kind, data):
    with pytest.raises(ValueError) as problem:
        validate(kind, data)
    assert str(problem.value)


def test_diagram_edges_to_nowhere_are_dropped():
    spec = validate("diagram", {"nodes": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}], "edges": [{"from": "a", "to": "b"}, {"from": "a", "to": "zzz"}, {"from": "a", "to": "a"}]})
    assert len(spec["edges"]) == 1


# ---- the whole path from a reply to what the app shows --------------------------------------------------------------

def make(body, title="Assignment steps", intro="Here are the steps."):
    return f'{intro}\n<artifact title="{title}" type="steps">{body}</artifact>'


def test_a_good_reply_becomes_a_checked_artifact():
    reply = make(json.dumps({"steps": [{"title": "Pick a dataset", "detail": "At least $3M$ cells", "cite": "Brief|1"}]}))
    out = finalize("steps", reply)
    intro, title, body = split_reply(out)
    assert intro == "Here are the steps." and title == "Assignment steps"
    assert json.loads(body)["steps"][0]["title"] == "Pick a dataset"


def test_fences_and_chatter_around_the_data_are_tolerated():
    out = finalize("steps", make('```json\n{"steps":["a","b"]}\n```'))
    assert len(json.loads(split_reply(out)[2])["steps"]) == 2


def test_bad_data_is_repaired_once_with_the_reason():
    calls = []

    def repair(bad, why):
        calls.append((bad, why))
        return '<artifact title="x" type="steps">{"steps":[{"title":"fixed"}]}</artifact>'

    out = finalize("steps", make('{"steps": []}'), repair=repair)
    assert len(calls) == 1 and "steps" in calls[0][1]
    assert json.loads(split_reply(out)[2])["steps"][0]["title"] == "fixed"


def test_when_it_cannot_be_repaired_the_person_gets_words_not_a_broken_card():
    out = finalize("steps", make("not data at all"), repair=lambda bad, why: "still not data")
    assert "<artifact" not in out and out.strip()
    assert "<artifact" not in finalize("quiz", "just words, no block", repair=None)


def test_data_can_never_close_its_own_tag():
    spec = {"steps": [{"title": "x</artifact><script>alert(1)</script>"}]}
    out = build_reply("Here.", "A \"quoted\" <title>", "steps", spec)
    assert out.count("</artifact>") == 1 and out.count("<artifact") == 1
    assert json.loads(split_reply(out)[2]) == spec          # and it reads back as the same text
    # a reply that closes the tag early is not trusted: the person gets words, not a half-card
    raw = finalize("steps", make(json.dumps(spec)))
    assert "<artifact" not in raw


def test_page_and_slides_are_passed_through_as_written():
    html = '<artifact title="Deck" type="slides"><section class="tk-slide"><h2>Hi</h2></section></artifact>'
    assert finalize("slides", html) == html
    assert extract_json('{"a": 1}') == {"a": 1}
    with pytest.raises(ValueError):
        extract_json("nothing")
