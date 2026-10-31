"""Retrieval benchmark: how often does the top-k contain the passage that answers the question?

span_hit@k : some retrieved chunk holds the evidence quote (>=85% of its words, on a gold page)
page_hit@k : some retrieved chunk lies on a gold page
MRR        : 1 / rank of the first span hit
words@k    : average words handed to the model (the cost side)
"""
import hashlib, json, math, os, re, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, "C:/code/SmartPDFReader/agent-handler")
CACHE = os.path.join(HERE, "cache"); os.makedirs(CACHE, exist_ok=True)

DOCS = {}
for f in sorted(os.listdir(os.path.join(HERE, "docs"))):
    d = json.load(open(os.path.join(HERE, "docs", f), encoding="utf-8"))
    DOCS[d["id"]] = d
QUESTIONS = json.load(open(os.path.join(HERE, "questions.json"), encoding="utf-8"))


def toks(s):
    return re.findall(r"[a-z0-9]+", s.lower())


STOP = set("a an the of in on at to for and or is are was were be been being by with as that this these those it its from which what who whom how when where why do does did can could would should may might will shall than then so such not no into over under between about per via vs".split())


def stem(w):
    for suf, rep in (("ations", "ate"), ("ation", "ate"), ("ies", "y"), ("ing", ""), ("edly", ""), ("ed", ""), ("es", ""), ("ly", ""), ("s", "")):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            return w[: len(w) - len(suf)] + rep
    return w


def toks_s(s):
    return [stem(w) for w in toks(s) if w not in STOP]


# ---------------------------------------------------------------- chunkers
def chunk_current(doc):
    from utils.chunking import chunk_text
    out = []
    for p in doc["pages"]:
        for c in chunk_text(p["flat"]):
            if c.strip():
                out.append({"text": c, "pages": [p["page"]], "embed": c})
    return out


HEAD = re.compile(r"^(?:\d+(?:\.\d+)*\.?|[A-Z]\.|Appendix [A-Z]?)\s+[A-Z][^.!?]{2,80}$|^(?:Abstract|Introduction|Conclusions?|References|Acknowledg\w+|Related Work|Background|Method\w*|Experiments?|Results|Discussion)$")
SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\[“\"])")


def sentences_of(doc):
    """Sentences with the page each one is on, and the heading in force."""
    out = []
    heading = ""
    for p in doc["pages"]:
        text = p["lines"]
        text = re.sub(r"-\n(?=[a-z])", "", text)
        buf = []
        for line in text.split("\n"):
            s = line.strip()
            if HEAD.match(s) and len(s.split()) <= 12:
                if buf:
                    para = " ".join(buf); buf = []
                    out += [(x, p["page"], heading) for x in SENT.split(para) if x.strip()]
                heading = s
                continue
            buf.append(s)
        if buf:
            para = " ".join(buf)
            out += [(x, p["page"], heading) for x in SENT.split(para) if x.strip()]
    return out


def chunk_window(doc, target=200, overlap=40, header=True, title=""):
    sents = sentences_of(doc)
    chunks = []
    i = 0
    while i < len(sents):
        words = 0; j = i; cur = []
        while j < len(sents) and (words < target or not cur):
            cur.append(sents[j]); words += len(sents[j][0].split()); j += 1
        text = " ".join(s[0] for s in cur)
        pages = sorted({s[1] for s in cur})
        heading = cur[0][2]
        emb = (f"{title} | {heading}\n" if header and (title or heading) else "") + text
        chunks.append({"text": text, "pages": pages, "embed": emb, "heading": heading})
        if j >= len(sents):
            break
        # step back so the next chunk starts about `overlap` words earlier
        back = 0; k = j
        while k - 1 > i and back < overlap:
            k -= 1; back += len(sents[k][0].split())
        i = k if k > i else j
    return chunks


# ---------------------------------------------------------------- embedders
_models = {}
def embedder(name):
    if name in _models:
        return _models[name]
    from sentence_transformers import SentenceTransformer
    kw = {"trust_remote_code": True} if "gte-multilingual" in name else {}
    m = SentenceTransformer(name, **kw)
    m.max_seq_length = 512
    _models[name] = m
    return m


QPREFIX = {"BAAI/bge-base-en-v1.5": "Represent this sentence for searching relevant passages: ", "BAAI/bge-small-en-v1.5": "Represent this sentence for searching relevant passages: ",
           "BAAI/bge-large-en-v1.5": "Represent this sentence for searching relevant passages: ", "intfloat/multilingual-e5-base": "query: ", "intfloat/multilingual-e5-large": "query: ", "intfloat/multilingual-e5-small": "query: "}
PPREFIX = {"intfloat/multilingual-e5-base": "passage: ", "intfloat/multilingual-e5-large": "passage: ", "intfloat/multilingual-e5-small": "passage: "}


def embed_cached(name, texts, kind, legacy=False):
    key = hashlib.md5((name + kind + str(legacy) + "\n".join(texts)).encode("utf-8")).hexdigest()
    path = os.path.join(CACHE, key + ".npy")
    if os.path.exists(path):
        return np.load(path)
    m = embedder(name)
    t0 = time.time()
    v = m.encode(texts, batch_size=16, normalize_embeddings=True, show_progress_bar=False).astype("float32")
    print(f"   embedded {len(texts)} texts with {name} in {time.time()-t0:.0f}s", flush=True)
    np.save(path, v)
    return v


# ---------------------------------------------------------------- bm25
class BM25:
    def __init__(self, texts, k1=1.4, b=0.75, stemmed=False):
        self.k1, self.b = k1, b
        self.tk = toks_s if stemmed else toks
        self.docs = [self.tk(t) for t in texts]
        self.len = np.array([len(d) for d in self.docs], dtype="float32")
        self.avg = self.len.mean() if len(self.len) else 1
        df = {}
        self.tf = []
        for d in self.docs:
            c = {}
            for w in d:
                c[w] = c.get(w, 0) + 1
            self.tf.append(c)
            for w in c:
                df[w] = df.get(w, 0) + 1
        n = len(self.docs)
        self.idf = {w: math.log(1 + (n - v + 0.5) / (v + 0.5)) for w, v in df.items()}

    def scores(self, query):
        q = self.tk(query)
        s = np.zeros(len(self.docs), dtype="float32")
        for w in set(q):
            if w not in self.idf:
                continue
            idf = self.idf[w]
            for i, c in enumerate(self.tf):
                f = c.get(w)
                if f:
                    s[i] += idf * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.len[i] / self.avg))
        return s


def rrf(rank_lists, k=60, weights=None):
    score = {}
    for li, ranks in enumerate(rank_lists):
        w = (weights or [1] * len(rank_lists))[li]
        for r, i in enumerate(ranks):
            score[i] = score.get(i, 0) + w / (k + r + 1)
    return [i for i, _ in sorted(score.items(), key=lambda x: -x[1])]


# ---------------------------------------------------------------- rerankers
_rr = {}
def reranker(name):
    if name not in _rr:
        from sentence_transformers import CrossEncoder
        kw = {"trust_remote_code": True} if "gte-multilingual" in name else {}
        _rr[name] = CrossEncoder(name, max_length=512, **kw)
    return _rr[name]


# ---------------------------------------------------------------- evaluation
def covered(evidence, chunk_text):
    ev = toks(evidence)
    have = set(toks(chunk_text))
    return bool(ev) and sum(1 for w in ev if w in have) / len(ev) >= 0.85


def run(cfg, ks=(3, 5, 8)):
    name = cfg["name"]
    t_index = 0.0
    res = {k: {"span": 0, "page": 0, "mrr": 0.0, "words": 0} for k in ks}
    by_type = {}
    n = 0
    lat = []
    for doc_id in sorted({q["doc"] for q in QUESTIONS}):
        doc = DOCS[doc_id]
        t0 = time.time()
        chunks = cfg["chunker"](doc)
        texts = [c["embed"] for c in chunks]
        qs = [q for q in QUESTIONS if q["doc"] == doc_id]
        emb = None
        if cfg.get("dense", True):
            m = cfg["embedder"]
            ptxt = [PPREFIX.get(m, "") + t for t in texts] if not cfg.get("legacy_prefix") else ["passage: " + t for t in texts]
            emb = embed_cached(m, ptxt, "p", cfg.get("legacy_prefix", False))
            qtxt = [(cfg.get("qprefix", QPREFIX.get(m, ""))) + q["question"] for q in qs]
            qv = embed_cached(m, qtxt, "q", cfg.get("legacy_prefix", False))
        bm = BM25([c["embed"] for c in chunks], stemmed=cfg.get("stem", False)) if cfg.get("bm25") else None
        t_index += time.time() - t0
        for qi, q in enumerate(qs):
            t1 = time.time()
            lists = []
            if emb is not None:
                if cfg.get("metric") == "l2":
                    d = ((emb - qv[qi]) ** 2).sum(1)
                    dense_rank = list(np.argsort(d))
                else:
                    dense_rank = list(np.argsort(-(emb @ qv[qi])))
                lists.append(dense_rank[:50])
            if bm is not None:
                lists.append(list(np.argsort(-bm.scores(q["question"])))[:50])
            ranked = rrf(lists, weights=cfg.get("weights")) if len(lists) > 1 else lists[0]
            if cfg.get("rerank"):
                pool = ranked[: cfg.get("pool", 20)]
                sc = reranker(cfg["rerank"]).predict([(q["question"], chunks[i]["embed"] if cfg.get("rerank_header") else chunks[i]["text"]) for i in pool], batch_size=16, show_progress_bar=False)
                ranked = [pool[i] for i in np.argsort(-np.asarray(sc))] + ranked[len(pool):]
            lat.append(time.time() - t1)
            n += 1
            bt = by_type.setdefault(q["type"], {"n": 0, "span5": 0})
            bt["n"] += 1
            first = None
            for r, i in enumerate(ranked[:max(ks)]):
                if set(chunks[i]["pages"]) & set(q["pages"]) and covered(q["evidence"], chunks[i]["text"]):
                    first = r + 1
                    break
            for k in ks:
                top = ranked[:k]
                if any(set(chunks[i]["pages"]) & set(q["pages"]) for i in top):
                    res[k]["page"] += 1
                if first and first <= k:
                    res[k]["span"] += 1
                    res[k]["mrr"] += 1 / first
                res[k]["words"] += sum(len(chunks[i]["text"].split()) for i in top)
            if first and first <= 5:
                bt["span5"] += 1
    out = {"name": name, "n": n, "chunks_per_doc": None}
    for k in ks:
        out[f"span@{k}"] = round(100 * res[k]["span"] / n, 1)
        out[f"page@{k}"] = round(100 * res[k]["page"] / n, 1)
        out[f"mrr@{k}"] = round(res[k]["mrr"] / n, 3)
        out[f"words@{k}"] = round(res[k]["words"] / n)
    out["by_type_span@5"] = {t: round(100 * v["span5"] / v["n"]) for t, v in by_type.items()}
    out["ms/query"] = round(1000 * sum(lat) / len(lat), 1)
    out["index_s"] = round(t_index, 1)
    return out


def show(r):
    print(f"{r['name']:<46} span@3 {r['span@3']:>5} @5 {r['span@5']:>5} @8 {r['span@8']:>5} | page@5 {r['page@5']:>5} | mrr@5 {r['mrr@5']:.3f} | words@5 {r['words@5']:>5} | {r['by_type_span@5']} | {r['ms/query']}ms idx {r['index_s']}s", flush=True)
