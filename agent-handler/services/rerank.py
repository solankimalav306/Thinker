"""A second, closer look at the best candidates: a cross-encoder reads the question together with each passage.

It is optional and never makes a question wait. The model (about 470 MB the first time) is loaded in the background,
started after a document is indexed; until it is ready, or if it cannot be loaded (no network, not enough memory),
the search simply keeps the order it already had.
"""
import os
import threading

RERANK_MODEL = os.environ.get("THINKER_RERANK_MODEL", "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1")
ENABLED = os.environ.get("THINKER_RERANK", "on").lower() not in ("off", "0", "false", "no")

_model = None
_state = "idle"          # idle | loading | ready | failed
_lock = threading.Lock()


def _load():
    global _model, _state
    try:
        from sentence_transformers import CrossEncoder
        _model = CrossEncoder(RERANK_MODEL, max_length=512)
        _state = "ready"
    except Exception as error:   # keep working without it
        _state = "failed"
        print(f"[rerank] unavailable, keeping the search order: {error}", flush=True)


def warm():
    """Start loading the model in the background, once."""
    global _state
    if not ENABLED:
        return
    with _lock:
        if _state != "idle":
            return
        _state = "loading"
    threading.Thread(target=_load, daemon=True, name="rerank-load").start()


def ready():
    return _state == "ready"


def rerank(query, texts):
    """Scores for `texts` against `query` (higher is better), or None when reranking is off, still loading or unavailable."""
    if not ENABLED or len(texts) < 2:
        return None
    if _state == "idle":
        warm()
    if _state != "ready":
        return None
    try:
        return [float(s) for s in _model.predict([(query, t) for t in texts], batch_size=16, show_progress_bar=False)]
    except Exception as error:
        print(f"[rerank] failed, keeping the search order: {error}", flush=True)
        return None
