// The Share window: start or stop sharing one artifact or one LaTeX project with people on the same network.
// A guest needs the link and the 6-digit code, can only look, and sees only this one thing.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, icon, onClick) {
  const b = el("button", className);
  b.type = "button";
  if (icon) b.append(el("i", `fa-solid ${icon}`), document.createTextNode(` ${label}`));
  else b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

const HOURS = [[1, "1 hour"], [4, "4 hours"], [8, "8 hours"], [24, "24 hours"]];

export function openShareDialog({ kind, id, title, api = window.electronAPI, setStatus = () => {} }) {
  const overlay = el("div", "share-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `Share ${title}`);
  const panel = el("div", "share-panel");
  overlay.append(panel);

  let share = null;
  let timer = null;

  const close = () => {
    clearInterval(timer);
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey, true);

  const copy = (text, label) => navigator.clipboard?.writeText(text).then(() => setStatus(`${label} copied.`)).catch(() => setStatus("Could not copy."));

  async function refresh() {
    const status = await api.remoteStatus();
    share = status.shares.find((s) => s.kind === kind && s.ref === id) || null;
    draw(status);
  }

  function header() {
    const head = el("div", "share-head");
    const text = el("div");
    text.append(el("h2", "", "Share"), el("p", "share-sub", title));
    const x = button("", "btn icon-btn", "fa-xmark", close);
    x.setAttribute("aria-label", "Close");
    head.append(text, x);
    return head;
  }

  function drawStart(status) {
    panel.textContent = "";
    panel.append(header());
    panel.append(el("p", "share-text", kind === "tex"
      ? "People on your network can watch the compiled PDF of this project, and it updates each time you compile. They cannot see or change your files."
      : "People on your network can view this artifact. They cannot edit it or see anything else in Thinker."));

    const scope = el("select", "sc-select");
    scope.setAttribute("aria-label", "Who can reach it");
    const hasLan = status.lan.length > 0;
    scope.append(new Option(hasLan ? "People on my network" : "People on my network (no network found)", "lan"), new Option("Only this computer (to try it out)", "local"));
    if (!hasLan) scope.value = "local";
    const hours = el("select", "sc-select");
    hours.setAttribute("aria-label", "How long");
    HOURS.forEach(([v, label]) => hours.append(new Option(`For ${label}`, String(v))));
    hours.value = "4";
    const row = el("div", "share-row");
    row.append(scope, hours);

    const go = button("Start sharing", "btn primary", "fa-share-nodes", async () => {
      go.disabled = true;
      try {
        await api.remoteShare({ kind, id, scope: scope.value, hours: Number(hours.value) });
        await refresh();
      } catch (error) {
        go.disabled = false;
        setStatus(`Could not start sharing: ${String(error?.message || error).replace(/^Error invoking remote method '[^']*': (Error: )?/, "")}`);
      }
    });
    panel.append(row, go);
    panel.append(el("p", "share-fine", "The first time, Windows may ask whether Thinker can use the network. Choose Private networks."));
  }

  function drawActive(status) {
    panel.textContent = "";
    panel.append(header());
    const links = share.urls.length ? share.urls : ["(the link appears when a network is found)"];
    panel.append(el("p", "share-text", "Tell people to open this link and enter the code."));

    const linkBox = el("div", "share-links");
    links.forEach((url) => {
      const line = el("div", "share-link");
      line.append(el("code", "", url));
      if (share.urls.length) line.append(button("Copy", "btn", "fa-copy", () => copy(url, "Link")));
      linkBox.append(line);
    });
    if (links.length > 1) linkBox.append(el("p", "share-fine", "Your computer has more than one network address. Use the one on the same network as your guests."));

    const pinRow = el("div", "share-pin");
    pinRow.append(el("span", "share-pin-label", "Code"), el("strong", "share-pin-value", share.pin), button("Copy", "btn", "fa-copy", () => copy(share.pin, "Code")));

    const left = Math.max(0, Math.round((share.expiresAt - Date.now()) / 60000));
    const guests = share.guests === 1 ? "1 person is looking" : `${share.guests} people are looking`;
    const stats = el("p", "share-stats");
    stats.textContent = `${share.guests ? guests : "No one has opened it yet"} · ends in ${left >= 60 ? `${Math.floor(left / 60)} h ${left % 60} min` : `${left} min`}`;
    if (share.locked) stats.textContent = "Locked after too many wrong codes. Stop and start again to get a new link.";

    const stop = button("Stop sharing", "btn danger", "fa-stop", async () => {
      await api.remoteEnd(share.id);
      setStatus("Stopped sharing.");
      await refresh();
    });
    panel.append(linkBox, pinRow, stats, stop);
    panel.append(el("p", "share-fine", "Anyone with the link and the code can view this. The connection is not encrypted, so share only on a network you trust."));
  }

  function draw(status) { (share ? drawActive : drawStart)(status); }

  api.onRemoteChanged?.(() => { if (overlay.isConnected) refresh().catch(() => {}); });
  timer = setInterval(() => { if (share && overlay.isConnected) refresh().catch(() => {}); }, 30000);
  document.body.append(overlay);
  refresh().catch((error) => { panel.textContent = ""; panel.append(header(), el("p", "share-text", `Sharing is not available: ${error.message}`)); });
}
