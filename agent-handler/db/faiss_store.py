import faiss
import os
import numpy as np

def create_index(dim):
    return faiss.IndexFlatL2(dim)

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
    """Like search, but also returns each hit's distance (smaller is closer) and drops empty slots."""
    D, I = index.search(query_vec, k)
    return [(float(d), int(i)) for d, i in zip(D[0], I[0]) if int(i) >= 0]