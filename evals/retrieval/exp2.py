import json, sys
from bench import *
BGE = "BAAI/bge-base-en-v1.5"
W = lambda n, o, h=True: (lambda d: chunk_window(d, n, o, header=h, title=d["id"]))
exps = [
    dict(name="D1 BM25 stem+stop, window120/30", chunker=W(120, 30), embedder=BGE, bm25=True, stem=True, dense=False),
    dict(name="D2 BM25 stem+stop, window200/40", chunker=W(200, 40), embedder=BGE, bm25=True, stem=True, dense=False),
    dict(name="D3 BM25 stem+stop, window80/20", chunker=W(80, 20), embedder=BGE, bm25=True, stem=True, dense=False),
    dict(name="D4 bge-base+BM25(stem) 120/30 rrf", chunker=W(120, 30), embedder=BGE, bm25=True, stem=True),
    dict(name="D5 same, bm25 weight 2", chunker=W(120, 30), embedder=BGE, bm25=True, stem=True, weights=[1, 2]),
    dict(name="E1 gte-multilingual-base dense 120/30", chunker=W(120, 30), embedder="Alibaba-NLP/gte-multilingual-base"),
    dict(name="E2 bge-m3 dense 120/30", chunker=W(120, 30), embedder="BAAI/bge-m3"),
    dict(name="E3 multilingual-e5-base dense 120/30", chunker=W(120, 30), embedder="intfloat/multilingual-e5-base"),
    dict(name="E4 bge-small dense 120/30", chunker=W(120, 30), embedder="BAAI/bge-small-en-v1.5"),
    dict(name="E5 gte-multi + BM25 rrf", chunker=W(120, 30), embedder="Alibaba-NLP/gte-multilingual-base", bm25=True, stem=True),
    dict(name="E6 bge-m3 + BM25 rrf", chunker=W(120, 30), embedder="BAAI/bge-m3", bm25=True, stem=True),
]
sel = sys.argv[1:]
out = []
for e in exps:
    if sel and not any(e["name"].startswith(s) for s in sel):
        continue
    try:
        r = run(e); show(r); out.append(r)
    except Exception as ex:
        print(e["name"], "FAILED", type(ex).__name__, str(ex)[:200], flush=True)
json.dump(out, open(os.path.join(HERE, "exp2.json"), "w"), indent=1)
