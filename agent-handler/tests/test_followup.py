from utils.followup import depends_on_context, previous_question, retrieval_query

CHAT = [
    {"role": "user", "text": "How much fuel does the Aurora burn per voyage?"},
    {"role": "assistant", "text": "About 40 tonnes."},
    {"role": "user", "text": "and what about the Meridian?"},
]


def test_a_complete_question_is_searched_as_it_is():
    q = "What is the maximum wind speed for crane operations at Berth 4?"
    assert not depends_on_context(q)
    assert retrieval_query(q, CHAT) == q


def test_a_follow_up_is_searched_with_the_question_before_it():
    assert depends_on_context("and what about the Meridian?")
    assert retrieval_query("and what about the Meridian?", CHAT) == "How much fuel does the Aurora burn per voyage? and what about the Meridian?"


def test_pointing_words_make_a_question_depend_on_context():
    for q in ["Why does that happen in the winter months of the year?", "Can you explain the second one in more detail please", "Summarise it"]:
        assert depends_on_context(q), q


def test_the_current_question_is_not_taken_as_the_earlier_one():
    assert previous_question(CHAT, "and what about the Meridian?") == "How much fuel does the Aurora burn per voyage?"
    assert previous_question([{"role": "user", "text": "only this"}], "only this") == ""
    assert retrieval_query("what about it?", []) == "what about it?"


def test_selected_text_leads_when_the_question_points_at_it():
    out = retrieval_query("explain this", [], selected="Context switches save registers.")
    assert out == "Context switches save registers. explain this"
