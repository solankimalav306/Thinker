import faiss
import os
import numpy as np

def create_index(dim):
    # inner product on unit-length vectors is the cosine similarity: larger is closer
    return faiss.IndexFlatIP(dim)

def save_index(index, path):
    faiss.write_index(index, path)

def load_index(path):
    if os.path.exists(path):
        return faiss.read_index(path)
    return None

def add_vectors(index, vectors):
    index.add(np.array(vectors))

def search(index, query_vec, k=5):
    D, I = index.search(query_vec, k)
    return I[0]

def search_with_scores(index, query_vec, k=5):
    """Like search, but also returns each hit's score and drops empty slots. For an inner-product index larger is closer;
    for an older L2 index smaller is closer (see is_similarity)."""
    if index.ntotal == 0:
        return []
    D, I = index.search(query_vec, min(k, index.ntotal))
    return [(float(d), int(i)) for d, i in zip(D[0], I[0]) if int(i) >= 0]

def is_similarity(index):
    return getattr(index, "metric_type", None) == faiss.METRIC_INNER_PRODUCT
