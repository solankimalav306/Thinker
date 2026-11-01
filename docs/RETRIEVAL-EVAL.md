# Chunking and retrieval: evaluation and rebuild (2026-10-31)

## What the app did before
- **Chunking**: each page was cut into 1, 2 or 3 equal slices by word count (under 200 words: one, under 600: two, else three).
  No overlap, no sentence or heading awareness, a page was never joined to the next one, and the text arrived with every
  line break removed (pieces of text joined with a space), so a heading, a running title and a page number were all just words.
- **Search**: one embedding model (`bge-base-en-v1.5`, English only) with the wrong prefixes (`passage:` / `query:` belong to
  E5 models, not BGE), vectors not normalised, an L2 index; the closest 3 slices, or **1 or 2 when the question resembled the
  chat's summary** (so follow-ups fetched the least).
- **No keyword search**: a name, a number or an acronym only matched if the meaning search happened to like it.
- A follow-up ("and what about its cost?") was searched as written, with no context.

## How it was measured
`evals/retrieval/` (see its README). 7 real papers (179 pages, about 104k words: Llama 2 at 77 pages, RAG, BERT, ResNet, Adam,
Mistral and one more), 124 questions written by the app's model from random passages (direct, paraphrased, and detail
questions), each with a verbatim evidence quote that was checked against the page. A question is answered by retrieval when
a top-k passage holds the quote (at least 85% of its words) on the right page: **span@k**. Page hit, MRR and the number of
words handed to the model are reported too. No model answers anything in this benchmark, so it is cheap and exact.

## Results (answer found in the top 3 / top 5 / top 8, % of questions)
| System | @3 | @5 | @8 | words sent @5 | notes |
|---|---|---|---|---|---|
| **Before** (page slices, bge-base, L2) | 59.7 | 68.5 | 77.4 | 1,199 | measured with the real old code |
| same, correct BGE prefixes | 58.1 | 66.9 | 79.0 | 1,192 | the prefix error cost little |
| overlapping sentence windows 120 words, bge-base | 66.1 | 76.6 | 81.5 | 693 | smaller passages: same recall, 40% fewer words |
| keyword search (BM25) alone, 120 words | 79.8 | 87.9 | 90.3 | 693 | **beats the embedding search on this set** |
| bge-base + BM25 | 80.6 | 87.9 | 92.7 | 687 | |
| multilingual-e5-base alone | 76.6 | 82.3 | 87.9 | 684 | multilingual, same speed as bge-base |
| multilingual-e5-base + BM25 | 83.1 | 87.9 | 91.1 | 782 | |
| bge-m3 alone | 79.8 | 87.1 | 90.3 | 701 | indexing 4x slower, 2.2 GB model |
| bge-m3 + BM25 | 83.9 | 91.1 | 94.4 | 690 | best without a reranker, too heavy |
| e5-base + BM25 + MiniLM-L6 reranker | 83.9 | 89.5 | 93.5 | 785 | English only |
| e5-base + BM25 + mmarco reranker | 83.9 | 89.5 | 92.7 | 796 | multilingual, 1.2 s |
| e5-base + BM25 + bge-reranker-base | 87.1 | 90.3 | 94.4 | 790 | 4.8 s a question on this CPU |
| bge-m3 + BM25 + bge-reranker-base | 88.7 | 93.5 | 95.2 | 693 | best seen; 6 GB of models, 3 s |
| **Shipped, measured with the real services** (e5-base + BM25 + mmarco reranker, structured text; later swapped to e5-small, see Indexing speed) | **88.7** | **91.9** | **93.5** | **725** | MRR 0.81 (was 0.50); 72 ms a question without the reranker, about 1.2 s with it |

Other findings: text with line breaks (headings, running titles removed) is slightly better than the old flat text (85.5 vs
83.9 at 3, 0.731 vs 0.711 MRR); chunk size from 100 to 300 words is a wash within noise (±3 points on 124 questions), so
about 140 words with 35 words of overlap was chosen for cost; adding the heading to the embedded text is a wash.

## What changed
- `utils/chunking.py`: sentence-aware passages of about 140 words with 35 words of overlap, running across page breaks
  (every passage lists its pages and where each page begins, so a quotation is still labelled with the right page), breaking at
  section headings, keeping the heading with the passage, dropping running headers/footers and page numbers (unless that would
  drop most of the document), joining hyphenated line ends, not splitting after "et al.", "Fig." and the like, cutting a run-on
  line (a table, an unpunctuated list) into windows. Works on text with no line breaks too.
- `embeddings.py`: `multilingual-e5-small` since 2026-11-01 (first shipped as -base; handles Hindi and other languages the old one could not), correct prefixes per model,
  unit vectors with an inner-product index, loaded on first use instead of at startup.
- `utils/bm25.py` and `services/retrieval.py`: keyword search (plain, no extra dependency; works on any script) merged with the
  meaning search by weighted reciprocal-rank fusion (words count double: measured), then an optional cross-encoder
  (`services/rerank.py`, loads in the background after indexing and never makes a question wait; if it cannot load, the merged
  order is used). Across Thinkspace documents the candidates of all documents are read together, still capped per document.
- An index made by the old chunker is rebuilt when its document is opened (or used in a Thinkspace), and until then it is
  searched by words only, so nothing breaks and nothing is lost.
- `renderer/js/page-text.js`: the reader now sends each page with its lines (baselines, end-of-line marks, gaps as spaces).
- `graph.py`: five passages instead of three, eight across documents; the "fetch one passage when the question resembles the
  chat" shortcut is gone; a passage that crosses a page break is shown to the model as two parts, each under its own page.
- `utils/followup.py`: a short or pointing question ("and what about the Meridian?", "explain this") is searched together with the
  selected text and the previous question.
- 23 new Python tests (chunker, keyword search, hybrid search, old-index fallback and rebuild, follow-ups, page labels) and 3 for the line text.

## Indexing speed (2026-11-01)
Cause of the wait: turning every passage into a vector on the CPU (about 151 ms a passage with e5-base). Measured on 160 real passages
(`evals/retrieval/speed.py`, 16 logical cores):

| Variant | s for 160 | ms a passage | similarity to full precision |
|---|---|---|---|
| e5-base, 4 / 8 / 12 / 16 threads | 35.2 / 24.1 / 19.5 / 21.5 | 220 / 151 / 122 / 134 | |
| e5-base, batch 8 / 32 / 64 | 21.1 / 22.3 / 24.3 | 132 / 139 / 152 | 1.000 |
| e5-base, passages capped at 256 tokens | 17.2 | 107 | 0.997 (adopted) |
| e5-base, int8 quantisation | 13.6 | 85 | 0.897 (rejected: changes the vectors too much) |
| e5-small | 7.1 | 44 | different model |
| e5-small, int8 | 5.2 | 32 | not tried: quality risk |

Real services on the 7-paper benchmark (930 passages, reranker off): e5-base took 232 s, **e5-small 57 s** (45 s with the 256-token cap),
with the same search quality: top 3 85.5% vs 85.5%, top 5 87.9% vs 89.5%, MRR 0.737 vs 0.731. With the reranker on, e5-small:
**87.9 / 91.1 / 93.5** at 3 / 5 / 8, MRR 0.805 (e5-base: 88.7 / 91.9 / 93.5, 0.813): the difference is noise on 124 questions.
**Shipped: e5-small, 256-token cap.** Two textbooks of 250 pages each took 210 s to index with e5-base; expect about a quarter of that.
Also from this work: questions asked while a document is still being indexed are answered by word search at once (passages are saved
before the vectors are computed), and the reader says "Getting this document ready for questions…".

## Follow-up questions
37 follow-ups ("Why is having a smaller one a desirable property?", "What about the stepsize?") each written to depend on an
earlier question and answered by a passage on the same page (`evals/retrieval/genfollow.mjs`, `follow_bench.py`):

| Searched | @3 | @5 | MRR |
|---|---|---|---|
| as written (what the app did) | 48.6 | 62.2 | 0.43 |
| with the previous question in front (now) | **91.9** | **97.3** | **0.83** |

These follow-ups stay on the passage of the earlier question, which is the usual case but not the only one: a person who
changes topic with a short question is searched with the old topic attached. Sentences with no pointing word and more than
six words are searched as written, so a clean new question is never muddied.

## End-to-end chat evaluation (30 questions, `evals/run-eval.mjs`, the real app and key)
**29 / 30 correct, the same as before the rebuild (29 / 30)**, with the right page retrieved for 17 of 18 checked questions and
about 914 tokens an answer (was 1,166, 22% fewer). The one miss, U3 ("port fee at Hamburg", not in the document), is a grader false
alarm: the answer correctly says the document does not list Hamburg and then names the fees of the ports it does list; the
pattern for "unanswerable" forbids any fee figure. It passed before only because the old search happened not to return that page.
The run used `evals/run-paced.sh` (batches of five with a pause), because a free-tier key allows 15 model requests a minute.
Old indexes were rebuilt on first open during this run, so the upgrade path was exercised too.

## Two textbooks in a Thinkspace (2026-11-01): a known gap
Think Python (about 250 pages) and Think Stats (about 200 pages) in one Thinkspace; both indexed in 210 s. Request: "Make an artifact
with notes from both books and give answers to all the questions in them. Analyse the pattern of the questions too."
Result (8 s): a three-section document of about 1,300 characters built from **9 passages** (Think Stats p. 6, 8, 35, 146; Think Python
p. 7, 76, 77, 148, 151). It had a few notes and a short, generic "question analysis", and **no answers to the questions of the books**.
Cause: the agent searches, takes the best 8 passages (4 per document) and writes from them; a request about *every* question in
*whole* books needs a different workflow (read each chapter in turn, collect the exercises, answer them in batches, then assemble and
analyse), which does not exist yet. Plan: detect whole-document requests, go through the document by chapter in rate-limit-aware
batches with visible progress, then build the artifact from the collected material.

## Honest limits
- 124 questions on 7 English papers: differences of 3 points or less are noise. The questions were written by a model that
  saw the passage, so they share words with it; that favours keyword search. The real gain from the meaning search is
  probably under-stated, and the reranker's gain on harder, vaguer questions too.
- The benchmark measures finding the passage, not the final answer; the end-to-end chat evaluation above is one document and 30 questions.
- Scanned PDFs without text, equations, tables as tables, and figures are not searched properly: that needs OCR and layout
  extraction, not a better chunker.
- First use downloads two models: the embedding model (about 0.5 GB) and, in the background, the reranker (0.5 GB).
  Set `THINKER_RERANK=off` to skip the second, or `THINKER_EMBED_MODEL=intfloat/multilingual-e5-base` for the larger one.
- Indexing a 150k-word document: see Indexing speed. It runs in the background and the document can be questioned by words from the first second.

## What "state of the art" would still add (not done)
1. **Contextual passages**: have the model write a one-sentence situating context for every passage at indexing time (the
   published gain is roughly a third fewer misses on top of hybrid search); costs a model call per passage.
2. **Query rewriting by the model** (HyDE or multi-query) for vague questions; the follow-up handling here is heuristic.
3. **Late-interaction or multi-vector models** (ColBERT, bge-m3 multi-vector) and a larger reranker; 5x the cost on a CPU.
4. **OCR and layout-aware extraction** (tables, equations, columns, scans).
5. **Answer-level evaluation** at scale (this is a retrieval benchmark), several models, repeated runs.
