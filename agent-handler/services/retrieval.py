"""Finding the passages that answer a question.

Two searches run side by side: one by meaning (the embedding index) and one by words (BM25, which is what finds a
name, a number or an acronym). Their rankings are merged, and a cross-encoder then re-reads the best few against the
question. An index made by an older version of the app has no passage vectors worth using, so it is searched by words
alone until the document is opened again and rebuilt.
"""
import os

import numpy as np

import embeddings
from embeddings import embed
from db.faiss_store import load_index, search_with_scores
from db.metadata import load_metadata
from services.rerank import rerank
from utils.bm25 import BM25
from utils.chunking import VERSION, embed_text

POOL = 20          # candidates the cross-encoder reads
DENSE_WEIGHT = 1.0
WORD_WEIGHT = 2.0  # words beat meaning on names, numbers and terms; measured on 124 questions over 7 papers
RRF_K = 60
MAX_DOCS = 12
MAX_CACHED = 16

_cache = {}


def _load(storage, pdf_id):
    """The index, passages and keyword index of one document, or None when it has not been indexed."""
    index_path = os.path.join(storage, f"{pdf_id}.index")
    meta_path = os.path.join(storage, f"{pdf_id}.json")
    if not pdf_id or not os.path.exists(meta_path):
        return None
    # the passages are saved first and the vectors later: in between, the document is searched by words alone
    has_index = os.path.exists(index_path)
    key = (meta_path, os.path.getmtime(meta_path), os.path.getmtime(index_path) if has_index else 0)
    if key in _cache:
        return _cache[key]
    index = load_index(index_path) if has_index else None
    meta = load_metadata(meta_path)
    modern = index is not None and bool(meta) and meta[0].get("v") == VERSION and meta[0].get("model") == embeddings.DEFAULT_MODEL and index.ntotal == len(meta)
    doc = {"index": index, "meta": meta, "modern": modern, "preparing": index is None, "bm25": BM25([embed_text(c) for c in meta])}
    for stale in [k for k in _cache if k[0] == meta_path]:
        del _cache[stale]
    if len(_cache) >= MAX_CACHED:
        _cache.pop(next(iter(_cache)))
    _cache[key] = doc
    return doc


def _question_vector(query):
    v = np.asarray(embed([embeddings.query_prefix() + query]), dtype="float32")
    return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)


def _candidates(doc, query, q_vec, pool):
    """[(passage index, merged score, meaning score)], best first."""
    lists = []
    dense = {}
    if doc["modern"] and q_vec is not None:
        hits = search_with_scores(doc["index"], q_vec, pool * 2)
        dense = {i: s for s, i in hits}
        lists.append((DENSE_WEIGHT, [i for _, i in hits]))
    words = doc["bm25"].ranked(query, pool * 2)
    if words:
        lists.append((WORD_WEIGHT, words))
    merged = {}
    for weight, ranking in lists:
        for rank, i in enumerate(ranking):
            merged[i] = merged.get(i, 0.0) + weight / (RRF_K + rank + 1)
    order = sorted(merged, key=lambda i: -merged[i])[:pool]
    return [(i, merged[i], dense.get(i, 0.0)) for i in order]


def _rank(query, candidates, texts):
    """Candidates re-ordered by the cross-encoder when there is one; otherwise as they came."""
    scores = rerank(query, texts)
    if scores is None:
        return candidates, None
    order = sorted(range(len(candidates)), key=lambda n: -scores[n])
    return [candidates[n] for n in order], [scores[n] for n in order]


def retrieval_service(data):
    query = data["query"]
    pdf_id = data["pdfId"]
    storage = data["storagePath"]
    k = int(data.get("k", 5))

    doc = _load(storage, pdf_id)
    if doc is None:
        return {"error": "Index not found"}
    meta = doc["meta"]
    if not meta:
        return {"chunks": [], "legacy": False}   # nothing to search: a scan with no text is not worth rebuilding
    preparing = doc["preparing"]

    q_vec = _question_vector(query) if doc["modern"] else None
    candidates = _candidates(doc, query, q_vec, max(POOL, k))
    candidates, reranked = _rank(query, candidates, [meta[i]["text"] for i, _, _ in candidates])

    results = []
    for n, (i, merged, meaning) in enumerate(candidates[:k]):
        chunk = dict(meta[i])
        chunk["score"] = reranked[n] if reranked else merged
        results.append(chunk)
    return {"chunks": results, "legacy": not doc["modern"] and not preparing, "preparing": preparing}


def pages_service(data):
    """Passages on whole pages, for questions that name a page."""
    pdf_id = data["pdfId"]
    storage = data["storagePath"]
    wanted = set(int(p) for p in data.get("pages", []))
    meta_path = os.path.join(storage, f"{pdf_id}.json")
    if not wanted or not os.path.exists(meta_path):
        return {"chunks": []}
    metadata = load_metadata(meta_path)
    return {"chunks": [m for m in metadata if wanted & set(m.get("pages") or [m.get("page")])]}


def retrieval_multi(data):
    """The best passages across several documents, with the document each one came from.

    Every document is searched with the same question and the best candidates of all of them are read together, so
    the closest passages win wherever they are. One document may supply at most `per_doc` of them, so a long PDF cannot
    crowd out the others. Documents that have not been indexed yet are reported in `missing`, not treated as errors.
    """
    query = data["query"]
    storage = data["storagePath"]
    docs = list(data.get("docs") or [])[:MAX_DOCS]
    total = int(data.get("k", 6))
    per_doc = int(data.get("perDoc", 3))

    loaded = []
    missing = []
    for d in docs:
        pdf_id = str(d.get("pdfId") or "")
        doc = _load(storage, pdf_id)
        if doc is None:
            missing.append(d.get("title") or pdf_id)
        elif doc["meta"]:
            loaded.append((d, pdf_id, doc))

    q_vec = _question_vector(query) if any(doc["modern"] for _, _, doc in loaded) else None
    pool = []
    for d, pdf_id, doc in loaded:
        for i, merged, meaning in _candidates(doc, query, q_vec, max(8, per_doc * 3)):
            pool.append((d, pdf_id, doc, i, merged, meaning))
    # without a cross-encoder, the merged rank decides (each document's best come first), then closeness in meaning
    pool.sort(key=lambda p: (-p[4], -p[5]))
    pool = pool[:POOL * 2]
    scores = rerank(query, [p[2]["meta"][p[3]]["text"] for p in pool[:POOL * 2]])
    if scores is not None:
        order = sorted(range(len(pool)), key=lambda n: -scores[n])
        pool = [pool[n] for n in order]
        scores = [scores[n] for n in order]

    chosen = []
    used = {}
    for n, (d, pdf_id, doc, i, merged, meaning) in enumerate(pool):
        if used.get(pdf_id, 0) >= per_doc:
            continue
        chunk = dict(doc["meta"][i])
        chunk.update({"doc": d.get("title") or "Untitled", "pdfId": pdf_id, "score": scores[n] if scores else merged})
        chosen.append(chunk)
        used[pdf_id] = used.get(pdf_id, 0) + 1
        if len(chosen) >= total:
            break
    return {"chunks": chosen, "missing": missing}
