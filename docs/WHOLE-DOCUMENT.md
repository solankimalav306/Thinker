# Whole-document requests, long jobs and chat basics (2026-11-01)

## The gap this closed
"Make an artifact with notes from both books and give answers to all the questions in them. Analyse the pattern of the questions too."
used to take the best 8 passages and write a 1,300-character document with no answers (see RETRIEVAL-EVAL.md, two textbooks).

## How it works now
- `utils/wholedoc.py` tells such a request from an ordinary question ("all the questions", "every chapter", "the whole book", "both books",
  "chapter by chapter" plus something to make or do). A request about one page, one paragraph or selected text is never one.
- The supervisor sends it to a `deep` step that starts a **background job** (`services/jobs.py`) and returns a ticket at once; the app
  follows the job (`/agent/job/<id>`), shows progress, and can stop it (`/agent/cancel`). No request has to fit inside one HTTP call.
- `services/deepread.py` groups the documents' passages, in order, into parts of 3,500 to 12,000 words kept to chapter boundaries (the
  parts grow instead of being dropped when there are many; only an enormous collection is sampled, and the overview says so). Each part is
  read by the model on its own and returns key points and every exercise with an answer and page (`"ai": true` when the book does not give
  the answer). Three threads, paced by an adaptive limiter: it starts at 24 calls a minute, halves when a provider says "too many requests"
  (a free Gemini key allows 15), waits the time the provider names, and speeds up again. A part that cannot be read is reported, not hidden.
- Plain code assembles the document (overview with coverage, pattern of the questions, questions per part, then one section per part), so
  its length never depends on one model reply. One more model call looks for the pattern in the questions. The result is a `document`
  artifact (up to 150 sections); with artifacts off it is markdown. The chat's memory keeps a one-line note, not the whole document.

## Measured
Think Python + Think Stats (about 450 pages) through the real app and a free Gemini key, twice:
| Run | Parts | Coverage | Time to read | Model calls | Tokens | Key points | Questions (worked out by the AI) |
|---|---|---|---|---|---|---|---|
| First (parts were sampled to fit) | 40 | 81% | 361 s | 42 | 235k | 269 | 161 (122) |
| After the fix (parts grow, nothing dropped) | 37 | **100%** | **270 s** | 40 | 288k | 260 | **178 (141)** |
Both had a grouped question-pattern analysis, 42 to 45 sections, and no rate-limit errors. Indexing the two books took 68 s with the small
model (13 s when already indexed).
Llama 2 (77 pages): 14 parts, 100% coverage; Llama 2 with BERT in a Thinkspace: 18 parts, 100% coverage.

## What the person sees
The "Thinking" line becomes, for example, "Reading Think Python, pp. 80-87 (part 12 of 30) (28%) · 31s. You can press Stop." in the reader
chat and the Thinkspace chat. Stop ends the job and its model calls.

## Switching tabs while a request runs
Both chats keep requests that are being answered in a registry by chat (`inflight` in chat-controller.js and space-chat.js). Switching
tabs, documents or chats rebuilds the window; the chat that is waiting shows its wait line again (with live progress and the Stop button)
and receives the answer when it arrives, and other chats stay usable meanwhile. Checked in the real app for both chats: after Home ->
Thinkspaces -> back, the line returned with progress and the finished artifact appeared.

## Chat basics (both chats)
- Under an **answer**: Copy, **Re-run** (ask the same question again; the new answer replaces this one), **Fork** (a new chat that starts as a
  copy of this one up to this message; the original is unchanged). Under a **question you sent**: **Edit** (the question goes back in the box,
  the chat is cut back to before it) and Copy.
- Re-run and Edit remove the messages after the point, after asking. Storage: `truncateMessages` and `forkConversation` in store.js.
- Not done: branching (keeping both versions of an answer side by side), pinning and renaming from the message row, regenerating with
  another model.

## Tests
Python 131, Node 225. New: whole-document detection, part planning (overlap removal, growth, sampling), pacing and retry, failed parts,
cancel, jobs; store truncate and fork (reader and Thinkspace chats).
