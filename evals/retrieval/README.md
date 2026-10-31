# Retrieval benchmark

Measures how often the passages handed to the model hold the evidence that answers a question. No model call is
needed to score it, so it is cheap to rerun after any change to chunking, search or ranking.

1. `curl -L -o pdfs/<id>.pdf https://arxiv.org/pdf/<id>` for 2307.09288 2005.11401 1810.04805 1512.03385 1412.6980 1706.03762 2310.06825 2401.15884
2. `node extract.mjs <this folder>`: page text two ways, joined as the old reader did (`flat`) and with line breaks (`lines`).
3. `questions.json` is committed (124 questions written by the app's model from random passages, each with a verbatim
   evidence quote that was checked against the page). `node genq.mjs <folder> <debug port>` writes a new set through a
   running Thinker (its key never leaves the app).
4. `python prod_bench.py lines off` runs the app's real indexing and retrieval services; `... lines on` adds the reranker.
   `bench.py` plus `exp1..4.py` are the prototypes used to choose the design (chunk size, BM25, models, rerankers).

Scores: `span@k` = the evidence is inside one of the top k passages (at least 85% of its words, on its page);
`page@k` = a top-k passage is on the right page; `mrr` = 1 / rank of the first span hit; `words` = words sent to the model.

Follow-ups: `node genfollow.mjs <folder> <debug port>` writes `followups.json` (committed); `python follow_bench.py off`
compares searching a follow-up alone with searching it behind the previous question.
