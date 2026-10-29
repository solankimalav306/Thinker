from embeddings import embed
from db.faiss_store import load_index, search, search_with_scores
from db.metadata import load_metadata
import os

def retrieval_service(data):
    query = data["query"]
    pdf_id = data["pdfId"]
    storage = data["storagePath"]
    k = data.get("k", 5)

    index_path = os.path.join(storage, f"{pdf_id}.index")
    meta_path = os.path.join(storage, f"{pdf_id}.json")

    index = load_index(index_path)
    if index is None:
        return {"error": "Index not found"}

    metadata = load_metadata(meta_path)

    # BGE requires this
    q_vec = embed(["query: " + query]).astype("float32")

    indices = search(index, q_vec, k=k)

    results = []
    for i in indices:
        if 0 <= i < len(metadata):
            results.append(metadata[i])

    return {"chunks": results}

def pages_service(data):
    """Chunks of whole pages, for questions that name a page."""
    pdf_id = data["pdfId"]
    storage = data["storagePath"]
    wanted = set(int(p) for p in data.get("pages", []))
    meta_path = os.path.join(storage, f"{pdf_id}.json")
    if not wanted or not os.path.exists(meta_path):
        return {"chunks": []}
    metadata = load_metadata(meta_path)
    return {"chunks": [m for m in metadata if m.get("page") in wanted]}


MAX_DOCS = 12


def retrieval_multi(data):
    """The best passages across several documents, with the document each one came from.

    Every document is searched with the same question, the hits are merged by closeness, and one
    document may supply at most `per_doc` of them, so a long PDF cannot crowd out the others.
    Documents that have not been indexed yet are reported in `missing`, not treated as errors.
    """
    query = data["query"]
    storage = data["storagePath"]
    docs = list(data.get("docs") or [])[:MAX_DOCS]
    total = int(data.get("k", 6))
    per_doc = int(data.get("perDoc", 3))

    q_vec = embed(["query: " + query]).astype("float32")
    hits = []
    missing = []
    for doc in docs:
        pdf_id = str(doc.get("pdfId") or "")
        index_path = os.path.join(storage, f"{pdf_id}.index")
        meta_path = os.path.join(storage, f"{pdf_id}.json")
        index = load_index(index_path) if pdf_id else None
        if index is None or not os.path.exists(meta_path):
            missing.append(doc.get("title") or pdf_id)
            continue
        metadata = load_metadata(meta_path)
        for distance, i in search_with_scores(index, q_vec, k=per_doc):
            if 0 <= i < len(metadata):
                chunk = dict(metadata[i])
                chunk.update({"doc": doc.get("title") or "Untitled", "pdfId": pdf_id, "score": distance})
                hits.append(chunk)

    hits.sort(key=lambda h: h["score"])
    chosen = []
    used = {}
    for hit in hits:
        if used.get(hit["pdfId"], 0) >= per_doc:
            continue
        chosen.append(hit)
        used[hit["pdfId"]] = used.get(hit["pdfId"], 0) + 1
        if len(chosen) >= total:
            break
    return {"chunks": chosen, "missing": missing}
