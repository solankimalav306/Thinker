# Plan: ThinkerTex (LaTeX studio inside Thinkspaces)

## Status (2026-10-30, branch `v3`)
Built and verified in the running app against the real compiler and the real model:
- Phases 0 to 2 and most of 3 and 4: engine spike; compile service; projects (templates, open a folder or
  a .tex file, optional Thinkspace); the studio with file tree, outline, CodeMirror editor with error
  markers, Recompile and Auto, a live preview that keeps its place, a problems list with plain-language hints.
- **Visual editor** (the "normal" editor): edits the same file as the code view. Headings, paragraphs
  (bold, italic, code, maths, citation chips), lists and equations are editable; tables, figures and
  anything unusual stay as source blocks. Whatever you do not touch is written back byte for byte.
- **Agent**: writes, compiles a copy to check, repairs itself up to three times, then shows a diff to
  Apply (one undo step) or Reject. Lesson learned: LaTeX inside JSON corrupts (`` is a backspace), so the
  agent uses a plain marker format.
Not done yet: SyncTeX, BibTeX/biber builds, templates beyond the five, an offline-bundle option, the
installer round trip (the engine is listed for packaging but a packaged build has not been run), and
checking the Thinkspace-PDF sources option against a real Thinkspace.

Thinker today is for **reading**. ThinkerTex makes it a place to **write** too. It is an Overleaf-style
editor with live PDF preview and an AI agent that writes LaTeX using the same model and key as the chat.
ThinkerTex is a **tool in its own right**, not a part of Thinkspaces. A LaTeX project can live anywhere:
on its own, in any folder on disk, or inside a Thinkspace. In a Thinkspace it gains extra powers (the
agent can use that Thinkspace's PDFs), but it never needs one.

Thinkspaces and ThinkerTex ship together as **v3** because they strengthen each other.

## Why it belongs here
- Thinker is PDF-centric, and LaTeX's output is a PDF. A compiled project is just another document:
  it can be read, searched, marked up and asked about with everything already built.
- The reader and the writer feed each other: read three papers, ask a question across them, then ask
  ThinkerTex to turn the answer into a related-work section with the right citations.
- Nobody else has "reading desk + writing desk + one AI that knows both".

## What it should feel like (Overleaf, plus the agent)
```
+------------------------------------------------------------------------------------------+
| Thinkspace > Thesis      main.tex   [Recompile ▶]  [Auto ✓]  [Logs 2]  [⬇ PDF]  [Share ▾] |
+-----------+-----------------------------------+--------------------------+---------------+
| Files     | 1  \documentclass{article}        |  PDF preview             | Ask ThinkerTex|
|  main.tex | 2  \usepackage{amsmath}           |  (page 1 of 6)           |               |
|  refs.bib | 3  \begin{document}               |   [live, keeps your      | "Add a table  |
|  figs/    | 4  \section{Intro}                |    place after each      |  comparing    |
| Outline   | 5  ...                            |    compile]              |  the 3 papers"|
|  Intro    |                                   |                          |  → diff + Apply|
+-----------+-----------------------------------+--------------------------+---------------+
| Errors and warnings: main.tex:41  Missing } inserted.   [Fix with AI]                     |
+------------------------------------------------------------------------------------------+
```
- **Left**: file tree (new file, folder, upload image, rename, delete) and a document outline built
  from `\section`, `\subsection`, labels. Click to jump.
- **Middle**: the editor (CodeMirror 6): highlighting, line numbers, search and replace, bracket and
  environment matching, snippets, spell check, `Ctrl+/` comments, multi-file project.
- **Right**: the preview, which is the same PDF viewer used everywhere (single, two-page and continuous
  view, pinch zoom, find, marks, snip) so it behaves exactly like reading.
- **Agent panel**: a tab beside the preview, plus a floating "Ask ThinkerTex" button on any selection.
- **Bottom**: errors and warnings with line numbers; clicking one jumps to the line.
- Layout is resizable (drag the dividers), has an "editor only" and "preview only" mode for small
  windows, and uses the same light and dark themes.

## Preview and compile (the core loop)
- **Recompile** button and `Ctrl+Enter`. **Auto-compile** toggle: compiles about 1.5 s after you stop
  typing and never while a compile is already running (the newest request waits its turn).
- **Quick draft** mode (one pass, no bibliography) for fast feedback, and a **Full** build (all passes,
  BibTeX/biber) on demand and before export.
- While a build runs the previous good PDF stays on screen with a "compiling..." badge. A failed build
  keeps the last good preview and lists the errors; it never blanks the page.
- **Keep your place**: after each build the preview returns to the same page and spot (the viewer
  already keeps a position across re-layouts; a reload by bytes will reuse that).
- **Source and PDF sync** (SyncTeX): `Ctrl+click` in the PDF jumps to the source line; a button in the
  editor scrolls the PDF to the cursor.
- **Logs** tab with the raw log, plain-language rewrites of common errors ("a closing brace is missing
  on line 41"), warnings grouped (overfull box, missing reference), and **Fix with AI**.
- **Export**: download the PDF, the `.tex`, or a zip of the project; or **Save to Thinkspace**.

## Where a project can live
ThinkerTex works the same everywhere; only the extras differ.
1. **On its own**: Home > **New ThinkerTex project** (blank, article, report, thesis, beamer slides, letter,
   CV), or a "ThinkerTex" button on the left rail. It is stored in Thinker's own projects folder and
   shows up under "Your LaTeX projects" on Home.
2. **In any folder**: **Open folder as ThinkerTex project**, or open any `.tex` file (also from
   Windows: right-click > Open with Thinker). Files stay where they are, so Git, Dropbox and other
   editors keep working. Thinker adds only a small hidden build folder.
3. **Inside a Thinkspace**: **New > LaTeX project** in the Thinkspace (also "from selected notes").
   A Thinkspace can hold any number of projects, and a project can be added to or removed from a
   Thinkspace later without moving its files.
4. **Next to a PDF**: from the reader, "Write about this document" starts a project already linked to
   that PDF.

The compiled PDF of any project opens in the reader like any other document, so you can mark it up and
chat with it, wherever the project lives. A project in a Thinkspace also lists its PDF with that
Thinkspace's documents.

## Thinkspace integration (an extra, not a requirement)
- **The agent can use the Thinkspace** a project belongs to (with your permission each time you turn it on):
  - cite or summarise the Thinkspace's PDFs (with page numbers in comments);
  - pull in the Thinkspace's notes, glossary and mind maps;
  - build a bibliography only from real metadata of those PDFs (title, authors, year, DOI when present).
    If a field is unknown it stays blank and the agent says so. It never invents a reference.
- **Reverse direction**: select text in a PDF, "Send to ThinkerTex" inserts it as a quote with a citation key.
- Settings follow the existing layers: instructions can be set per Thinkspace ("write in British
  English, use IEEE style"), per project, and globally for a standalone project.
- A standalone project can still use the agent's other tools (draft, edit, fix, convert); it just has no
  Thinkspace documents to cite until it is linked to one.

## The agent
Same provider layer, profiles and keys as the chat, with its own prompt and tools.
1. **Draft** a document or section from a description, using the project's class and packages.
2. **Edit the selection**: rewrite, shorten, formalise, make it a table or list, fix grammar.
3. **Fix errors**: sees the code and the log, proposes a patch, compiles, reads the new log. At most
   3 loops, then stops and explains what is still wrong.
4. **Convert**: notes, a chat answer, a mind map, or a pasted Markdown into LaTeX.
5. **Figures and tables**: create `tabular`, `booktabs`, TikZ and pgfplots from data or a description.
6. **Explain**: what a package, command or error means, from the code in front of it.
7. **Cite**: as above, from real Thinkspace metadata only.

How it changes your text:
- It returns a **patch** (a list of range and replacement edits), never a silent rewrite of the file.
- The editor shows an inline **diff** with Accept and Reject per change, and Accept is one undo step.
- Context sent to the model: the open file or the selected region plus the preamble, the last log,
  your instructions, and (only if enabled) the Thinkspace excerpts it needs. Large projects send an
  outline plus the relevant file. The token meter shows the cost.
- Safeguards: documents are data, not instructions (a `.tex` or PDF line that says "ignore previous
  instructions" is just text); the agent never runs shell commands; every compile uses the safe settings below.

## Compiler
No TeX installation was found on the development machine, and most readers will not have one, so the
app brings its own engine.

| Option | Pros | Cons |
|---|---|---|
| **Tectonic** (recommended) | One small executable, runs on Windows, works offline with `--only-cached`, modern XeTeX engine, an untrusted mode | Downloads packages on first use (so it needs a "prepare offline" step); a few rare packages missing |
| Ship MiKTeX / TeX Live | Complete | Gigabytes, installer complexity, update burden |
| WebAssembly engine | No child process | Large download, slower, weaker package support |
| The person's own TeX | Full compatibility | Most people do not have it |

Plan: bundle Tectonic (measure the installer size in the spike; if too large, download it on first use),
and detect an existing `latexmk`/`pdflatex` for a "Use my TeX installation" option. Tectonic 0.17 is
current and supports Windows. For Overleaf-like compatibility the spike must compile a set of real
templates (article, IEEE, ACM, beamer, a thesis class) and list what fails.

### Safe execution
- Untrusted mode, no shell escape, one temporary build folder per project.
- Hard limits: 60 s per build, an output size cap, kill the whole process tree on timeout or Stop.
- Only the project folder is readable; absolute and `..` paths in `\input` and `\includegraphics` are refused.
- AI-written code runs under exactly the same rules as hand-written code.
- In local-only mode, builds use `--only-cached` and never touch the network.

## Spike results (2026-10-29, Windows 11, real engine)
Engine: Tectonic 0.17.0+20260731 (x86_64 MSVC build from the project's "continuous" release; the zip's
SHA-256 is `5e26562191c9cdc89e9ebfcd6fa683121efbfc2a2293048993091e6936e858fb`). It is run through
`tex-compile.js` exactly as the app will run it. `node scripts/tex-spike.js` repeats the measurements.

| Measurement | Result |
|---|---|
| Size | `tectonic.exe` 52.5 MB (21 MB zipped); expect roughly +25 MB on the installer |
| First use, empty cache ("prepare") | **200 s** on this connection; cache grows to **41.5 MB** |
| Simple article, packages cached | **0.4 s** |
| Maths + table + hyperref document, first time | 12 s (a few more packages fetched) |
| Same document, packages cached | **0.8 s** |
| Offline (`--only-cached`) after prepare | works, 0.4 s and 0.8 s |
| A broken document | fails in 0.2 s with `main.tex:4 Undefined control sequence` and a plain-language hint |

What this decides:
- **Bundle the engine** (about +25 MB) and ship no packages. Do **not** treat the first compile as a normal
  build: with the usual 60 s limit it is killed. A one-time **"Set up ThinkerTex"** step runs `prepare` with
  a 10-minute limit and a progress message, then everything is fast and works offline.
- Keep the package cache in Thinker's own data folder (the engine honours `TECTONIC_CACHE_DIR`) so it can be
  shown, cleared and moved, and so a local-only mode can promise "no network" with `--only-cached`.
- Packages that were not fetched during setup are fetched the first time a document uses them (a few
  seconds); in local-only mode the error should say which package is missing.
- The release is a rolling "continuous" build, so pin the engine by hash in the repo's build notes and
  re-test when updating it. Tectonic is MIT licensed; ship its licence text with the installer.
- Still to measure: SyncTeX output, bibliography (BibTeX/biber) builds, a 100-page document, and real
  templates (IEEE, ACM, Beamer, a thesis class).

## Evaluation (objective, since a compile either works or does not)
- **Compile rate**: 40 tasks (article, table, equation, TikZ, bibliography, Beamer, two-column) through
  the agent. Targets: 90% compile first time, 97% within 3 repair loops.
- **Fix rate**: 30 deliberately broken files (missing brace, undefined command, bad nesting, missing
  package). Target 85% repaired.
- **Fidelity**: an edit request changes only what was asked (diff size check, target 95%).
- **No invented citations**: "cite the papers in this Thinkspace" may only use real metadata (target 100%).
- **Preview latency**: a typical 10-page document from change to updated preview (target under 5 s on a
  normal laptop in Draft mode).
Same runner and results format as `evals/run-eval.mjs`.

## Phases (ships with Thinkspaces as v3)
| Phase | Delivers | Done when |
|---|---|---|
| 0. Spike | Tectonic bundled, compile templates from the main process, measure size and time, online and offline | a template set compiles on a clean Windows machine with no TeX |
| 1. Compile service | spawn with limits, temp folders, log parser, errors as data, Stop, queue | tests for timeout, huge output, path escape, parallel requests, missing package |
| 2. Studio shell | file tree, CodeMirror editor, preview pane using the viewer, Recompile and Auto, errors strip, autosave | UI stress at narrow sizes and both themes; killing the app mid-edit loses a few seconds at most |
| 3. Projects everywhere | standalone projects on Home, open any folder or `.tex`, "Write about this document", link to a Thinkspace, compiled PDF opens in the reader | create, close, reopen, delete; works with no Thinkspace at all; a linked project lists its PDF in the Thinkspace |
| 4. Agent | draft, edit selection, fix errors, convert, diff accept/reject | evaluation targets met on at least two models |
| 5. Cite and sync | Thinkspace-aware citations, Send to ThinkerTex, SyncTeX, templates, offline "prepare" | tutorial, Help guide and a tour step shipped |

## Risks
- **Package gaps and first-run downloads**: say what is being fetched; offer the offline prepare step.
- **Overleaf expectations**: be clear about what is not there yet (real-time collaboration, review comments, Git, track changes).
- **Compile security**: untrusted mode and path checks are tested with hostile inputs.
- **AI over-editing**: patches plus diff review keep the person in control.
- **Installer size**: measure in the spike.
- **Editor weight**: lazy-load CodeMirror only when a project opens.
- **Depends on step 6**: the compile service and the agent are simplest in the TypeScript core; the studio UI can start before it.
