import json, sys
from bench import *
BGE = "BAAI/bge-base-en-v1.5"
W = lambda n, o, h=True: (lambda d: chunk_window(d, n, o, header=h, title=d["id"]))
def flatdoc(fn):
    return lambda d: fn({"id": d["id"], "pages": [dict(p, lines=p["flat"]) for p in d["pages"]]})
base = dict(chunker=W(120, 30), embedder=BGE, bm25=True, stem=True, weights=[1, 2])
exps = [
    dict(name="F0 bge-base+BM25 w2 (reference)", **base),
    dict(name="F1 + ms-marco-MiniLM-L6 rerank/20", rerank="cross-encoder/ms-marco-MiniLM-L-6-v2", pool=20, **base),
    dict(name="F2 + bge-reranker-base rerank/20", rerank="BAAI/bge-reranker-base", pool=20, **base),
    dict(name="F3 + mmarco-mMiniLM rerank/20", rerank="cross-encoder/mmarco-mMiniLMv2-L12-H384-v1", pool=20, **base),
    dict(name="F4 bge-m3+BM25 + bge-reranker-base/20", rerank="BAAI/bge-reranker-base", pool=20, **dict(base, embedder="BAAI/bge-m3")),
    dict(name="F5 reference on FLAT text (as app extracts)", **dict(base, chunker=flatdoc(W(120, 30)))),
    dict(name="F6 reference, no title|heading header", **dict(base, chunker=W(120, 30, False))),
    dict(name="F7 reference, 160w/40", **dict(base, chunker=W(160, 40))),
    dict(name="F8 reference, 100w/25", **dict(base, chunker=W(100, 25))),
]
sel = sys.argv[1:]
out = []
for e in exps:
    if sel and not any(e["name"].startswith(s) for s in sel):
        continue
    try:
        r = run(e); show(r); out.append(r)
    except Exception as ex:
        print(e["name"], "FAILED", type(ex).__name__, str(ex)[:300], flush=True)
json.dump(out, open(os.path.join(HERE, "exp3.json"), "w"), indent=1)
