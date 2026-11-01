# Where things stand and what is next (logged 2026-10-31, end of day)

`main` was pushed to GitHub (`solankimalav306/Thinker`) at 3.3.0. **Everything below is committed locally on `main` and NOT pushed.**
**Newest build 2026-11-01: `dist/Thinker Setup 3.4.1.exe`** (e5-small embeddings: indexing about 4x faster, same search quality; fix for questions asked while a document is still indexing). Full log of every benchmark: `docs/SESSION-LOG-2026-10-31.html` (also published as an artifact). **Since then (built into 3.4.2, pushed after this log):** whole-document requests now work as background jobs with progress and Stop, requests survive tab switches, and chats have Re-run, Edit and Fork: see `docs/WHOLE-DOCUMENT.md`. The two textbooks were rerun: 100% of the text read in 270 s, 178 questions answered.
Earlier build 2026-10-31: `dist/Thinker Setup 3.4.0.exe` (375 MB, `npm run release:minor`, package.json is 3.4.0) with everything below plus the About card
in Settings (`6793dc06`). The packaged `backend.exe` was smoke-tested on its own (index + exact-term query work, no errors); the installer itself
has not been run on a clean machine, and the first-run model downloads from the packaged app are untested.

## Done today, in order (commits after the 3.3.0 push)
| Commit | What |
|---|---|
| `266217f7` | Artifacts, new workflow: small list of kinds drawn from data (checklist, steps, quiz, flashcards, table, chart, diagram, timeline, document), separate identify/generate/check path in the agent, maths, saved progress |
| `06ea2a7f` | Artifacts open in a tab of their own from any chat; export menu (HTML, PDF, PNG, Word, PowerPoint); Save to Artifacts |
| `4ff1b758` | **Web pages, Claude-style**: a separate builder for full pages (notes sites, dashboards, trackers, calculators) with their own CSS and JavaScript; "add a quiz to it" re-sends the previous artifact; runs in a sealed script frame; citation chips read "Page N" |
| `e433775b` | Script pages export to PDF, PNG, Word and PowerPoint from a snapshot of the running page |
| `79167c0a` | Wand menu on every chat card: make slides / a report / a quiz / a web page from an artifact, or "Change this artifact: …" |
| `c9984334` | **Retrieval rebuilt** (chunking, keyword + meaning search, reranker, multilingual embeddings, follow-up-aware search) with a benchmark |

Details: `docs/ARTIFACTS.md` (kinds, "Web pages", the wand menu, safety model) and `docs/RETRIEVAL-EVAL.md` (method, every number, limits).

### Web pages: how it is secured (so nobody has to rediscover it)
- Frame `artifact-live.html`, sandbox `allow-scripts` only, header policy allows inline scripts and nothing else (`connect-src 'none'`,
  images as data only, no frames, forms, media, workers or eval). Main process: `will-frame-navigate` blocks leaving `thinker-artifact:`,
  WebRTC limited to proxied UDP, `webRequest` cancels any request started by an artifact frame to a non-artifact address.
- Heartbeat: a page silent for 9 s is removed with "Run it again". Verified in the real app: fetch and remote image blocked, state saved.
  **Not yet tried:** a deliberately hostile page (infinite loop, navigation attempt, WebRTC) against the watchdog and blocks.
- Script pages are deliberately **not shared with guests** (decision 2026-10-31). Pages with scripts export as: HTML as written;
  PDF/PNG/Word/PowerPoint from a cleaned snapshot (buttons and inputs are dropped).

### Retrieval: numbers to remember
Benchmark `evals/retrieval/` (124 questions, 7 papers): answer in top 3 **59.7% -> 88.7%**, 40% fewer words sent; follow-ups
**48.6% -> 91.9%**; 30-question chat eval 29/30 before and after (U3 "miss" is a grader false alarm), 22% fewer tokens.
Design: ~140-word overlapping sentence passages across page breaks, BM25 (words weigh 2x) + `multilingual-e5-base`, weighted RRF,
background `mmarco` cross-encoder, k=5 (8 across documents), previous question added to short/pointing questions. Old indexes are
searched by words until the document is reopened, then rebuilt. Env switches: `THINKER_RERANK=off`, `THINKER_EMBED_MODEL=...`.

## Still to do (priority order)
1. **Push** (the installer is built, see the top; check a clean-machine install first). `backend.exe` is built with PyInstaller (`backend.spec`, `npm run release`): check the new modules
   (`utils/bm25.py`, `utils/followup.py`, `services/rerank.py`) are bundled, and that `intfloat/multilingual-e5-base` and the reranker
   download/work from the packaged app (first use now downloads about 1.1 GB + 0.5 GB; decide whether to show progress or bundle).
   Bump the version. Ask before pushing.
2. **Hostile test of the script frame** (see above) and decide whether the "runs its own code" note on cards is enough.
3. **Real-document check of the new search** on the user's own PDFs (the CS-MRI report, scanned and table-heavy files) and the new web-page builder on it;
   the benchmark used English arXiv papers only.
4. Retrieval ideas not done: model-written context per passage at indexing time, model-based query rewriting (HyDE / multi-query),
   OCR and table/equation extraction for scans, a larger reranker, answer-level evaluation on more documents and models.
5. Artifacts: the wand menu uses the chat's *latest* artifact, not necessarily the card clicked; it is absent inside an opened tab;
   the pie chart has only been seen in code; Help topic and screenshots are not updated; guests cannot draw data-based artifacts
   (only page-style ones); exports of every data kind (PDF/PNG/Word/PPT) checked one by one.
6. Not requested yet: encrypting LAN sharing; Thinkspace-wide features beyond what exists.

## Working notes
- The user's Gemini key is **free tier (15 requests a minute)**: run chat evals with `sh evals/run-paced.sh <out> <ids> <ids> ...`.
- The key is encrypted in the main process (`secrets.js`); never read it. For model calls in scripts use `window.electronAPI.askLLM`
  through a running app on a debug port (`evals/retrieval/genq.mjs` does).
- Test commands: `node --test` (224 tests, 1 skipped), `agent-handler` pytest (`venv/Scripts/python -m pytest agent-handler/tests -q`, 115).
  Python tests set `THINKER_RERANK=off` in `tests/conftest.py` so none loads a model.
- The Bash tool collapses backslashes in code: write regex/escape code with the Write or Edit tools or a Python patch file.
- A hidden Electron window stalls rendering: call `Page.captureScreenshot` over CDP to force frames. Eval instances run on
  `--user-data-dir=<scratchpad>/userdata-eval` (has the real key) on ports 9222/9226.
