// Shows an AI-written HTML artifact safely: cleaned here, shown in a sandboxed frame that is cleaned again,
// with citations checked against what the answer was really given, and only a few fixed actions allowed back.
import { validateCitations, TOKEN_MAP } from "./artifact-html.js";
import { specToHtml, specToText } from "./artifact-static.js";

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
// the design kit, plus what maths needs; both go into the frame as text, because the frame loads no stylesheets
function loadKitCss() {
  if (!kitCssPromise) {
    const get = (url) => fetch(url).then((r) => r.text()).catch(() => "");
    kitCssPromise = Promise.all([get("css/artifact-kit.css"), get("vendor/katex/katex.min.css")]).then(([kit, katex]) => `${kit}\n${katex}`);
  }
  return kitCssPromise;
}

// Progress inside a chat card is remembered on this computer, keyed by the content, so reopening the chat keeps your ticks.
let mathCssPromise = null;
const loadMathCss = () => (mathCssPromise ||= fetch("vendor/katex/katex.min.css").then((r) => r.text()).catch(() => ""));

// A full web page (it has scripts or is a whole document) runs in its own sealed frame instead of being cleaned into a static card.
export const isScriptPage = (kind, html) => kind === "page" && /<script\b|<!doctype|<html\b/i.test(String(html || ""));

// the references a script page cites, checked against what the answer was given
function checkHtmlCitations(html, sources) {
  const allowed = new Set((sources || []).map((s) => `${String(s.doc).trim().toLowerCase()}|${Number(s.page)}`));
  const valid = [];
  const bad = [];
  for (const m of String(html).matchAll(/data-cite\s*=\s*"([^"]*)"/g)) {
    const c = m[1];
    const at = c.lastIndexOf("|");
    const doc = c.slice(0, at).trim();
    const page = parseInt(c.slice(at + 1), 10);
    if (at > 0 && allowed.has(`${doc.toLowerCase()}|${page}`)) valid.push({ doc, page }); else bad.push(c);
  }
  return { valid, bad: [...new Set(bad)], invalid: new Set(bad).size };
}

const hashOf = (text) => { let h = 5381; for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; return h.toString(36); };
function recall(key) { try { return JSON.parse(localStorage.getItem(key) || "null") || {}; } catch { return {}; } }
function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is a convenience */ } }

// Which of a spec's references the answer was really given, as { "Doc|2": true/false } plus the list that may open a page.
function checkSpecCitations(kind, spec, sources) {
  const allowed = new Set((sources || []).map((s) => `${String(s.doc).trim().toLowerCase()}|${Number(s.page)}`));
  const map = {};
  const valid = [];
  for (const c of globalThis.TKSpec?.citations(kind, spec) || []) {
    const at = c.lastIndexOf("|");
    const doc = c.slice(0, at).trim();
    const page = parseInt(c.slice(at + 1), 10);
    const ok = at > 0 && allowed.has(`${doc.toLowerCase()}|${page}`);
    map[c] = ok;
    if (ok) valid.push({ doc, page });
  }
  return { map, valid, invalid: Object.values(map).filter((ok) => !ok).length };
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
function mountFrame({ html, valid, onCite, minHeight = 80, maxHeight, label, extraCss = "", fixed = false, kind = "", spec = null, state = null, citeMap = null, onState = null, script = null }) {
  const frame = document.createElement("iframe");
  frame.className = "art-iframe";
  frame.title = label;
  // scripts are allowed only so the frame's own bridge can run; the page it loads has a policy that
  // refuses everything else, and there is no same-origin access to the app
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.style.height = `${minHeight}px`;
  const FRAME_URL = script ? "thinker-artifact://frame/artifact-live.html" : "thinker-artifact://frame/artifact-frame.html";
  frame.src = FRAME_URL;
  let lastBeat = Date.now();
  let stalled = null;
  const pending = new Map();
  // what a script page shows right now, as plain content for the export formats
  frame.snapshot = () => new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    pending.set(id, resolve);
    frame.contentWindow?.postMessage({ type: "snapshot", id }, "*");
    setTimeout(() => { if (pending.delete(id)) reject(new Error("The page did not answer")); }, 4000);
  });

  const cites = new Set(valid.map((c) => `${c.doc.toLowerCase()}|${c.page}`));

  const send = async () => {
    if (script) {
      lastBeat = Date.now();
      frame.contentWindow?.postMessage({ type: "run", html, state: state || {}, bad: script.bad, css: await loadMathCss(), tokens: readTokens() }, "*");
      return;
    }
    const css = (await loadKitCss()) + extraCss;
    const fit = !maxHeight || fixed;
    frame.contentWindow?.postMessage(spec ? { type: "render", kind, spec, state: state || {}, cites: citeMap || {}, css, tokens: readTokens(), fit } : { type: "render", html, css, tokens: readTokens(), fit }, "*");
  };

  const onMessage = (event) => {
    if (!frame.isConnected) { window.removeEventListener("message", onMessage); return; }
    if (event.source !== frame.contentWindow) return;
    const data = event.data || {};
    if (data.type === "ready") send();
    else if (data.type === "beat") lastBeat = Date.now();
    else if (data.type === "snapshot" && pending.has(data.id)) { pending.get(data.id)({ body: String(data.body || ""), css: String(data.css || "") }); pending.delete(data.id); }
    else if (data.type === "state" && data.value && typeof data.value === "object") onState?.(data.value);
    else if (data.type === "height" && Number.isFinite(data.value) && !fixed && !(script && script.fillHeight)) {
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

  // a page that stops answering (a runaway loop) is taken away so it cannot freeze the app
  if (script) {
    const watch = setInterval(() => {
      if (!frame.isConnected && !stalled) { clearInterval(watch); return; }
      if (stalled || Date.now() - lastBeat < 9000) return;
      const note = el("div", "art-empty");
      note.append(document.createTextNode("This page stopped responding, so it was stopped. "));
      const again = el("button", "art-more", "Run it again");
      again.type = "button";
      again.addEventListener("click", () => { lastBeat = Date.now(); stalled = null; note.replaceWith(frame); frame.src = FRAME_URL; });
      note.append(again);
      stalled = note;
      frame.replaceWith(note);
      frame.src = "about:blank";
    }, 3000);
  }

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

// Quick ways to ask the AI for something made from an artifact, plus a box for anything else.
function askMenu(onAsk) {
  const wrap = el("span", "art-menu-wrap");
  const trigger = iconButton("fa-wand-magic-sparkles", "Ask the AI to change this or make something from it", () => {
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      const r = trigger.getBoundingClientRect();
      menu.style.top = `${Math.round(r.bottom + 4)}px`;
      menu.style.right = `${Math.round(window.innerWidth - r.right)}px`;
      box.focus();
    }
  });
  trigger.setAttribute("aria-haspopup", "menu");
  const menu = el("div", "art-menu");
  menu.hidden = true;
  const run = (text) => { menu.hidden = true; onAsk(text); };
  for (const [label, icon, text] of [
    ["Make slides", "fa-display", "Make slides from this artifact"],
    ["Make a report", "fa-file-lines", "Make a one-page report document from this artifact"],
    ["Make a quiz", "fa-circle-question", "Make a quiz from this artifact"],
    ["Make a web page", "fa-globe", "Make a web page from this artifact"]
  ]) {
    const item = el("button", "art-menu-item");
    item.type = "button";
    item.append(el("i", `fa-solid ${icon}`), document.createTextNode(` ${label}`));
    item.addEventListener("click", () => run(text));
    menu.append(item);
  }
  const box = el("input", "art-menu-input");
  box.type = "text";
  box.placeholder = "Or ask for a change\u2026";
  box.setAttribute("aria-label", "Ask for a change to this artifact");
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && box.value.trim()) { const t = box.value.trim(); box.value = ""; run(`Change this artifact: ${t}`); } });
  menu.append(box);
  const away = (e) => { if (!wrap.isConnected) document.removeEventListener("mousedown", away, true); else if (!wrap.contains(e.target)) menu.hidden = true; };
  document.addEventListener("mousedown", away, true);
  wrap.append(trigger, menu);
  return wrap;
}

export function createArtifactView({ title, html, spec = null, error = "", complete = true, sources, onCite, onSave, onKeep, onState, onAsk = null, state = null, kind = "page", onOpenTab = null, inTab = false }) {
  const live = Boolean(spec);
  const box = el("section", "art-frame");
  box.setAttribute("aria-label", `Artifact: ${title}`);

  const head = el("div", "art-head");
  const heading = el("div", "art-title");
  const known = globalThis.TKSpec?.TYPES?.[kind];
  heading.append(el("i", `fa-solid ${known?.icon || "fa-wand-magic-sparkles"}`), el("strong", "", title), el("span", "art-badge", known && live ? `${known.label} \u00b7 AI-generated` : "AI-generated"));
  const tools = el("div", "art-tools");
  head.append(heading, tools);
  box.append(head);

  if (error) {
    box.append(el("p", "art-empty", `This ${known?.label?.toLowerCase() || "artifact"} could not be shown. ${error}`));
    return box;
  }

  const scriptPage = !live && isScriptPage(kind, html);
  let checked;
  let citeInfo = null;
  let scriptInfo = null;
  if (scriptPage) {
    // the page is kept exactly as written: it runs in a frame that cannot reach anything, so it is not cleaned into a static card
    scriptInfo = checkHtmlCitations(html, sources);
    checked = { html: String(html).slice(0, 200000), valid: scriptInfo.valid, invalid: scriptInfo.invalid };
  } else if (live) {
    citeInfo = checkSpecCitations(kind, spec, sources);
    // the plain version is what exports, copies and the library work from
    checked = { html: specToHtml(kind, spec), valid: citeInfo.valid, invalid: citeInfo.invalid };
  } else {
    checked = validateCitations(sanitizeArtifact(html), sources);
    if (!checked.html.trim()) {
      box.append(el("p", "art-empty", "This content could not be displayed safely."));
      return box;
    }
  }

  // ticks and answers: remembered with the artifact in the library, or on this computer for a card in a chat
  const stateKey = live && !onState ? `thinker.artstate.${hashOf(JSON.stringify(spec))}` : "";
  let current = state && typeof state === "object" ? state : (stateKey ? recall(stateKey) : {});
  const saveState = (value) => { current = value; if (onState) onState(value); else if (stateKey) remember(stateKey, value); };
  const liveFrame = live ? { kind, spec, cites: citeInfo.map, getState: () => current, onState: saveState } : null;

  const inline = mountFrame({
    html: checked.html, valid: checked.valid, onCite, label: title, maxHeight: inTab ? undefined : () => Math.max(360, window.innerHeight * 0.7), minHeight: inTab ? 240 : (scriptPage ? 360 : 80),
    ...(live ? { kind, spec, state: current, citeMap: citeInfo.map, onState: saveState } : {}),
    ...(scriptPage ? { state: current, onState: saveState, script: { bad: scriptInfo.bad, fillHeight: inTab } } : {})
  });
  if (scriptPage && inTab) inline.style.height = "max(640px, 80vh)";
  box.append(inline);
  if (scriptPage) box.append(el("p", "art-note", "This page runs its own code in a sealed frame: it cannot connect to the internet or reach your files."));
  if (!complete) box.append(el("p", "art-note", "The reply was cut off, so this may be unfinished."));
  if (checked.invalid) box.append(el("p", "art-note", `${checked.invalid} reference${checked.invalid === 1 ? "" : "s"} could not be checked against the sources and ${checked.invalid === 1 ? "is" : "are"} shown dashed.`));

  // "Open larger" is a tab of its own when the app can open one, and a window over the page otherwise
  const openBig = () => (onOpenTab
    ? onOpenTab({ title, html: live ? "" : checked.html, spec: live ? spec : null, kind, state: current, sources: sources || [], onCite, onKeep })
    : openLarge({ title, checked, onCite, live: liveFrame, script: scriptPage ? { bad: scriptInfo.bad, state: current, onState: saveState } : null }));
  if (!inTab) {
    const foot = el("div", "art-foot");
    const bigger = el("button", "art-more");
    bigger.type = "button";
    bigger.append(el("i", "fa-solid fa-up-right-and-down-left-from-center"), document.createTextNode(onOpenTab ? " Open in a tab" : " Open larger"));
    bigger.addEventListener("click", openBig);
    foot.append(bigger);
    box.append(foot);
  }

  if (onKeep) {
    const keep = iconButton("fa-bookmark", "Save to Artifacts", async () => {
      keep.disabled = true;
      try {
        await onKeep({ title, html: live ? "" : checked.html, spec: live ? spec : null, state: current, kind, sources: checked.valid });
        keep.firstChild.className = "fa-solid fa-circle-check";
        keep.title = "Saved to Artifacts";
        keep.setAttribute("aria-label", "Saved to Artifacts");
      } catch {
        keep.disabled = false;
      }
    });
    tools.append(keep);
  }
  if (onAsk) tools.append(askMenu(onAsk));
  if (!inTab) tools.append(iconButton("fa-up-right-and-down-left-from-center", onOpenTab ? "Open in a tab" : "Open larger", openBig));
  tools.append(
    iconButton("fa-copy", live ? "Copy as text" : "Copy the HTML", () => navigator.clipboard?.writeText(live ? specToText(kind, spec) : checked.html).catch(() => {}))
  );
  const slides = live ? [] : slideHtml(checked.html);
  if (slides.length) tools.prepend(iconButton("fa-display", "Present as slides", () => openPresent({ title, slides, onCite })));
  tools.append(exportMenu({ title, checked, kind, onSave, scriptPage, snapshot: () => inline.snapshot() }));
  return box;
}

// the .tk-slide elements of an artifact, one HTML string each
function slideHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return [...doc.querySelectorAll(".tk-slide")].map((node) => node.outerHTML);
}

const withoutCites = (html) => html.replace(/\sdata-cite(-unverified)?="[^"]*"/g, "");

// One slide at a time, 16:9, with the keyboard. Each slide is shown in the same sealed frame as everything else.
function openPresent({ title, slides, onCite }) {
  const overlay = el("div", "art-present");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `${title}: presentation`);
  const stage = el("div", "art-present-stage");
  const counter = el("span", "art-present-count");
  const bar = el("div", "art-present-bar");
  let index = 0;
  let frame = null;

  const SLIDE_CSS = "html,body{overflow:hidden}#root{padding:0;height:100vh}.tk-slide{height:100%;width:100%;margin:0;border:0;border-radius:0;aspect-ratio:auto;padding:5% 7%;font-size:26px}.tk-slide h1,.tk-slide h2{font-size:2.3rem}";
  const fit = () => {
    const scale = Math.min(overlay.clientWidth / 960, (overlay.clientHeight - 56) / 540);
    stage.style.transform = `scale(${Math.max(scale, 0.2)})`;
  };
  const show = (n) => {
    index = Math.max(0, Math.min(slides.length - 1, n));
    frame?.remove();
    const checked = { html: slides[index], valid: [] };
    frame = mountFrame({ html: checked.html, valid: checked.valid, onCite, label: `${title}, slide ${index + 1}`, minHeight: 540, maxHeight: () => 540, extraCss: SLIDE_CSS, fixed: true });
    frame.style.width = "960px";
    frame.style.height = "540px";
    stage.append(frame);
    counter.textContent = `${index + 1} / ${slides.length}`;
  };
  const prev = iconButton("fa-chevron-left", "Previous slide", () => show(index - 1));
  const next = iconButton("fa-chevron-right", "Next slide", () => show(index + 1));
  const close = iconButton("fa-xmark", "End presentation", () => done());
  bar.append(prev, counter, next, close);
  overlay.append(stage, bar);

  const onKey = (e) => {
    const go = { ArrowRight: 1, PageDown: 1, " ": 1, ArrowDown: 1, ArrowLeft: -1, PageUp: -1, ArrowUp: -1 }[e.key];
    if (e.key === "Escape") { e.stopPropagation(); done(); }
    else if (go) { e.preventDefault(); e.stopPropagation(); show(index + go); }
    else if (e.key === "Home") show(0);
    else if (e.key === "End") show(slides.length - 1);
  };
  const done = () => {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", fit);
    document.removeEventListener("fullscreenchange", onFullscreen);
    overlay.remove();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
  const onFullscreen = () => { if (!document.fullscreenElement) done(); else fit(); };
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", fit);
  document.body.append(overlay);
  show(0);
  fit();
  overlay.requestFullscreen?.().then(() => document.addEventListener("fullscreenchange", onFullscreen)).catch(() => {});
  close.focus();
}

// A small menu of ways to take an artifact out of the app.
function exportMenu({ title, checked, kind, onSave, scriptPage = false, snapshot = null }) {
  const wrap = el("span", "art-menu-wrap");
  const trigger = iconButton("fa-download", "Export", () => {
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      // fixed, so the card's edges never clip it
      const r = trigger.getBoundingClientRect();
      menu.style.top = `${Math.round(r.bottom + 4)}px`;
      menu.style.right = `${Math.round(window.innerWidth - r.right)}px`;
    }
  });
  trigger.setAttribute("aria-haspopup", "menu");
  const menu = el("div", "art-menu");
  menu.hidden = true;
  menu.setAttribute("role", "menu");

  const api = () => window.electronAPI;
  const notify = (result, label) => {
    if (result?.ok) window.dispatchEvent(new CustomEvent("thinker:status", { detail: `Saved ${label}.` }));
    else if (!result?.canceled) window.dispatchEvent(new CustomEvent("thinker:status", { detail: `Could not export: ${result?.error || "unknown error"}` }));
  };
  const clean = () => withoutCites(checked.html);
  // a script page is exported as it looks now (cleaned like any other artifact, scripts gone); the others from their stored content
  const prepare = async () => {
    if (!scriptPage) return { html: clean(), css: "" };
    const shot = await snapshot();
    if (!shot.body.trim()) throw new Error("This page is too large to export");
    return { html: withoutCites(sanitizeArtifact(shot.body)), css: shot.css.replace(/<\/style/gi, "") };
  };
  const standalone = async (tokens, prepared) => {
    const p = prepared || await prepare();
    return standaloneDocument(title, p.html, `${await loadKitCss()}\n${p.css}`, tokens);
  };

  // the HTML file of a page with scripts is the page as written (with a stand-in for the app's save helper)
  const withShim = (page) => (/<head[^>]*>/i.test(page) ? page.replace(/<head[^>]*>/i, (m) => `${m}<script>window.tk=window.tk||{state:{},save(){},copy(){}}</script>`) : `<script>window.tk={state:{},save(){},copy(){}}</script>${page}`);
  const items = [
    ["HTML page", "fa-code", async () => onSave?.({ title, content: scriptPage ? withShim(withoutCites(checked.html)) : await standalone(readTokens()) })],
    ["PDF", "fa-file-pdf", async () => notify(await api().exportArtifact({ format: "pdf", title, html: await standalone(scriptPage ? readTokens() : {}), kindOfArtifact: kind }), "PDF")],
    ["Image (PNG)", "fa-image", async () => notify(await api().exportArtifact({ format: "png", title, html: await standalone(scriptPage ? readTokens() : {}) }), "image")],
    ["Word (.docx)", "fa-file-word", async () => {
      const { extractBlocks } = await import("./artifact-blocks.js");
      const p = await prepare();
      notify(await api().exportArtifact({ format: "docx", title, html: await standalone({}, p), blocks: extractBlocks(p.html), withImage: /<svg\b/i.test(p.html) }), "Word document");
    }],
    ["PowerPoint (.pptx)", "fa-file-powerpoint", async () => {
      const { extractSlides } = await import("./artifact-blocks.js");
      const p = await prepare();
      notify(await api().exportArtifact({ format: "pptx", title, html: await standalone({}, p), slides: extractSlides(p.html, title), withImage: /<svg\b/i.test(p.html) }), "presentation");
    }]
  ];
  for (const [label, icon, run] of items) {
    const item = el("button", "art-menu-item");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.append(el("i", `fa-solid ${icon}`), document.createTextNode(` ${label}`));
    item.addEventListener("click", async () => { menu.hidden = true; try { await run(); } catch (error) { notify({ error: error.message }); } });
    menu.append(item);
  }
  const away = (e) => { if (!wrap.isConnected) document.removeEventListener("mousedown", away, true); else if (!wrap.contains(e.target)) menu.hidden = true; };
  document.addEventListener("mousedown", away, true);
  wrap.append(trigger, menu);
  return wrap;
}

function openLarge({ title, checked, onCite, live = null, script = null }) {
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
  const frame = mountFrame({
    html: checked.html, valid: checked.valid, onCite: (c) => { done(); onCite?.(c); }, label: title, minHeight: 200, maxHeight: () => window.innerHeight * 0.82,
    ...(live ? { kind: live.kind, spec: live.spec, state: live.getState(), citeMap: live.cites, onState: live.onState } : {}),
    ...(script ? { state: script.state, onState: script.onState, script: { bad: script.bad, fillHeight: false } } : {})
  });
  panel.append(bar, frame);
  overlay.append(panel);
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(); } };
  const done = () => { document.removeEventListener("keydown", onKey, true); overlay.remove(); };
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  close.focus();
}
