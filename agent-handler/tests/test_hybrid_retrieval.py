import json
import os

import numpy as np
import pytest

from services import indexing, retrieval
from utils.bm25 import BM25, tokens


def vague_embed(texts):
    """Vectors that carry no useful meaning, so only the keyword search can find the right passage."""
    out = []
    for t in texts:
        rng = np.random.default_rng(abs(hash(t)) % (2**32))
        out.append(rng.random(8))
    return np.array(out)


@pytest.fixture(autouse=True)
def stub(monkeypatch):
    monkeypatch.setattr(indexing, "embed", vague_embed)
    monkeypatch.setattr(retrieval, "embed", vague_embed)
    retrieval._cache.clear()


def filler(tag, n=150):
    return " ".join(f"{tag}{i}" for i in range(n)) + "."


def index(tmp_path, pages, pdf_id="a" * 64):
    indexing.indexing_service({"pages": pages, "storagePath": str(tmp_path), "pdfId": pdf_id})


def test_an_exact_term_is_found_even_when_meaning_does_not_help(tmp_path):
    pages = [{"page": i, "text": filler(f"noise{i}_")} for i in range(1, 9)]
    pages[5]["text"] = "The coefficient XJ-4471 controls the damping. " + filler("other")
    index(tmp_path, pages)
    res = retrieval.retrieval_service({"query": "what does XJ-4471 control", "pdfId": "a" * 64, "storagePath": str(tmp_path), "k": 3})
    assert res["chunks"][0]["page"] == 6


def test_an_old_index_is_searched_by_words_and_rebuilt_when_the_document_is_opened(tmp_path):
    pid = "c" * 64
    old = [{"text": "alpha rocket fuel", "page": 1, "chunk_id": "1_0"}, {"text": "beta river water", "page": 2, "chunk_id": "2_0"}]
    (tmp_path / f"{pid}.json").write_text(json.dumps(old), encoding="utf-8")
    import faiss
    ix = faiss.IndexFlatL2(8)
    ix.add(np.random.rand(2, 8).astype("float32"))
    faiss.write_index(ix, str(tmp_path / f"{pid}.index"))
    res = retrieval.retrieval_service({"query": "river", "pdfId": pid, "storagePath": str(tmp_path), "k": 1})
    assert res["chunks"][0]["page"] == 2
    again = indexing.indexing_service({"pages": [{"page": 1, "text": "alpha rocket fuel."}], "storagePath": str(tmp_path), "pdfId": pid})
    assert again["status"] == "indexed"
    assert indexing.indexing_service({"pages": [{"page": 1, "text": "alpha rocket fuel."}], "storagePath": str(tmp_path), "pdfId": pid})["status"] == "already indexed"


def test_a_document_without_text_is_indexed_and_searchable(tmp_path):
    index(tmp_path, [{"page": 1, "text": ""}, {"page": 2, "text": "   "}])
    res = retrieval.retrieval_service({"query": "anything", "pdfId": "a" * 64, "storagePath": str(tmp_path), "k": 3})
    assert res["chunks"] == [] and not res["legacy"]


def test_pages_named_in_a_question_find_passages_that_cross_them(tmp_path):
    index(tmp_path, [{"page": 1, "text": "one half"}, {"page": 2, "text": "other half."}])
    res = retrieval.pages_service({"pdfId": "a" * 64, "storagePath": str(tmp_path), "pages": [2]})
    assert len(res["chunks"]) == 1


def test_keyword_search_ranks_the_rare_word_first_and_ignores_stop_words():
    bm = BM25(["the cat sat on the mat", "a zebra crossed the road", "the dog ate the food"])
    assert bm.ranked("where is the zebra")[0] == 1
    assert tokens("The running dogs") == ["runn", "dog"] or tokens("The running dogs")[0].startswith("run")


def test_keyword_search_handles_other_scripts():
    bm = BM25(["नमस्ते दुनिया", "hello world"])
    assert bm.ranked("दुनिया")[0] == 0


def test_a_document_still_being_indexed_is_searched_by_words(tmp_path):
    from utils.chunking import chunk_pages
    from db.metadata import save_metadata
    pid = "d" * 64
    chunks = chunk_pages([{"page": 1, "text": "The reactor coolant temperature limit is 330 degrees."}])
    for c in chunks:
        c["model"] = retrieval.embeddings.DEFAULT_MODEL
    save_metadata(str(tmp_path / f"{pid}.json"), chunks)    # passages saved, vectors not yet
    res = retrieval.retrieval_service({"query": "coolant temperature limit", "pdfId": pid, "storagePath": str(tmp_path), "k": 3})
    assert res["chunks"][0]["page"] == 1 and res["preparing"] and not res["legacy"]
    assert retrieval.retrieval_service({"query": "x", "pdfId": "e" * 64, "storagePath": str(tmp_path), "k": 3}) == {"error": "Index not found"}


def test_two_requests_to_index_one_document_do_the_work_once(tmp_path):
    import threading
    calls = []
    real = indexing.embed

    def counting(texts):
        calls.append(1)
        return real(texts)

    indexing.embed = counting
    try:
        pages = [{"page": 1, "text": filler("a") + " " + filler("b")}]
        results = []
        threads = [threading.Thread(target=lambda: results.append(indexing.indexing_service({"pages": pages, "storagePath": str(tmp_path), "pdfId": "f" * 64}))) for _ in range(2)]
        [t.start() for t in threads]
        [t.join() for t in threads]
    finally:
        indexing.embed = real
    assert sorted(r["status"] for r in results) == ["already indexed", "indexed"] and len(calls) == 1
