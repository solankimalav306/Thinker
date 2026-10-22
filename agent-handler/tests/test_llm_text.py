from types import SimpleNamespace

from utils.llm_text import reply_text


def test_plain_string_content():
    assert reply_text(SimpleNamespace(content="hello")) == "hello"


def test_list_of_text_blocks_is_joined():
    blocks = [{"type": "text", "text": "Hello "}, {"type": "text", "text": "world"}]
    assert reply_text(SimpleNamespace(content=blocks)) == "Hello world"


def test_non_text_blocks_are_skipped():
    blocks = [{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": "answer"}]
    assert reply_text(SimpleNamespace(content=blocks)) == "answer"


def test_mixed_strings_and_blocks():
    assert reply_text(SimpleNamespace(content=["a", {"type": "text", "text": "b"}])) == "ab"


def test_none_content_is_empty():
    assert reply_text(SimpleNamespace(content=None)) == ""
