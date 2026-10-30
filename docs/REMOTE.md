# Thinker Remote: sharing and live co-editing on your network

Share one artifact or one LaTeX project with people on the same network. Nothing is uploaded; guests open a page served
from your computer, and it stops when you stop sharing or close Thinker.

## Using it
Press **Share** on an artifact (Artifacts screen) or a project (ThinkerTex toolbar). Pick "People on my network" or "Only this
computer" (to try it), and how long. Send the link; read out the 6-digit code. A guest sees only that one thing, read-only.
A project is shown as its compiled PDF and refreshes each time you compile.

## How it is kept safe
- **Off by default.** The server starts when you start a share and stops when the last share ends or the app quits.
- **Two secrets**: an unguessable link (192 bits) and a 6-digit code, compared in constant time.
- **Guessing is limited**: 5 wrong codes lock that address for 10 minutes; 25 wrong codes lock the share for good.
- **One thing only**: there is no route to list, open or change anything else, no route to project files, and no write route at all.
  Wrong, expired and unknown links all answer 404, so a guest learns nothing about what exists.
- **Sessions** are an HttpOnly, SameSite=Strict cookie scoped to that share's path, valid for the life of the share (8 hours at most).
- **Artifacts** reach the guest through the same sealed frame the app uses: sandboxed without same-origin access, a policy with no
  network, forms or frames, and the HTML cleaned again inside the frame. A hostile artifact cannot touch the guest page.
- The guest page has its own strict policy (no inline script, no outside connections).
- **Not encrypted.** The link is plain HTTP on the local network, and the page and the Share window both say so. Do not use it on public Wi-Fi.

## What was tested
- `tests/remote-server.test.js` (15): code required, bare link redirect, wrong tokens and path tricks, per-address lockout and its
  expiry, share lockout, odd input, session isolation between shares, frame files and their policy, ending and expiring shares,
  live updates and the "stopped" message, PDF serving without exposing project files, and the server really closing.
- In the real app: a second browser instance acts as the guest. Wrong code refused, right code opens the view, a hostile artifact
  (script, `onerror`, a script reaching `window.parent`) did nothing to the guest page, the host sees the guest count, Stop
  sharing tells the guest and kills the link, and a shared project shows its PDF.

## Editing together (phase 2)
Tick **Let people edit this project with me, live** when you share a LaTeX project. The share then has two codes:
- the **edit code**: change the project's text files together with you, and press **Build PDF**;
- the **view code**: watch the same live editor read-only, and the PDF.

How it works: each text file being edited has one shared copy (Yjs, the standard library for this). Your own editor in ThinkerTex,
and every guest's editor in their browser, are all connected to that copy, so concurrent typing merges instead of overwriting.
Cursors and names show who is where. The program writes the shared copy back to the real file in your project a moment after
every change, and also folds in changes made to the file outside Thinker. While others can edit, the Visual view is off (it rewrites
the whole file, which would disturb everyone else's cursors); it comes back when you stop sharing.

What an editing guest can and cannot do:
- open and change **existing** `.tex .bib .sty .cls .bst .txt .md .cfg .def .ltx` files of that project (up to 1 MB each, 200 files);
- cannot create, delete, rename or upload files, see any other folder, open a file through a link that leaves the project, or reach hidden files;
- can ask for a build, at most one every few seconds; the result appears for everyone, including you.
**Give the edit code only to people you trust.** What they type is compiled on your computer. The LaTeX compiler runs in its
untrusted-input mode (no shell commands), but you are still running someone else's text through it.

Extra protection on the live connection: it needs the guest's session cookie, refuses a page from another site (the browser's origin
must be this address), allows at most 12 live connections per share, drops messages over 2 MB, and a view-code guest's edits are discarded by the server.

## Tested (phase 2)
- `tests/collab-docs.test.js` (10): only existing text files inside the project open, hidden and build folders are skipped, two editors
  converge and reach the disk, simultaneous edits are both kept, a viewer cannot change anything, who-is-where appears and disappears, broken or
  oversized messages are ignored, outside changes are folded in, and closing saves.
- `tests/remote-edit.test.js` (7): two codes give two roles, file list, path tricks refused, session and origin required, two guests edit
  together and the file follows, a view guest changes nothing, only editors can build, stopping saves and disconnects everyone.
- In the real app, a host editor and a guest in a separate browser: each saw the other's typing, names and cursors, the host's badge showed
  "Editing with Guest 28", both edits were in the file, a view-code guest's attempt changed nothing, and stopping the share returned the host's
  editor to normal saving with Visual view back.

## Not built yet
- Creating or renaming files as a guest, comments and chat, a QR code for the link.
- Encrypted connections, sharing a whole Thinkspace, or sharing across the internet (local network only on purpose).
- Co-editing artifacts (they remain look-only).
