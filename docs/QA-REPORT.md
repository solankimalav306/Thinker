# QA report: Thinker 2.0 tested as a user

Tested on 2026-10-29 by driving the real app with scripted mouse, keyboard and wheel input (not by
reading code alone), plus a code read to explain each result. Test document: a 12-page text PDF
(`evals/corpus/harbor-lights-manual.pdf`) and the 300-page and odd-named files from the stress fixtures.
Scripts are in the scratchpad of the session that produced this report and are summarised under
"How to re-run".

**Status key:** Fixed = fixed on branch `viewer-modes` and verified again with the same script.
Open = not fixed yet. Unverified = seen in code, not reproduced.

## Summary

| | Count |
|---|---|
| Findings | 36 |
| Fixed and re-verified | 27 |
| Open or unverified | 9 |

The biggest problems were structural: marks, sticky notes, the snip tool and selection all assumed
single-page view, and continuous scrolling was half built.

## Findings

### A. Two-page and continuous view were second-class (High)
| # | Finding | Status |
|---|---|---|
| A1 | Pens, highlighters, eraser and sticky notes did not work outside single-page view. Clicking a pen showed "Current view does not support annotations." | Fixed |
| A2 | Marks you had drawn were **invisible** when you switched to two-page or continuous view, so work looked lost. | Fixed |
| A3 | The screenshot (snip) tool was disabled outside single-page view. | Fixed |
| A4 | A text selection that started on one page and ended on another was not quoted into the chat, and right-click actions only saw one page. | Fixed |
| A5 | In continuous view the page number never changed while scrolling, so "this page" actions (notes, summaries) used a stale page. | Fixed |
| A6 | Continuous view drew **every** page up front (604 canvases for a 300-page file). | Fixed (pages near the window only; others keep their size and show their number) |
| A7 | Zoom, fit mode and window resize threw you back to the top of a page instead of keeping your place. | Fixed |
| A8 | In continuous view the zoom shown did not match the page (a hidden 0.95 factor). | Fixed |

### B. Scrolling and trackpad (High)
| # | Finding | Status |
|---|---|---|
| B1 | Pinch-to-zoom and Ctrl+wheel did nothing. | Fixed |
| B2 | Two-finger scrolling in single-page view could never turn the page; you had to find the arrow. | Fixed (a deliberate push past the page end turns it) |
| B3 | After turning a page the new page opened scrolled part-way down. | Fixed |
| B4 | Fit-to-width left a sideways scrollbar (the stage's own padding was not counted). | Fixed |
| B5 | Trackpad momentum after a page turn would scroll the new page. | Fixed (momentum is swallowed) |

### C. Keyboard shortcuts (High)
Before: only Ctrl+O, Ctrl+F and Esc existed.
| # | Finding | Status |
|---|---|---|
| C1 | PageDown, PageUp, Space, Home, End scrolled a little or did nothing; arrow keys did nothing. | Fixed |
| C2 | No zoom shortcuts (Ctrl +, -, 0). | Fixed |
| C3 | No way to jump to a page: the page number was static text. It is now a box (Ctrl+G focuses it). | Fixed |
| C4 | No undo or redo for marks at all (Ctrl+Z, Ctrl+Y). | Fixed |
| C5 | Ctrl+S, Ctrl+W, Ctrl+Tab did nothing; middle-click on a tab did not close it. | Fixed |

### D. Marks and sticky notes (Medium)
| # | Finding | Status |
|---|---|---|
| D1 | No drawing cursor; the pointer stayed an arrow while drawing or erasing. | Fixed |
| D2 | A quick flick of the eraser skipped over lines, because only sampled points were tested. | Fixed (whole segments are tested) |
| D3 | After placing a sticky note the cursor was not in the note box, and Enter did nothing. | Fixed |
| D4 | The sticky note popup was read-only: no edit, no delete. | Fixed (Edit and Delete, both undoable) |
| D5 | The placement hint says "Esc to cancel" but Esc did not cancel. | Fixed |
| D6 | Tool buttons did not tell screen readers which one is on. | Fixed (`aria-pressed`) |
| D7 | The eraser deletes a whole stroke, not just the part you rub. | Open (by design; a partial eraser is a feature to decide) |
| D8 | Sticky notes cannot be moved after placing. | Open |
| D9 | The highlighter is a freehand marker; it does not snap to text and is not tied to the words. | Open (see the LaTeX and Thinkspace plans for text-anchored marks) |
| D10 | Drawing relies on mouse events only. A touch screen or pen (for example a Surface) will not draw. | Unverified |

### E. Window and files (Medium)
| # | Finding | Status |
|---|---|---|
| E1 | Dropping a PDF onto the window did nothing, and nothing stopped the window from navigating away to the dropped file. | Fixed (drop opens it; navigation is blocked) |
| E2 | Dragging a tab out of the window called a function that is not in scope, so it would throw. | Fixed |

### F. Chat (High, found by the accuracy evaluation)
| # | Finding | Status |
|---|---|---|
| F1 | When the model service failed (for example `504 DEADLINE_EXCEEDED`), the backend returned `{error: ...}` as a normal reply and the chat showed a bare "No response." 7 of 30 evaluation questions hit this. | Fixed (plain-language message with the next step) |
| F2 | A question that names a page ("Summarise page 10") is answered as if the page was not in the document, because retrieval is by meaning only. | Open (see `docs/CHAT-EVAL.md`) |
| F3 | Every answer takes about 35 to 50 seconds. A single bare model call here takes 14 to 22 seconds, and each question makes two calls in a row (intent, then answer). | Open (see `docs/CHAT-EVAL.md`) |

### G. Visual polish (Low)
| # | Finding | Status |
|---|---|---|
| G1 | At 1440x900 with no model connected, the chat's "What would you like to know?" heading is clipped under the header. | Open |
| G2 | The status toast uses the same "info" icon for success ("Sticky note placed.") as for notices. | Open |
| G3 | When Settings is open, Esc does not go back. | Open (may be intended) |

## Things that worked well
Zoom box validation (letters, 5, 5000, empty, "150%", spaces all handled), text selection by double
click, triple click, drag and Ctrl+A, Ctrl+F search with Enter and Shift+Enter, no page scrollbars at
960x620, 1100x700 and 1920x1080, a 300-page file opening in under a second, and Shift+Enter in the chat box.

## How to re-run
The checks are scripted against the debug port of a running app (`--remote-debugging-port`). The ones
for this report cover: keyboard and wheel probes (single view), marks in all three views, sticky note
flow, selection across pages, snip, tabs, drop-to-open, a 300-page timing. The viewer checks that
verify the fixes (marks, undo, eraser, sticky notes, selection, snip, page tracking, pinch zoom,
shortcuts, in single, two-page and continuous view) are 20 to 25 assertions per view.
Unit tests for the new geometry and error messages are in `tests/page-geometry.test.js` and
`tests/chat-groups.test.js`.

## Still to do (suggested order)
1. Merge `viewer-modes` after a full run of `scripts/ui-stress.mjs`.
2. D8 and D7: move sticky notes; decide on a partial eraser.
3. D9: text-anchored highlights (highlight what you select, with a colour popup).
4. D10: switch drawing to Pointer Events so touch and pen work.
5. G1 to G3: the polish items.
