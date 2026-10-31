import json, sys
from bench import *

BGE = "BAAI/bge-base-en-v1.5"
exps = [
    # what the app does today
    dict(name="A0 current (page chunks, passage:/query:, L2)", chunker=chunk_current, embedder=BGE, legacy_prefix=True, qprefix="query: ", metric="l2"),
    # same chunks, the prefixes BGE really wants
    dict(name="A1 current chunks + correct BGE prefixes", chunker=chunk_current, embedder=BGE),
    # smaller overlapping chunks, same model
    dict(name="B1 window 200w/40 overlap, plain", chunker=lambda d: chunk_window(d, 200, 40, header=False), embedder=BGE),
    dict(name="B2 window 200w/40 + title|heading header", chunker=lambda d: chunk_window(d, 200, 40, header=True, title=d["id"]), embedder=BGE),
    dict(name="B3 window 120w/30 + header", chunker=lambda d: chunk_window(d, 120, 30, header=True, title=d["id"]), embedder=BGE),
    dict(name="B4 window 300w/60 + header", chunker=lambda d: chunk_window(d, 300, 60, header=True, title=d["id"]), embedder=BGE),
    # hybrid
    dict(name="C1 B2 + BM25 hybrid (RRF)", chunker=lambda d: chunk_window(d, 200, 40, header=True, title=d["id"]), embedder=BGE, bm25=True),
    dict(name="C2 current chunks + BM25 hybrid", chunker=chunk_current, embedder=BGE, bm25=True),
    dict(name="C3 BM25 only (B2 chunks)", chunker=lambda d: chunk_window(d, 200, 40, header=True, title=d["id"]), embedder=BGE, bm25=True, dense=False),
]
sel = sys.argv[1:]
out = []
for e in exps:
    if sel and not any(e["name"].startswith(s) for s in sel):
        continue
    r = run(e)
    show(r)
    out.append(r)
json.dump(out, open(os.path.join(HERE, "exp1.json"), "w"), indent=1)
