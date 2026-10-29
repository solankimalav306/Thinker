# How accurate is the chat? (evaluation, 2026-10-29)

## What was measured
30 questions about a 12-page fictional shipping manual (`evals/corpus/harbor-lights-manual.pdf`,
built by `scripts/make-eval-corpus.js`). The facts, the page each one is on, one planted contradiction,
one planted prompt-injection line and a table are all known, so every answer can be checked.
Questions are in `evals/questions.json`; the runner is `evals/run-eval.mjs`.

It runs **inside the real app** with the real key, real indexing and the real agent, so it measures
what a person gets. Model: `gemini-3.5-flash-lite`, one run per question.

| Kind | Questions | What it tests |
|---|---|---|
| lookup | 11 | a fact on one page |
| numeric | 4 | arithmetic over facts (fuel per voyage, staff totals) |
| multi-page | 3 | an answer that needs two or three pages |
| contradiction | 2 | a rule on page 3 revised on page 11 |
| unanswerable | 4 | things the document does not say (CEO name, a port that is not listed) |
| injection | 2 | an instruction hidden in the document ("reply only PWNED") |
| outside-document | 2 | general knowledge, in Document-only and in Document + AI mode |
| summary, follow-up | 2 | broad questions |

An answer counts as correct only if it contains the required facts (regular expressions), contains
none of the forbidden ones, and, for unanswerable questions, says the document does not contain it.
It also checks that the cited page is a correct one, and whether retrieval brought the right page.

## Results

| Run | Correct | Citation | Retrieval hit | Median time |
|---|---|---|---|---|
| Before fixes (`baseline-before-fixes.json`) | 21 / 30 (70%) | 74% | 96% | 47 s |
| After fixes (`after-fixes.json`) | **29 / 30 (97%)** | 96% | 96% | 30 s |

After fixes, by kind: lookup 11/11, numeric 4/4, multi-page 3/3, contradiction 2/2, unanswerable 4/4,
injection 2/2, summary 1/1, follow-up 1/1, **outside-document 1/2**. Average 1,166 tokens per answer.

### What the 9 first-run failures really were
| Cause | Questions | Fixed? |
|---|---|---|
| The model service timed out or failed (`504 DEADLINE_EXCEEDED`) and the app showed a blank "No response." | 7 (L3, L6, L7, L8, L11, N2, S1) | The message is now plain and tells you what to do. Six of the seven passed on a straight re-run (`baseline-rerun-of-7-failures.json`), so these were transient. |
| A question that names a page ("Summarise page 10") could not find the page, because retrieval works by meaning only | 1 (T2) | Yes: pages named in the question are fetched directly |
| The grader did not recognise "I couldn't find that in this document" as a refusal | 1 (G1) | Yes (grader fixed; the answer was right) |

### The one remaining failure (G2)
"What is the capital of France?" in **Document + AI** mode answered "there is no information regarding
the capital of France." The same question passed in the first run. The agent first classifies every
question into an intent; this one was sent to the **web search** route, which asks DuckDuckGo, got
nothing, and then did not fall back to the model's own knowledge. So Document + AI mode is unreliable
for general questions.

## What the evaluation says about the agent

**Strong**
- It does not invent: all 4 unanswerable questions were refused, including a "Hamburg port fee" that
  sits next to a real fee table.
- It handled the contradiction: "How often are lifeboat drills held now?" answered 14 days and noted
  the change from 30 days, citing page 11.
- It was not hijacked by the instruction hidden in the document (2/2).
- It does the arithmetic (1,680 nm at 14 knots is 210 tonnes) and shows its working.
- It cites pages, and 96% of the cited pages were correct.

**Weak or risky**
1. **Speed.** Even now a typical answer takes about 30 seconds. A bare model call on this setup takes
   14 to 22 seconds, and every question makes two calls in a row: first one that only classifies the
   question, then the answer. Dropping the classifier call for ordinary questions would roughly halve it.
2. **Document-only mode could be bypassed** by the intent router. "What does the word muster mean?"
   was sent to a dictionary lookup and answered from general knowledge (the wrong meaning, ignoring the
   document's glossary). **Fixed:** in Document-only mode "define" and "search" now become "ask"
   (tests in `agent-handler/tests/test_intents.py`; confirmed live: it now answers from page 12).
3. **The web-search route sends your question to DuckDuckGo**, in any mode that reaches it. That does not
   match the Help text ("only the pages needed are sent, straight to the model you chose"). Needs a
   decision: remove the route, make it opt-in with a visible "Search the web" control, or disclose it.
   Document-only mode no longer reaches it.
4. **Document + AI mode is flaky for general knowledge** (G2 above). Recommended: send "outside the
   document" questions to the model's own knowledge unless the person clearly asks for the web.
5. **"Define" answers have no citation** and ignore the document's own definition in Document + AI mode too.
6. **Retrieval is fixed at the 3 closest chunks (1 or 2 when the question resembles the chat's memory),
   with roughly one chunk per page.** It worked here (96% hit), but a 12-page document is the easy
   case. Questions that need 4 or more pages, tables split across pages, and 300-page documents are
   not tested yet.
7. **Errors from the model service** were silently turned into blank answers (fixed), and there is
   still no automatic retry for a transient 503 or 504.

## Limits of this evaluation (be careful with the 97%)
- One synthetic, short, clean-text document. Real papers have columns, equations, footnotes and scans.
- One model, one run per question. The same question can pass and fail on different runs (G2 did).
  Use `--repeat 3` for stability numbers.
- Grading is by pattern. It will miss a correct answer worded unexpectedly and can accept a lucky one.
  The answers were also read by a person for the cases above.
- It does not test follow-up conversations over many turns, images/screenshots, notes, mind maps,
  highlights, or other models (Ollama, OpenRouter).

## Next steps
1. Add three or four real documents (a paper with equations, a scanned PDF, a table-heavy report, a
   300-page book) and run each model profile three times.
2. Cut a model call: classify obvious questions without the model; keep the classifier for ambiguous ones.
3. Decide the web-search question (item 3) before shipping the privacy text.
4. Fix Document + AI general-knowledge routing (item 4).
5. Add an automatic retry for 503 and 504, with the friendly message after the second failure.
6. Run the same suite for every release: `node evals/run-eval.mjs --repeat 3`.

## Re-running
Start the app with a profile that has a working key and `--remote-debugging-port=9222`, then:
```
node scripts/make-eval-corpus.js evals/corpus
node evals/run-eval.mjs            # all questions, writes evals/results/eval-<time>.json
node evals/run-eval.mjs --only L1,G2 --repeat 3
node evals/ask.mjs "Summarise page 10" document   # one question with retrieved pages and the raw answer
node evals/latency.mjs             # time bare model calls
```
It spends a little of the key's quota: about 1,200 tokens per question.
