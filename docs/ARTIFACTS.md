# Artifacts: AI-written HTML in the chat (phase 1, 2026-10-30)

When you ask for a table, timeline, flashcards, study guide or diagram, the agent can answer with a small
styled document (an **artifact**) instead of plain text. It is written as HTML and CSS, shown in the chat,
can be opened larger, copied or saved as an HTML file, and every citation in it is checked.

Phase 1 is in the **Thinkspace chat**. The single-PDF chat, saving artifacts into a Thinkspace, printing
them to PDF and interactive artifacts come later.

## How it works
1. The prompt tells the model to use an artifact **only** when asked for a visual document by name, and gives
   it a small design kit of classes (`tk-card`, `tk-grid`, `tk-table`, `tk-badge`, `tk-callout`, `tk-timeline`,
   `tk-steps`, `tk-stat`, `tk-bar`, `<details>` for flashcards). Plain questions, including comparisons
   ("how often... according to each document") stay plain text.
2. The reply may contain text plus `<artifact title="...">...</artifact>`. The chat finds the blocks and shows each in a frame.
3. The backend returns the **sources the answer was given** (document and page).
4. In the app the HTML is cleaned (DOMPurify), every `data-cite="Title|page"` is checked against those sources,
   and the result is sent into a sandboxed frame that cleans it again.

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
1. The single-PDF chat. 2. Save an artifact into the Thinkspace as a document, and print it to PDF so it can be read and
marked up. 3. "Make this a LaTeX document" and "Make slides from this Thinkspace" (hand an artifact or sources to ThinkerTex).
4. Interactive artifacts (quizzes, calculators) in a second tier that you allow per message, still with no network.
