// Shows an AI-written HTML artifact safely: cleaned here, shown in a sandboxed frame that is cleaned again,
// with citations checked against what the answer was really given, and only a few fixed actions allowed back.
import { validateCitations, TOKEN_MAP } from "./artifact-html.js";

const ALLOWED_DATA = new Set(["data-cite", "data-action", "data-text", "data-page", "data-cite-unverified"]);
const CONFIG = {
  USE_PROFILES: { html: true, svg: true },
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link", "meta", "base", "frame", "frameset", "audio", "video", "source", "foreignObject"],
  FORBID_ATTR: ["srcdoc", "formaction", "action", "ping", "target"],
  ALLOW_DATA_ATTR: true,
  ALLOWED_URI_REGEXP: /^(?:#|data:image\/(?:png|jpe?g|gif|webp);base64,)/i
};

let purifier = null;
function getPurifier() {
  if (purifier) return purifier;
  if (!window.DOMPurify) return null;
  // its own instance, so these rules do not change how the rest of the app cleans HTML
  purifier = typeof window.DOMPurify === "function" ? window.DOMPurify(window) : window.DOMPurify;
  purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName.startsWith("data-") && !ALLOWED_DATA.has(data.attrName)) data.keepAttr = false;
  });
  return purifier;
}

export function sanitizeArtifact(html) {
  const p = getPurifier();
  if (!p) return "";
  return p.sanitize(String(html ?? "").slice(0, 200000), CONFIG);
}

let kitCssPromise = null;
function loadKitCss() {
  if (!kitCssPromise) kitCssPromise = fetch("css/artifact-kit.css").then((r) => r.text()).catch(() => "");
  return kitCssPromise;
}

function isDark() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit) return explicit === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

export function readTokens() {
  const style = getComputedStyle(document.documentElement);
  const tokens = {};
  for (const [token, variable] of Object.entries(TOKEN_MAP)) {
    const value = style.getPropertyValue(variable).trim();
    if (value) tokens[token] = value;
  }
  const dark = isDark();
  tokens["--tk-scheme"] = dark ? "dark" : "light";
  tokens["--tk-good"] = dark ? "#4ade80" : "#15803d";
  tokens["--tk-warn"] = dark ? "#fbbf24" : "#b45309";
  tokens["--tk-info"] = tokens["--tk-primary"] || (dark ? "#8b85ff" : "#4f46e5");
  return tokens;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(icon, title, onClick) {
  const b = el("button", "art-btn");
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.append(el("i", `fa-solid ${icon}`));
  b.addEventListener("click", onClick);
  return b;
}

// A frame showing `html`. It reports its height and relays the few actions it is allowed to.
function mountFrame({ html, valid, onCite, minHeight = 80, maxHeight, label }) {
  const frame = document.createElement("iframe");
  frame.className = "art-iframe";
  frame.title = label;
  // scripts are allowed only so the frame's own bridge can run; the page it loads has a policy that
  // refuses everything else, and there is no same-origin access to the app
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.style.height = `${minHeight}px`;
  frame.src = "thinker-artifact://frame/artifact-frame.html";

  const cites = new Set(valid.map((c) => `${c.doc.toLowerCase()}|${c.page}`));

  const send = async () => {
    const css = await loadKitCss();
    frame.contentWindow?.postMessage({ type: "render", html, css, tokens: readTokens() }, "*");
  };

  const onMessage = (event) => {
    if (!frame.isConnected) { window.removeEventListener("message", onMessage); return; }
    if (event.source !== frame.contentWindow) return;
    const data = event.data || {};
    if (data.type === "ready") send();
    else if (data.type === "height" && Number.isFinite(data.value)) {
      const limit = maxHeight ? maxHeight() : Infinity;
      frame.style.height = `${Math.max(minHeight, Math.min(Math.ceil(data.value), limit))}px`;
    } else if (data.type === "action") {
      if (typeof data.cite === "string") {
        const at = data.cite.lastIndexOf("|");
        const doc = data.cite.slice(0, at).trim();
        const page = parseInt(data.cite.slice(at + 1), 10);
        // only a citation that passed the check can open anything
        if (at > 0 && cites.has(`${doc.toLowerCase()}|${page}`)) onCite?.({ doc, page });
      } else if (data.action === "copy" && typeof data.text === "string" && data.text) {
        navigator.clipboard?.writeText(data.text.slice(0, 5000)).catch(() => {});
      }
    }
  };
  window.addEventListener("message", onMessage);

  const retheme = new MutationObserver(() => frame.contentWindow?.postMessage({ type: "theme", tokens: readTokens() }, "*"));
  retheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return frame;
}

// A standalone page that keeps working outside the app: the kit and the colours are inlined, nothing is loaded.
export function standaloneDocument(title, html, css, tokens) {
  const vars = Object.entries(tokens).filter(([k]) => /^--tk-[a-z0-9-]+$/.test(k) && k !== "--tk-scheme").map(([k, v]) => `${k}:${v}`).join(";");
  const safeTitle = String(title).replace(/[<>&"]/g, "");
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${safeTitle}</title>\n<style>:root{${vars}}\n${css}</style></head>\n<body><div id="root">${html}</div></body></html>\n`;
}

export function createArtifactView({ title, html, complete = true, sources, onCite, onSave }) {
  const clean = sanitizeArtifact(html);
  const checked = validateCitations(clean, sources);
  const box = el("section", "art-frame");
  box.setAttribute("aria-label", `Artifact: ${title}`);

  const head = el("div", "art-head");
  const heading = el("div", "art-title");
  heading.append(el("i", "fa-solid fa-wand-magic-sparkles"), el("strong", "", title), el("span", "art-badge", "AI-generated"));
  const tools = el("div", "art-tools");
  head.append(heading, tools);
  box.append(head);

  if (!clean.trim()) {
    box.append(el("p", "art-empty", "This content could not be displayed safely."));
    return box;
  }

  const inline = mountFrame({ html: checked.html, valid: checked.valid, onCite, label: title, maxHeight: () => Math.max(300, window.innerHeight * 0.6) });
  box.append(inline);
  if (!complete) box.append(el("p", "art-note", "The reply was cut off, so this may be unfinished."));
  if (checked.invalid) box.append(el("p", "art-note", `${checked.invalid} reference${checked.invalid === 1 ? "" : "s"} could not be checked against the sources and ${checked.invalid === 1 ? "is" : "are"} shown dashed.`));

  const foot = el("div", "art-foot");
  const bigger = el("button", "art-more");
  bigger.type = "button";
  bigger.append(el("i", "fa-solid fa-up-right-and-down-left-from-center"), document.createTextNode(" Open larger"));
  bigger.addEventListener("click", () => openLarge({ title, checked, onCite }));
  foot.append(bigger);
  box.append(foot);

  tools.append(
    iconButton("fa-up-right-and-down-left-from-center", "Open larger", () => openLarge({ title, checked, onCite })),
    iconButton("fa-copy", "Copy the HTML", () => navigator.clipboard?.writeText(checked.html).catch(() => {})),
    iconButton("fa-floppy-disk", "Save as an HTML file", async () => {
      const css = await loadKitCss();
      onSave?.({ title, content: standaloneDocument(title, checked.html.replace(/\sdata-cite(-unverified)?="[^"]*"/g, ""), css, readTokens()) });
    })
  );
  return box;
}

function openLarge({ title, checked, onCite }) {
  const overlay = el("div", "art-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title);
  const panel = el("div", "art-overlay-panel");
  const bar = el("div", "art-head");
  const heading = el("div", "art-title");
  heading.append(el("strong", "", title), el("span", "art-badge", "AI-generated"));
  const close = iconButton("fa-xmark", "Close", () => done());
  bar.append(heading, close);
  const frame = mountFrame({ html: checked.html, valid: checked.valid, onCite: (c) => { done(); onCite?.(c); }, label: title, minHeight: 200, maxHeight: () => window.innerHeight * 0.82 });
  panel.append(bar, frame);
  overlay.append(panel);
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(); } };
  const done = () => { document.removeEventListener("keydown", onKey, true); overlay.remove(); };
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  close.focus();
}
