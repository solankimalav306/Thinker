# Artifacts: AI-written HTML in the chat and a library of kept ones (2026-10-30)

When you ask for a table, timeline, flashcards, study guide or diagram, the agent can answer with a small
styled document (an **artifact**) instead of plain text. It is written as HTML and CSS, shown in the chat,
can be opened larger, copied or saved as an HTML file, and every citation in it is checked.

Artifacts work in the **Thinkspace chat** and the **single-PDF chat**. Interactive artifacts and saving an artifact into a Thinkspace as a PDF document come later.

## The Artifacts library (phase 2)
- **Keep what you like**: the bookmark on a chat card saves the artifact on its own, apart from the chat, with the sources it
  was given so its citations still check out. Saving never changes or deletes the chat.
- **Artifacts** in the left rail opens the library: a grid with search by title and a filter by kind (page, table, chart,
  slides, document). Opening one shows it in the same sealed frame; rename it, link it to a Thinkspace (or none), save it as an
  HTML file, or delete it (press twice). Deleting a Thinkspace keeps its artifacts.
- **Kinds**: the model labels each artifact (`type="table|chart|slides|document|page"`), or the kind is guessed from the content.
  Charts are inline SVG or `tk-bar` rows, slides are 16:9 `tk-slide` cards, documents use `tk-doc`.
- Stored in the database (migration 3, table `artifacts`), tests in `tests/artifacts.test.js`.
- **Present** a deck (arrow keys, Escape) and **export** as HTML, PDF, PNG, Word (.docx) or PowerPoint (.pptx). PDF and PNG are drawn in a
  hidden window with no scripts, no network and no preload. Word and PowerPoint are built in the main process from plain blocks
  (`artifact-blocks.js` reads the cleaned HTML; `artifact-export.js` writes the file), never from the HTML itself.
  Charts and any `<svg>` are exported as a picture. Citations are removed from exports.
- The **single-PDF chat** now supports artifacts too; the open document's name is the title its citations use.

## Navigation
The rail holds only the big tools: Home, Reader, Thinkspaces, ThinkerTex, Artifacts, then Help and Settings. The panels that
belong to an open PDF (Contents, Pages, Notes, Glossary, Mind maps, History) are tabs at the top of the reader's side panel,
shown or hidden with the panel button in the toolbar, and chat is the Ask button in the toolbar.

## Asking for one
Say "artifact" (or "web page") and you get one, whatever the subject: a plan, the steps of an assignment, a summary. Naming a table, chart,
timeline, checklist, flashcards, slides, diagram or "step-by-step" also gets one. In the single-PDF chat the request first goes through a
router that sorts requests into answer, notes, highlight, mind map and so on; "make ... with steps" used to be sorted as **notes** and ended up in
the Notes panel. Now, with artifacts on, a request that says "artifact" always goes to the answer, and a named visual document beats notes,
highlights, comments, definitions and web search (a mind map still gets its own mind map). "Take notes on this" is still notes.

## How it works
1. The prompt tells the model to use an artifact **only** when asked for a visual document by name, and gives
   it a small design kit of classes (`tk-card`, `tk-grid`, `tk-table`, `tk-badge`, `tk-callout`, `tk-timeline`,
   `tk-steps`, `tk-stat`, `tk-bar`, `<details>` for flashcards). Plain questions, including comparisons
   ("how often... according to each document") stay plain text.
2. The reply may contain text plus `<artifact title="...">...</artifact>`. The chat finds the blocks and shows each in a frame.
3. The backend returns the **sources the answer was given** (document and page).
4. In the app the HTML is cleaned (DOMPurify), every `data-cite="Title|page"` is checked against those sources,
   and the result is sent into a sandboxed frame that cleans it again.

## Kinds, and how they are made (2026-10-31)
An artifact is one of a short fixed list. Most are **drawn from data**: the model writes a small JSON description and Thinker's own code
draws and runs it, so a to-do really ticks, a quiz scores you, flashcards flip, a table sorts, a diagram can be clicked. That is cheaper to
produce, always looks right, can be checked before it is shown, and needs no code from the model. Maths between dollar signs is drawn with KaTeX.

| Kind | What you get |
|---|---|
| checklist | tasks with progress and groups |
| steps | a plan or guide, one step at a time, marked off as you go |
| quiz | questions, instant feedback, a score and what to review |
| flashcards | cards to flip, "got it" and "again" |
| table | sortable and filterable |
| chart | bar, line or pie, sized to the space |
| diagram | a flowchart (left-to-right or top-to-bottom) or a mind map; click a box to read more |
| timeline | events in order |
| document | a written report |
| slides, page | written as HTML (page-style) |

**Workflow in the agent.** One step decides that an artifact is wanted and which kind: the words (saying "artifact", or naming a kind and asking for it
to be made) or, when the words do not say, the router's own label `artifact:<kind>`. A separate step makes it, with the instructions for that kind only,
checks the data, asks the model to repair it once if it is wrong, and otherwise gives you the words instead of a broken card. An ordinary question carries
none of this in its prompt. (`agent-handler/utils/artifacts.py`, the `artifact` node in `graph.py`.)

**Progress** (ticks, answers) is kept: on this computer for a card in a chat, and with the artifact in the library (database migration 4: `spec`, `state`).
**Open in a tab** opens a card from any chat in a tab of its own (same view, all exports, Save to Artifacts) instead of a window. Older artifacts that were
written as pages still show as pages.

**Not done yet:** a free-form interactive page (the model's own HTML and script, run only after you click Run, in a stricter frame); showing data-based
artifacts on a shared guest page; checking every export for each kind.

## Web pages (Claude-style artifacts, 2026-10-31)
Asking for web-based notes, a study site, dashboard, tracker, calculator or "a web page" goes to a separate builder in the graph
(`artifact` node, kind `page`; `utils/artifacts.py` `_PAGE_RULES`). The model writes ONE complete HTML document with its own CSS and
JavaScript (lists of contents, search, tick-offs, quizzes, charts with the bundled d3, anything the request needs). Progress is saved
through a small helper: `tk.state` on start and `tk.save(object)` after a change. Citations are `<a class="tk-cite" data-cite="Title|N">`
and always read "Page N" (a raw `Title|N` label is rewritten); references that were not in the answer's sources are dashed and dead.

**Changing one**: "add a quiz section to it" re-sends the latest artifact of the chat (`previous_artifact`) with the request, and the
reply is the whole updated artifact, as Claude does.

**Running it**: a page with scripts is NOT cleaned into a static card. It runs in `artifact-live.html` (sandbox `allow-scripts`, opaque
origin) whose header policy allows inline scripts and nothing else: `connect-src 'none'`, images only as data, no frames, forms, media,
objects, workers or eval. Beyond the policy: frame navigation away from `thinker-artifact:` is blocked (`will-frame-navigate`), WebRTC
is limited to proxied UDP, and any request started by an artifact frame to a non-artifact address is cancelled (`webRequest`). The frame
sends a heartbeat; a page that stops answering for 9 seconds is removed with a "Run it again" button. Cards say the page runs its own code
in a sealed frame. A script page exports only as an HTML file (with a stand-in for `tk`); the other formats need a static page.

## Safety model
- **Sandbox**: `sandbox="allow-scripts"` only (no same-origin, no popups, forms or navigation). The frame cannot read the app.
  Scripts are allowed solely so the frame's own bridge can run; the page's policy refuses everything else.
- **Own protocol**: a sandboxed frame may not load local files, so the frame page and its two scripts come from
  `thinker-artifact://frame/…` (`artifact-protocol.js`), which serves **three whitelisted files** and sends the policy
  as a response header: no connections, no frames, no forms, images and fonts as data only.
- **Cleaning**: no script, iframe, object, embed, form, input, button, link, meta, base, audio, video or `foreignObject`;
  no event handlers; links and images only as `#` or data images; only five `data-` attributes survive.
  Input is cut at 200,000 characters.
- **Citations**: a reference the answer was not given is shown dashed and does nothing. Verified ones open the PDF at that page.
- **Actions back to the app** are a fixed list: open a cited page, copy text. Nothing else is accepted.
- **Labelled**: every card says "AI-generated".

## What was tested
- `scripts/ui-artifact-hostile.mjs` runs inside the real app (and the installed build): 18 hostile samples (script tags,
  `onerror`, `javascript:` links, SVG `onload`, iframe/object/embed, forms posting away, CSS `@import` and `url()`,
  `<link>`/meta refresh/`<base>`, remote images, a fake full-screen "enter your API key" overlay, SVG with script and
  `foreignObject`, `ontoggle`, two mutation-XSS payloads, a `data:` HTML image, abusable `data-` attributes, handlers on
  everything, and a 500,000-character input). Result: **no script ran, nothing reached the network, nothing escaped the frame.**
  The same run checks a normal artifact, citation gating, theming, save and Open larger.
- Unit tests: 10 for parsing and citation checking (`tests/artifact-html.test.js`), 2 backend.
- With the real model (`evals/run-space-eval.mjs`, questions S13 to S15 plus the 12 earlier): a comparison table, flashcards
  and a timeline were produced when asked, with **no invented citations and no script**, and plain questions did not become
  artifacts. 14 of 15 pass; the one failure is the known S1 habit of mentioning a silent document.
- The screen check found two real problems that were then fixed: a reply showing as raw HTML (a bad pattern in my own edit),
  and tables crushing to one letter per line in the narrow chat panel.

## Limits to know
- Artifacts cost more output than plain text, so the model is told to use them sparingly.
- A model can still write something misleading *inside* the safe frame (visual spoofing). The label, the removal of forms
  and inputs, and the fact that nothing can leave the frame are the mitigations.
- The free-tier model key limits roughly 7 questions per minute (each question uses two model calls); the evaluation is paced for that.

## Next
1. Save an artifact into the Thinkspace as a PDF document so it can be read and marked up.
2. "Make this a LaTeX document" and "Make slides from this Thinkspace" (hand an artifact or sources to ThinkerTex).
3. Interactive artifacts (quizzes, calculators) in a second tier that you allow per message, still with no network.
