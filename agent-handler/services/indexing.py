import os

import threading

import numpy as np

import embeddings
from embeddings import embed
from utils.chunking import VERSION, chunk_pages, embed_text
from db.faiss_store import create_index, save_index, add_vectors
from db.metadata import save_metadata, load_metadata
from services.rerank import warm as warm_reranker


def _current(meta_path):
    """True when an existing index was made the way new ones are, so it does not need to be rebuilt."""
    try:
        chunks = load_metadata(meta_path)
    except Exception:
        return False
    if not chunks:
        return True
    return chunks[0].get("v") == VERSION and chunks[0].get("model") == embeddings.DEFAULT_MODEL


_locks = {}
_locks_guard = threading.Lock()


def _lock_for(pdf_id):
    with _locks_guard:
        return _locks.setdefault(pdf_id, threading.Lock())


def indexing_service(data):
    # a second request for a document that is being indexed waits for the first and then finds it done,
    # instead of doing the same work twice
    with _lock_for(data["pdfId"]):
        return _index(data)


def _index(data):
    pages = data["pages"]
    storage = data["storagePath"]
    pdf_id = data["pdfId"]

    os.makedirs(storage, exist_ok=True)

    index_path = os.path.join(storage, f"{pdf_id}.index")
    meta_path = os.path.join(storage, f"{pdf_id}.json")

    # An index counts as complete only when both files exist; the index is written last.
    # One made by an older version of the chunker is rebuilt, so every document gets the better search.
    if os.path.exists(index_path) and os.path.exists(meta_path) and _current(meta_path):
        warm_reranker()
        return {"status": "already indexed", "pdfId": pdf_id}

    chunks = [c for c in chunk_pages(pages) if c["text"].strip()]
    for c in chunks:
        c["model"] = embeddings.DEFAULT_MODEL

    # The passages are saved before the slow part (the vectors), so questions asked while a long document is still
    # being prepared are already answered by word search.
    save_metadata(meta_path, chunks)

    if chunks:
        prefix = embeddings.passage_prefix()
        vectors = np.asarray(embed([prefix + embed_text(c) for c in chunks]), dtype="float32")
        vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
        index = create_index(vectors.shape[1])
        add_vectors(index, vectors)
    else:   # a document with no text (a scan): an empty index, so it is not retried on every open
        index = create_index(1)

    tmp_index_path = f"{index_path}.tmp"
    save_index(index, tmp_index_path)
    os.replace(tmp_index_path, index_path)

    warm_reranker()   # load the second-look model while the person starts reading
    return {"status": "indexed", "pdfId": pdf_id, "chunks": len(chunks)}
