"""Runs the real indexing and retrieval services of the app on the benchmark."""
import json, os, re, shutil, sys, tempfile, time
sys.path.insert(0, "C:/code/SmartPDFReader/agent-handler")
mode = sys.argv[1]            # flat | lines
rer = sys.argv[2] if len(sys.argv) > 2 else "off"
os.environ["THINKER_RERANK"] = rer
from services import indexing, retrieval
HERE = os.path.dirname(os.path.abspath(__file__))
docs = {f[:-5]: json.load(open(os.path.join(HERE, "docs", f), encoding="utf-8")) for f in os.listdir(os.path.join(HERE, "docs"))}
qs = json.load(open(os.path.join(HERE, "questions.json"), encoding="utf-8"))
store = tempfile.mkdtemp()
toks = lambda s: re.findall(r"[a-z0-9]+", s.lower())
t0 = time.time(); nchunks = 0
for did in sorted({q["doc"] for q in qs}):
    pages = [{"page": p["page"], "text": p["flat" if mode == "flat" else "lines"]} for p in docs[did]["pages"]]
    r = indexing.indexing_service({"pages": pages, "storagePath": store, "pdfId": did})
    nchunks += r.get("chunks", 0)
print(f"indexed in {time.time()-t0:.0f}s, {nchunks} passages")
res = {k: {"span": 0, "page": 0, "mrr": 0.0, "words": 0} for k in (3, 5, 8)}
lat = []
for q in qs:
    t1 = time.time()
    out = retrieval.retrieval_service({"query": q["question"], "pdfId": q["doc"], "storagePath": store, "k": 8})["chunks"]
    lat.append(time.time() - t1)
    ev = toks(q["evidence"]); first = None
    for r, c in enumerate(out):
        have = set(toks(c["text"]))
        if set(c["pages"]) & set(q["pages"]) and sum(1 for w in ev if w in have) / len(ev) >= 0.85:
            first = r + 1; break
    for k in res:
        top = out[:k]
        res[k]["page"] += any(set(c["pages"]) & set(q["pages"]) for c in top)
        if first and first <= k: res[k]["span"] += 1; res[k]["mrr"] += 1 / first
        res[k]["words"] += sum(len(c["text"].split()) for c in top)
n = len(qs)
print(f"PROD {mode} rerank={rer}: " + " | ".join(f"@{k} span {100*res[k]['span']/n:.1f} page {100*res[k]['page']/n:.1f} mrr {res[k]['mrr']/n:.3f} words {res[k]['words']//n}" for k in res) + f" | {1000*sum(lat)/len(lat):.0f} ms/query")
shutil.rmtree(store, ignore_errors=True)
