# Thinker Remote (phase 1: view-only sharing on your network)

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

## Not built yet
- **Live editing** together (Yjs) for LaTeX projects, with a guest role and a separate edit code.
- Encrypted connections (a certificate the guest has to trust), a QR code for the link, a list of guests with names.
- Sharing a whole Thinkspace, or sharing across the internet (this is local network only on purpose).
