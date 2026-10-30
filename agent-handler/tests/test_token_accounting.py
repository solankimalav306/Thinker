from types import SimpleNamespace

from graph import extract_provider_usage, reconcile_input


def test_the_parts_are_slices_of_the_prompt_not_extra():
    # the prompt (1000) already holds 400 of passages, 100 of history and 20 of selected text
    split = reconcile_input({"context": 400, "history": 100, "selected_text": 20, "prompt": 1000})
    assert sum(split.values()) == 1000
    assert split["context"] == 400 and split["history"] == 100 and split["selected_text"] == 20
    assert split["prompt"] == 480


def test_the_providers_real_total_wins_and_the_slices_are_scaled_to_it():
    split = reconcile_input({"context": 400, "history": 100, "selected_text": 20, "prompt": 1000}, real_input=1200)
    assert sum(split.values()) == 1200
    assert split["context"] == 480 and split["history"] == 120


def test_odd_estimates_never_go_negative():
    split = reconcile_input({"context": 900, "history": 0, "selected_text": 0, "prompt": 100})
    assert min(split.values()) >= 0
    assert sum(split.values()) == 900
    assert sum(reconcile_input({"context": 0, "history": 0, "selected_text": 0, "prompt": 0}, real_input=50).values()) == 50
    assert sum(reconcile_input({}).values()) == 0


def test_provider_usage_includes_thinking_in_the_output():
    reply = SimpleNamespace(usage_metadata={"input_tokens": 1500, "output_tokens": 40, "total_tokens": 1900})
    assert extract_provider_usage(reply) == (1500, 400)
    plain = SimpleNamespace(usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15})
    assert extract_provider_usage(plain) == (10, 5)


def test_a_reply_without_usage_is_reported_as_unknown():
    assert extract_provider_usage(SimpleNamespace()) is None
    assert extract_provider_usage(SimpleNamespace(usage_metadata=None)) is None
    assert extract_provider_usage(SimpleNamespace(usage_metadata={"input_tokens": 0, "output_tokens": 3})) is None
