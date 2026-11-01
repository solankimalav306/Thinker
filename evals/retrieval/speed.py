"""How fast can passages be embedded, and what does each speed-up cost in quality?
Fidelity = mean cosine between a variant's vectors and the full-precision e5-base vectors of the same passages."""
import json, os, sys, time
sys.path.insert(0, "C:/code/SmartPDFReader/agent-handler")
import numpy as np, torch
from utils.chunking import chunk_pages, embed_text
from sentence_transformers import SentenceTransformer

HERE = os.path.dirname(os.path.abspath(__file__))
doc = json.load(open(os.path.join(HERE, "docs", "2307.09288.json"), encoding="utf-8"))
chunks = chunk_pages([{"page": p["page"], "text": p["lines"]} for p in doc["pages"]])[:160]
texts = ["passage: " + embed_text(c) for c in chunks]
print(len(texts), "passages,", sum(len(t.split()) for t in texts) // len(texts), "words each", flush=True)
BASE = "intfloat/multilingual-e5-base"


def load(name, quant=False):
    m = SentenceTransformer(name)
    m.max_seq_length = 512
    if quant:
        m = torch.quantization.quantize_dynamic(m, {torch.nn.Linear}, dtype=torch.qint8)
    return m


def run(label, model, ref=None, **kw):
    model.encode(texts[:8], normalize_embeddings=True, show_progress_bar=False)   # warm up
    t = time.time()
    v = model.encode(texts, normalize_embeddings=True, show_progress_bar=False, **kw)
    s = time.time() - t
    fid = "" if ref is None else f"fidelity {float((v * ref).sum(1).mean()):.4f}"
    print(f"{label:<44} {s:6.1f}s  {1000*s/len(texts):5.0f} ms/passage  {fid}", flush=True)
    return v


m = load(BASE)
for n in (4, 8, 12, 16):
    torch.set_num_threads(n)
    v = run(f"fp32 threads={n} batch16", m, batch_size=16)
    if n == 8:
        ref = v
torch.set_num_threads(8)
for b in (8, 32, 64):
    run(f"fp32 threads=8 batch{b}", m, ref, batch_size=b)
m.max_seq_length = 256
run("fp32 max_seq 256", m, ref, batch_size=16)
m.max_seq_length = 512
q = load(BASE, quant=True)
run("int8 dynamic quantisation", q, ref, batch_size=16)
del m, q
s = load("intfloat/multilingual-e5-small")
sv = run("e5-small fp32 (different model)", s, None, batch_size=16)
sq = load("intfloat/multilingual-e5-small", quant=True)
run("e5-small int8", sq, None, batch_size=16)
