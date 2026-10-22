import numpy as np
import pytest

from services import indexing, retrieval


def fake_embed(texts):
    # Deterministic 8-dim vectors derived from the text, so no model download is needed.
    out = []
    for t in texts:
        rng = np.random.default_rng(abs(hash(t.split(": ", 1)[-1])) % (2**32))
        out.append(rng.random(8))
    return np.array(out)


@pytest.fixture(autouse=True)
def stub_embeddings(monkeypatch):
    monkeypatch.setattr(indexing, "embed", fake_embed)
    monkeypatch.setattr(retrieval, "embed", fake_embed)


def index_doc(tmp_path, pages, pdf_id="a" * 64):
    return indexing.indexing_service({"pages": pages, "storagePath": str(tmp_path), "pdfId": pdf_id})


def test_query_with_k_larger_than_chunk_count_returns_no_phantom_chunks(tmp_path):
    index_doc(tmp_path, [{"page": 1, "text": "alpha beta gamma"}, {"page": 2, "text": "delta epsilon zeta"}])
    result = retrieval.retrieval_service({"query": "alpha", "pdfId": "a" * 64, "storagePath": str(tmp_path), "k": 5})
    chunk_ids = [c["chunk_id"] for c in result["chunks"]]
    assert len(chunk_ids) == len(set(chunk_ids)) == 2


def test_non_ascii_text_round_trips(tmp_path):
    index_doc(tmp_path, [{"page": 1, "text": "नमस्ते दुनिया यह एक परीक्षण है"}])
    result = retrieval.retrieval_service({"query": "नमस्ते", "pdfId": "a" * 64, "storagePath": str(tmp_path), "k": 1})
    assert result["chunks"][0]["text"].startswith("नमस्ते")


def test_index_without_metadata_is_not_treated_as_indexed(tmp_path):
    (tmp_path / f"{'b' * 64}.index").write_bytes(b"partial")
    result = index_doc(tmp_path, [{"page": 1, "text": "recovered after a crash"}], pdf_id="b" * 64)
    assert result["status"] == "indexed"


def test_second_index_call_is_a_no_op(tmp_path):
    index_doc(tmp_path, [{"page": 1, "text": "hello world"}])
    assert index_doc(tmp_path, [{"page": 1, "text": "hello world"}])["status"] == "already indexed"


def test_no_temp_files_left_behind(tmp_path):
    index_doc(tmp_path, [{"page": 1, "text": "hello world"}])
    assert not list(tmp_path.glob("*.tmp"))
