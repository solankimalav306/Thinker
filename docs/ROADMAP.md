# Thinker roadmap

Where Thinker is going. v2 is shipped (2.0.0). Each version builds on the one before.

## v2.x: finish the foundation (next)
- Step 6, the TypeScript core: drop the Python sidecar, one process, a much smaller installer.
  This is the prerequisite for v3 and v4.
- Retrieval quality (chunking, embedding model), one shared LLM provider layer, streaming replies.
- Test-connection button, Ollama detection, privacy disclosure and a local-only mode.

## v3: Thinkspaces + ThinkerTex
*Status: in progress on branch `v3`. Thinkspaces (create, documents, projects) and ThinkerTex (editor,
visual editor, compile, preview, agent) work; cross-document chat, SyncTeX and packaging remain.*
Two halves of one release.
- **Thinkspaces**: projects that group PDFs and the chats, notes, glossary and mind maps around them,
  with questions that span several documents. See `docs/PLAN-THINKSPACES.md`.
- **ThinkerTex**: an Overleaf-style LaTeX studio (file tree, editor, live preview, compile) with an AI
  agent that writes LaTeX using the same key. It stands on its own: a project can live anywhere (its own,
  any folder, next to a PDF, or inside a Thinkspace). In a Thinkspace the agent can also use that
  Thinkspace's PDFs. See `docs/PLAN-LATEX.md`.
- Thinker stops being only a reader: you read, ask, and then write, in one place.
- Open questions: how a Thinkspace is created (by hand, from a folder, or both); annotations per
  document or shared; whether to include a compare view.

## v4: Thinker Remote (same network)
The laptop or PC becomes the **host**. A phone, tablet or another computer on the same Wi-Fi opens
Thinker in a browser and uses the host's documents, chats and models, much like Claude Code's
remote use.

### How it should feel
1. On the host: Settings > Remote > turn on. Off by default.
2. The host shows a QR code and a short address (for example `https://192.168.1.20:7788`).
3. On the other device: scan, tap Approve on the host, done. The device is paired and listed.
4. The reader, annotations, chats and Thinkspaces work the same, laid out for a touch screen.

### What stays on the host
Documents, the search index, API keys, and all model calls. The remote device only draws the
interface. Keys are never sent to it.

### Security (the part to get right)
- Opt-in, and local network only. Bind to the LAN address; refuse requests from outside private
  address ranges. No relay and no internet exposure in v4.
- Pairing: one-time code in the QR, expires in minutes, host must approve. Each device gets its own
  revocable token; Settings lists devices (name, last seen) with a Revoke button.
- Encrypted in transit: HTTPS with a self-signed certificate created on the host, pinned through
  the QR code so the first connection cannot be intercepted.
- Permissions per device: **read only** (browse, search, ask) or **full** (annotate, save, edit
  settings that do not touch keys). A host-side "pause remote" switch.
- Origin checks, rate limiting and request size limits; the same input validation as the local IPC.
- A visible "Remote is on, 2 devices connected" indicator on the host so it never runs silently.

### What it needs first (why this is v4)
- The TypeScript core (step 6), so one process can serve both the desktop window and the network.
- The IPC layer turned into a transport-agnostic API (the same calls over Electron IPC or
  HTTP + WebSocket). This is also the groundwork for the "web version" idea.
- A responsive/touch layout and a pass on file access: remote devices open host files by document
  id, never by path.

### Phases
1. Transport abstraction and a local-only HTTP/WebSocket server behind a flag.
2. Pairing, tokens, TLS and the device list.
3. Touch-friendly reader and chat layout; read-only mode first.
4. Annotate/save over remote, conflict handling when the host and a device edit together.
5. Optional later: access away from home through a user-run tunnel, not a Thinker-run server.

### Risks and open questions
- Windows Firewall prompt on first enable; explain it in plain words.
- Host asleep or closed: show a clear "host unavailable" state; consider a wake or keep-awake option.
- Large PDFs over weak Wi-Fi: stream page by page, cache rendered pages on the device.
- Two people on one document: last-writer-wins at first, per-annotation merge later.
