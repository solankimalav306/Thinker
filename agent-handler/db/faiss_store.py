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