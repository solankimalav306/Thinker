from embeddings import embed
from db.faiss_store import load_index, search
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