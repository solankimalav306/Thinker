# Plan: Thinkspaces (v3, together with ThinkerTex)

A **Thinkspace** is a project: a named set of PDFs plus the chats, notes, glossary and mind maps that
belong to the project as a whole. Today everything hangs off a single document. A Thinkspace lets a
person ask "what do these six papers disagree about?" and keep that thinking in one place.

## What already exists
The database was prepared in v2, so v3 is mostly product work:
- `workspaces(id, name, created_at)` and `workspace_documents(workspace_id, doc_id)`.
- `workspace_id` columns on `conversations`, `notes`, and the mind map table.
- Settings scopes already include `workspace` (resolution order document > workspace > app).
- Instructions are layered global / document / conversation. A workspace layer slots in between.

What does **not** exist: any UI, any IPC for workspaces, and retrieval that spans documents.
Retrieval today is one FAISS index per document (`<pdfId>.index`), chunked roughly one chunk per page.

## Decisions to confirm with you
1. **How a Thinkspace is created:** by hand ("New Thinkspace", add files), from a folder, or both.
   Recommendation: both. By hand first; "Open folder as Thinkspace" in the same release.
2. **Annotations:** stay per document (a highlight belongs to a page). The Thinkspace only
   aggregates them (a "Marks" view across documents). Recommendation: per document.
3. **A document in several Thinkspaces:** allowed. The schema already permits it.
4. **Compare view:** two PDFs side by side, with the chat aware of both. Recommendation: phase 4,
   after the core works.

## Product shape
- **Home** gets a "Thinkspaces" row above recents: cards with name, document count, last activity.
- **Inside a Thinkspace**: a left list of its documents (add, remove, reorder, open in a tab),
  and a "Thinkspace chat" that is not tied to one PDF.
- **Chat scope selector** on every chat: This document / This Thinkspace. The same conversation list
  and instructions UI is reused.
- **Answers cite document and page**: "Handbook, p. 4" chips that open that document at that page.
- **Shared panels**: Notes, Glossary and Mind maps can switch between "this document" and
  "whole Thinkspace".
- **ThinkerTex**: "New > LaTeX project" inside a Thinkspace. A project's compiled PDF is listed with the other documents, and the writing agent can use the Thinkspace's PDFs, notes and glossary (see `docs/PLAN-LATEX.md`).
- **Instructions layer**: a Thinkspace-level instruction ("always answer for a legal audience").
- **Tutorial/Help**: a Thinkspaces guide and a tour step, and a new checklist item.

## Technical design
### Data and IPC
- New `workspaces` module in the main process (create, rename, delete, add/remove document, list,
  stats), exposed through preload. Deleting a Thinkspace never deletes documents or files.
- Conversations with `workspace_id` set and `doc_id` null are Thinkspace chats.
- A document keeps its own chats; they stay visible when opened alone.

### Cross-document retrieval (the hard part)
1. Query each member document's index for top-k, then **merge and re-rank** by score. With a
   shared embedding model the scores are comparable.
2. Each chunk keeps `{doc_id, doc_name, page}`; prompts label every source block with its document
   so the model can cite and can tell documents apart.
3. **Balance**: cap chunks per document so one long PDF cannot crowd out the rest, but allow a
   question that names a document to favour it.
4. Larger Thinkspaces: query only the indexes that exist; index missing documents in the background
   with a visible "indexing 3 of 8" status; never block the chat on it.
5. Document-only mode keeps its meaning: answer only from Thinkspace documents, and say which
   document the answer came from or that none contain it.
6. The knowledge cache key (`cache_id`) already supports per-conversation memory; reuse it.

### Where to build it
Retrieval lives in the Python sidecar today. Step 6 (TypeScript core) removes that sidecar.
- Phase 1 and 2 (data, UI, per-document chat inside a Thinkspace) do not depend on step 6 and can ship first.
- Phase 3 (cross-document retrieval) should be written **once, in the TypeScript core**, not in
  Python and then ported. That makes step 6 the first job of the next cycle.

## Phases and acceptance tests
| Phase | Delivers | Done when |
|---|---|---|
| 1. Data + IPC | CRUD, membership, migration test, deleting is safe | unit tests for every operation; deleting a Thinkspace leaves documents, annotations and chats intact |
| 2. Shell + UI | Home row, Thinkspace screen, document list, add/remove, rename, Help guide, tour | UI stress run covers long names, 0 / 1 / 200 documents, narrow window, both themes |
| 3. Thinkspace chat | cross-document retrieval, labelled sources, document+page citations, scope switch | the evaluation suite below passes its thresholds |
| 4. Shared panels | notes/glossary/mind maps at Thinkspace level, workspace instructions, Marks overview | switching scope never loses data |
| 5. Compare + folders | side-by-side view, open folder as Thinkspace, folder watching | opening a 50-file folder stays responsive |

### Evaluation suite for Thinkspace chat
Extend `evals/` with a three-document corpus that has deliberate overlaps and conflicts, then measure:
- **Attribution**: the cited document and page are correct (target 90% or better).
- **Cross-document questions**: "which document says X", "where do A and B disagree" (target 80% or better).
- **No bleed**: a fact that exists only in document A must not be attributed to B (target 100%).
- **Document-only refusals**: a question none of them answer is refused (target 100%).
- **Scaling**: answer time and tokens with 3, 10 and 30 documents.

## Risks
- **Cost and latency**: more context per question. Keep k small, summarise per document first for
  broad questions, and show the Thinkspace size in the token meter.
- **Wrong attribution** is worse than a wrong answer. Label every source block and test it.
- **Index freshness**: files edited on disk change their content hash; a Thinkspace must follow
  the document id, and show "changed on disk, re-index?" instead of silently using stale text.
- **Large Thinkspaces**: lazy index loading and an LRU for loaded indexes.
- **Migration**: existing users have none, so there is nothing to migrate. Adding a workspace layer
  to instruction resolution needs a regression test for existing document-level instructions.
