# Plan: LaTeX studio (viewer, editor, compiler, writing agent)

Write LaTeX in Thinker, see the PDF update beside it, and ask the same AI (same key, same profile)
to write or fix the code. The compiled result is an ordinary PDF that opens in Thinker's reader,
so every existing feature (chat, annotate, find, Thinkspaces) works on it.

## Goals
- Edit `.tex` with a real code editor: highlighting, line numbers, search, bracket matching.
- Compile to PDF with one key press, show errors in plain language, and jump to the offending line.
- A LaTeX agent that drafts, edits and repairs code, shows its change as a diff, and never
  invents citations.
- Works offline once set up, and nothing leaves the machine except the model request the person asked for.

## Not in v1
Real-time collaboration, a package manager UI, Overleaf sync, Word import. (Later: BibTeX UI, templates gallery.)

## Compiler choice
No TeX installation was found on the development machine, and most readers will not have one, so the
app has to bring its own engine.

| Option | Pros | Cons |
|---|---|---|
| **Tectonic** (recommended) | One small executable, runs on Windows, offline with `--only-cached`, modern XeTeX engine, a flag for untrusted input | Downloads packages on first use, so needs a "prepare offline" step; a few exotic packages missing |
| Ship MiKTeX / TeX Live | Complete | Gigabytes, installer complexity, licensing and update burden |
| WebAssembly engine in the renderer | No child process | Large download, slower, weaker package support |
| Use the person's own TeX | Full compatibility | Most people do not have it |

Plan: **bundle Tectonic** (about tens of MB added to the installer; confirm the exact size when
packaging), and also detect an existing `pdflatex`/`latexmk` and offer "Use my TeX installation" in
Settings for people who need packages Tectonic lacks. Tectonic 0.17 is current and supports Windows.

### Safe execution
- Always run with Tectonic's untrusted mode, no shell escape, in a temporary build folder per project.
- Hard limits: 60 s wall time, output size cap, kill the whole process tree on timeout or on Stop.
- Only the project folder is readable. Reject absolute or `..` paths in `\input` and `\includegraphics`.
- AI-written code is compiled under exactly the same rules as hand-written code.

## Product design
- **New**: a "LaTeX" entry on Home and in "+" ("New LaTeX project", "Open .tex file", "From template").
- **Studio layout**: editor on the left, live PDF on the right (the existing reader), a compile log
  and errors strip underneath, and the agent chat as the existing right-hand panel.
- **Compile**: Ctrl+Enter (or Ctrl+S) compiles; optional "compile on save"; clear status
  (compiling... done in 3.2 s / 2 errors). The previous good PDF stays on screen while a build fails.
- **Errors**: parse the log into `file:line: message`. Show them as a list, underline the line in the
  editor, and rewrite the common ones in plain words ("A closing brace is missing on line 41").
  A "Fix with AI" button sends the code and the log to the agent.
- **Viewer**: reuse `pdf-controller`. Marks, find and chat work on the compiled PDF.
- **Source and PDF sync (phase 4)**: SyncTeX so clicking the PDF jumps to the source line and back.
- **Projects**: a project is a folder with `main.tex`, images and `.bib`. It can belong to a
  Thinkspace, next to the PDFs it cites.
- **Export**: save the PDF, save the `.tex`, "Zip project".

### Editor
Use **CodeMirror 6** with a LaTeX language mode, vendored through the existing `scripts/vendor.js`
(no CDN, so the CSP stays strict). Needed for v1: highlighting, line numbers, undo/redo, find/replace,
soft wrap, bracket matching, `Ctrl+/` comment, snippets for common environments (`\begin{...}` pairs),
and autosave with crash recovery.

## The LaTeX agent
It reuses the same provider layer, profiles and keys as the chat, with its own prompt and tools.

### What it can do
1. **Draft** a document or section from a description, using the chosen document class.
2. **Edit the selection** ("make this a table", "shorten", "turn bullets into an enumerate").
3. **Fix errors**: given the code and the compile log, propose a patch. Loop at most 3 times:
   propose, compile, read the log, stop on success or on repeated failure, and say so.
4. **Translate notes to LaTeX**: turn Thinker notes, a chat answer or a mind map into a section.
5. **Cite carefully**: build BibTeX entries only from metadata that really exists (the PDF's title,
   author and year fields, or text the person typed). If a field is unknown it stays blank and the
   agent says so. It never fabricates references.
6. **Explain**: what a package or error means, answered from the code in front of it.

### How it works
- The agent returns a **patch**, not a rewritten file: a list of `{range, replacement}` edits.
- The UI shows an inline diff with Accept / Reject per hunk, and a single undo step per accept.
- Context sent to the model: the current file (or the selected region plus the preamble), the last
  compile log, and the person's instructions. Large projects send an outline plus the relevant file.
- Prompt rules: output only valid LaTeX for the chosen engine, keep existing macros, do not add
  packages that are not available, and mark anything uncertain with a `% TODO` comment.
- Same safeguards as the chat agent: documents are data, not instructions (a `.tex` file that says
  "ignore previous instructions" is just text).

## Evaluation (objective, unlike most AI features)
A compile either works or it does not, so the agent can be measured:
- **Compile rate**: a prompt set of 40 tasks (article, table, equation, TikZ figure, bibliography,
  Beamer slides, two-column) run through the agent; target 90% compile on the first try, 97% within 3 repair loops.
- **Fix rate**: 30 deliberately broken files (missing brace, undefined command, wrong environment
  nesting, missing package); target 85% repaired.
- **Fidelity**: an edit request changes only the requested part (diff size check; target 95%).
- **No fabricated citations**: a "cite the three papers in this Thinkspace" task must only use real metadata.
- Track time and tokens per task, per model.
The harness mirrors `evals/run-eval.mjs`, so one runner and one results format cover both.

## Phases
| Phase | Delivers | Done when |
|---|---|---|
| 0. Spike | bundle Tectonic, compile a sample from the main process, measure size, time and first-run download | a hello-world compiles on a clean Windows machine with no TeX; both online and `--only-cached` runs documented |
| 1. Compile service | spawn with limits, temp folders, log parser, errors as data, Stop | tests for timeout, huge output, path escape, parallel builds, a missing package |
| 2. Studio UI | CodeMirror editor, split view, status, error list, project open/save, autosave | UI stress at narrow sizes and both themes; killing the app mid-edit loses no more than a few seconds |
| 3. Agent | draft, edit selection, fix errors, diff accept/reject | evaluation targets above met on at least two models |
| 4. Polish | SyncTeX, templates, BibTeX helpers, Thinkspace integration, offline "prepare" button, "use my TeX" | tutorial, Help guide and a new tour step shipped |

## Risks
- **Package gaps / first-run downloads**: surface them honestly ("this needs the `tikz` package; downloading...") and offer the offline prepare step.
- **Compile security**: untrusted mode and path checks are mandatory, and tested with hostile inputs.
- **AI over-editing**: patches plus diff review keep the person in control.
- **Large installer**: measure in the spike; if too big, download Tectonic on first use instead of bundling it.
- **Editor weight**: lazy-load CodeMirror only when a LaTeX project opens.
- **Depends on step 6**: the compile service and the agent are simplest in the TypeScript core; the studio UI can start before it.
