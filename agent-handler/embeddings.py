"""The embedding model: loaded on first use (so the app starts fast), vectors are unit length so a dot product is a cosine.

Passages and questions take different prefixes, and each model has its own. An index remembers which model made it,
so a question is always embedded the way the index was.
"""
import os

DEFAULT_MODEL = os.environ.get("THINKER_EMBED_MODEL", "intfloat/multilingual-e5-base")

# model -> (prefix for a question, prefix for a passage)
PREFIXES = {
    "intfloat/multilingual-e5-base": ("query: ", "passage: "),
    "intfloat/multilingual-e5-small": ("query: ", "passage: "),
    "intfloat/multilingual-e5-large": ("query: ", "passage: "),
    "BAAI/bge-base-en-v1.5": ("Represent this sentence for searching relevant passages: ", ""),
    "BAAI/bge-m3": ("", ""),
}

_models = {}


def _load(name):
    if name not in _models:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(name)
        model.max_seq_length = 512
        _models[name] = model
    return _models[name]


def query_prefix(model=DEFAULT_MODEL):
    return PREFIXES.get(model, ("", ""))[0]


def passage_prefix(model=DEFAULT_MODEL):
    return PREFIXES.get(model, ("", ""))[1]


def embed(texts, model=DEFAULT_MODEL):
    """Unit-length float32 vectors for already-prefixed texts."""
    return _load(model).encode(list(texts), batch_size=16, normalize_embeddings=True, show_progress_bar=False).astype("float32")
