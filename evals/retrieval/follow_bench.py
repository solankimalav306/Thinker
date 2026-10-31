"""Do follow-up questions find their passage when searched alone, and when searched with the question before them?"""
import json, os, re, sys, time
sys.path.insert(0, "C:/code/SmartPDFReader/agent-handler")
os.environ["THINKER_RERANK"] = sys.argv[1] if len(sys.argv) > 1 else "off"
from services import indexing, retrieval
from utils.followup import retrieval_query
HERE = os.path.dirname(os.path.abspath(__file__))
store = os.path.join(HERE, "store"); os.makedirs(store, exist_ok=True)
docs = {f[:-5]: json.load(open(os.path.join(HERE, "docs", f), encoding="utf-8")) for f in os.listdir(os.path.join(HERE, "docs"))}
fu = json.load(open(os.path.join(HERE, "followups.json"), encoding="utf-8"))
for did in sorted({q["doc"] for q in fu}):
    indexing.indexing_service({"pages": [{"page": p["page"], "text": p["lines"]} for p in docs[did]["pages"]], "storagePath": store, "pdfId": did})
toks = lambda s: re.findall(r"[a-z0-9]+", s.lower())
def score(make):
    hit3 = hit5 = 0; mrr = 0.0
    for q in fu:
        msgs = [{"role": "user", "text": q["prev"]}, {"role": "assistant", "text": "(answer)"}, {"role": "user", "text": q["question"]}]
        out = retrieval.retrieval_service({"query": make(q, msgs), "pdfId": q["doc"], "storagePath": store, "k": 5})["chunks"]
        ev = toks(q["evidence"]); first = None
        for r, c in enumerate(out):
            have = set(toks(c["text"]))
            if set(c["pages"]) & set(q["pages"]) and sum(1 for w in ev if w in have) / len(ev) >= 0.85:
                first = r + 1; break
        if first: mrr += 1 / first; hit5 += 1; hit3 += first <= 3
    n = len(fu); return f"span@3 {100*hit3/n:.1f}  @5 {100*hit5/n:.1f}  mrr {mrr/n:.3f}"
print(len(fu), "follow-ups")
print("searched alone      :", score(lambda q, m: q["question"]))
print("with the earlier Q  :", score(lambda q, m: retrieval_query(q["question"], m)))
print("upper bound (full Q1 + Q2 always):", score(lambda q, m: q["prev"] + " " + q["question"]))
