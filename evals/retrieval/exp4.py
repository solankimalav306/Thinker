import json, sys
from bench import *
E5 = "intfloat/multilingual-e5-base"
W = lambda n, o, h=True: (lambda d: chunk_window(d, n, o, header=h, title=d["id"]))
base = dict(chunker=W(140, 35), embedder=E5, bm25=True, stem=True, weights=[1, 2])
exps = [
    dict(name="G0 e5-base dense only 140/35", chunker=W(140, 35), embedder=E5),
    dict(name="G1 e5-base + BM25 w2", **base),
    dict(name="G1b e5-base + BM25 w1", **dict(base, weights=[1, 1])),
    dict(name="G2 + mmarco-mMiniLM rerank/20", rerank="cross-encoder/mmarco-mMiniLMv2-L12-H384-v1", pool=20, **base),
    dict(name="G3 + MiniLM-L6 rerank/20", rerank="cross-encoder/ms-marco-MiniLM-L-6-v2", pool=20, **base),
    dict(name="G4 + bge-reranker-base rerank/20", rerank="BAAI/bge-reranker-base", pool=20, **base),
    dict(name="G5 + mmarco rerank/12", rerank="cross-encoder/mmarco-mMiniLMv2-L12-H384-v1", pool=12, **base),
    dict(name="G6 + mmarco rerank/30", rerank="cross-encoder/mmarco-mMiniLMv2-L12-H384-v1", pool=30, **base),
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
json.dump(out, open(os.path.join(HERE, "exp4.json"), "w"), indent=1)
