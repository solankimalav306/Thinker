from embeddings import embed
from utils.chunking import chunk_text
from db.faiss_store import create_index, save_index, add_vectors
from db.metadata import save_metadata
import os

def indexing_service(data):
    pages = data["pages"]
    storage = data["storagePath"]
    pdf_id = data["pdfId"]

    os.makedirs(storage, exist_ok=True)

    index_path = os.path.join(storage, f"{pdf_id}.index")
    meta_path = os.path.join(storage, f"{pdf_id}.json")

    # prevent duplicate indexing
    if os.path.exists(index_path):
        return {"status": "already indexed", "pdfId": pdf_id}

    chunks = []

    for page in pages:
        page_chunks = chunk_text(page["text"])
        for chunk in page_chunks:
            if chunk.strip():
                chunks.append({
                    "text": chunk,
                    "page": page["page"],
                    "chunk_id": f"{page['page']}_{len(chunks)}"
                })

    texts = [c["text"] for c in chunks]

    # BGE format
    texts = ["passage: " + t for t in texts]

    embeddings = embed(texts).astype("float32")

    index = create_index(embeddings.shape[1])
    add_vectors(index, embeddings)

    save_index(index, index_path)
    print("INDEX SAVED AT:", index_path)
    save_metadata(meta_path, chunks)
    print("METADATA SAVED AT:", meta_path)

    return {"status": "indexed", "pdfId": pdf_id}