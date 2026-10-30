import numpy as np
import pytest

from services import indexing, retrieval
from prompts import build_ask_prompt
from utils.intents import constrain_intent

DIM = 16
WORDS = ["ship", "fuel", "crew", "port", "safety", "engine", "tax", "court", "law", "paper", "model", "data", "cell", "protein", "river", "bank"]


def fake_embed(texts):
    """Bag-of-words vectors, so a passage is close to a question that shares its words."""
    out = []
    for text in texts:
        body = text.split(": ", 1)[-1].lower()
        vec = np.zeros(DIM)
        for i, word in enumerate(WORDS):
            vec[i] = body.count(word)
        vec += 0.01  # never an all-zero vector
        out.append(vec)
    return np.array(out)


@pytest.fixture(autouse=True)
def stub_embeddings(monkeypatch):
    monkeypatch.setattr(indexing, "embed", fake_embed)
    monkeypatch.setattr(retrieval, "embed", fake_embed)


def index(tmp_path, pdf_id, pages):
    indexing.indexing_service({"pages": [{"page": i + 1, "text": t} for i, t in enumerate(pages)], "storagePath": str(tmp_path), "pdfId": pdf_id})


def docs(*pairs):
    return [{"pdfId": pid, "title": title} for pid, title in pairs]


def test_passages_come_back_labelled_with_the_document_they_are_from(tmp_path):
    index(tmp_path, "a" * 64, ["ship fuel engine", "crew safety port"])
    index(tmp_path, "b" * 64, ["tax law court", "paper model data"])
    result = retrieval.retrieval_multi({"query": "fuel for the ship engine", "storagePath": str(tmp_path), "k": 3, "docs": docs(("a" * 64, "Handbook"), ("b" * 64, "Legal notes"))})
    first = result["chunks"][0]
    assert first["doc"] == "Handbook" and first["page"] == 1
    assert all(c["doc"] in ("Handbook", "Legal notes") for c in result["chunks"])
    assert result["missing"] == []


def test_the_question_picks_the_right_document(tmp_path):
    index(tmp_path, "a" * 64, ["ship fuel engine crew", "port safety"])
    index(tmp_path, "b" * 64, ["tax law court law", "court tax"])
    result = retrieval.retrieval_multi({"query": "what does the law say about tax in court", "storagePath": str(tmp_path), "k": 2, "perDoc": 2, "docs": docs(("a" * 64, "Handbook"), ("b" * 64, "Legal notes"))})
    assert result["chunks"][0]["doc"] == "Legal notes"


def test_one_long_document_cannot_crowd_out_the_others(tmp_path):
    index(tmp_path, "a" * 64, ["ship fuel engine"] * 6)
    index(tmp_path, "b" * 64, ["ship tax"])
    result = retrieval.retrieval_multi({"query": "ship fuel engine", "storagePath": str(tmp_path), "k": 6, "perDoc": 3, "docs": docs(("a" * 64, "Long"), ("b" * 64, "Short"))})
    per_doc = {}
    for c in result["chunks"]:
        per_doc[c["doc"]] = per_doc.get(c["doc"], 0) + 1
    assert per_doc["Long"] <= 3
    assert per_doc.get("Short", 0) >= 1


def test_documents_that_are_not_indexed_are_reported_not_fatal(tmp_path):
    index(tmp_path, "a" * 64, ["ship fuel"])
    result = retrieval.retrieval_multi({"query": "ship", "storagePath": str(tmp_path), "docs": docs(("a" * 64, "Ready"), ("c" * 64, "Not yet"), ("", "No id"))})
    assert [c["doc"] for c in result["chunks"]] == ["Ready"]
    assert result["missing"] == ["Not yet", "No id"]


def test_no_documents_and_too_many_documents(tmp_path):
    assert retrieval.retrieval_multi({"query": "x", "storagePath": str(tmp_path), "docs": []}) == {"chunks": [], "missing": []}
    many = [{"pdfId": f"{i:064x}", "title": f"d{i}"} for i in range(40)]
    result = retrieval.retrieval_multi({"query": "x", "storagePath": str(tmp_path), "docs": many})
    assert len(result["missing"]) == retrieval.MAX_DOCS


def test_a_question_over_several_documents_is_always_an_ask():
    for intent in ("ask", "define", "search", "note", "mindmap", "highlight", "comment"):
        assert constrain_intent(intent, "auto", multi=True) == "ask"
        assert constrain_intent(intent, "document", multi=True) == "ask"
    assert constrain_intent("note", "auto") == "note"


def test_the_prompt_asks_for_titled_citations_and_names_the_documents_in_refusals():
    prompt = build_ask_prompt(context="[Handbook, page 3] text", question="q?", mode="document", multi=True)
    assert "[Document title, page N]" in prompt
    assert "SEVERAL documents" in prompt
    assert "in these documents" in prompt
    single = build_ask_prompt(context="[Page 3] text", question="q?", mode="document")
    assert "SEVERAL" not in single
    assert "in this document" in single


def test_artifact_rules_only_appear_when_asked_for():
    on = build_ask_prompt(context="c", question="q", artifacts=True, multi=True)
    off = build_ask_prompt(context="c", question="q", multi=True)
    assert "<artifact title=" in on and "data-cite" in on and "No <script>" in on
    assert "<artifact" not in off


def test_sources_list_what_may_be_cited_without_repeats():
    from utils.sources import sources_from_hits
    hits = [{"doc": "Manual", "page": 2}, {"doc": "Manual", "page": 2}, {"doc": "Bulletin", "page": "1"}, {"page": 5}, {"doc": "x", "page": "bad"}, None]
    assert sources_from_hits(hits) == [{"doc": "Manual", "page": 2}, {"doc": "Bulletin", "page": 1}, {"doc": "", "page": 5}]
    assert sources_from_hits(None) == []


def test_single_document_artifact_prompt_names_the_document():
    from prompts import build_ask_prompt
    prompt = build_ask_prompt(question="make a table", artifacts=True, doc_title="Field Guide")
    assert 'data-cite="Field Guide|page number"' in prompt
    plain = build_ask_prompt(question="make a table", artifacts=False, doc_title="Field Guide")
    assert "Field Guide" not in plain
