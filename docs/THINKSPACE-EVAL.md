# Thinkspace chat: does it name the right document? (2026-10-29)

A Thinkspace chat reads several PDFs together. The risk that is new compared with one PDF is **wrong
attribution**: saying a document states something that only another document states. This evaluation
measures that directly.

## What was measured
Three short PDFs (`scripts/make-eval-corpus-spaces.js`) that overlap on purpose:
- *Operations Manual 2023* says lifeboat drills are every **30** days.
- *Safety Bulletin 2024* changes that to **14** days, sets an **8 minute** muster limit, and says fire extinguishers are now inspected **monthly** (the manual says every 6 months).
- *Port Authority Handbook* alone has the port fee (12,400 EUR) and the pilotage rule (mandatory above 150 m).

12 questions (`evals/space-questions.json`, runner `evals/run-space-eval.mjs`): a fact in one document,
a fact that exists in only one document, two documents that disagree, "which document says...", a
question where the right document must not be mixed up with another, things none of them say, general
knowledge in Documents-only mode, "summarise each", and "where do they disagree". A run passes only
if the answer is right, **cites the documents it should, and cites no document it should not**.

It runs in the real app with the real model (`gemini-3.5-flash-lite`) and the real backend.

## Results
| | |
|---|---|
| Questions that pass | **11 of 12** |
| Repeat run of the whole set | the same 11 pass (S1 failed both times) |
| Wrong attribution of a fact to the wrong document | **0** (the only flagged case is S1, below) |
| Fact present in only one document attributed to that document | 2 of 2 |
| Both sides of a disagreement reported and named | 2 of 2 (S3, S10), and the newer rule preferred when asked "now" (S11) |
| Questions the documents cannot answer, refused | 3 of 3 |
| Typical answer time | about 6 seconds |

Five repeat runs were lost to the model provider's rate limit (`429`), which the app now explains in plain
words; they were rerun and passed.

### The one failure (S1)
"What is the muster time limit?" is answered correctly (8 minutes, from the Safety Bulletin), but the
answer also brings in the Operations Manual, which only mentions the muster station, and says "the
documents provide differing time limits". A document that is silent is not a disagreement. A prompt rule
telling the model so did not fix it for this model. It is a mild fault (the fact and its source are right)
but it is the kind of thing that erodes trust, so it stays on the list.

## What changed in the product to make this work
- **Retrieval across documents** (`retrieval_multi`): every document is searched, hits are merged by
  closeness, and one document may supply at most three passages so a long PDF cannot crowd out the others.
  Documents that are not indexed yet are reported, not fatal.
- **Labelled sources**: every passage the model sees is tagged `[Document title, page N]`; the prompt
  requires citing in exactly that form and never attributing a statement to a document whose passage does not say it.
- **Citations are buttons**: `[Title, page N]` in an answer opens that PDF at that page.
- **Documents are indexed on demand**: a PDF never opened in the reader is read and indexed when the chat
  needs it, with a progress line.
- **Cross-document questions are always answers**: notes, highlights, mind maps and sticky notes belong to one
  document, so a Thinkspace question never routes to them.
- **Thinkspace instructions** apply to its chats, between the global and the chat's own.
- Chats are saved per Thinkspace and deleted with it; chats about a single PDF are untouched.

## Not covered
- Three tiny documents, one model. Real Thinkspaces have many long documents, scans, tables.
- Thirty documents (the retrieval limit is 12 documents per question).
- Follow-up questions across many turns, and other models (Ollama, OpenRouter).

## Re-running
```
node scripts/make-eval-corpus-spaces.js evals/corpus-spaces
node evals/run-space-eval.mjs --repeat 2
```
(app running with a working key and `--remote-debugging-port=9222`; the runner makes and removes its own Thinkspace)
