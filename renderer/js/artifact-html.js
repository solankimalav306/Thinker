// The pure parts of artifacts: finding them in a reply and checking their citations.
// (Showing them safely is artifact-view.js and the sandboxed frame.)

const MAX_TITLE = 80;

export function cleanTitle(raw) {
  return decode(String(raw || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) || "Artifact";
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&apos;": "'" };
const decode = (text) => String(text).replace(/&(?:amp|lt|gt|quot|apos|#39|#x27);/g, (m) => ENTITIES[m] ?? m);

// The kinds an artifact can be (see artifact-spec.js for what each is). Kept in step with that list.
export const ARTIFACT_KINDS = ["checklist", "steps", "quiz", "flashcards", "table", "chart", "diagram", "timeline", "document", "slides", "page"];
const spec = () => globalThis.TKSpec;

// The kind the model named, or a guess from what it wrote. Only used to label and filter; it never changes how a page is shown.
export function artifactKind(declared, html) {
  const named = String(declared || "").trim().toLowerCase();
  if (ARTIFACT_KINDS.includes(named)) return named;
  const body = String(html || "");
  if (/class\s*=\s*["'][^"']*\btk-slide\b/i.test(body)) return "slides";
  if (/class\s*=\s*["'][^"']*\btk-doc\b/i.test(body)) return "document";
  if (/<svg\b/i.test(body)) return "chart";
  if (/<table\b/i.test(body)) return "table";
  return "page";
}

// Splits a reply into text and artifact parts. An artifact that was never closed (the reply was cut off)
// is still shown, marked incomplete.
export function splitArtifacts(reply) {
  const text = String(reply ?? "")
    .replace(/```(?:html)?\s*(<artifact\b)/gi, "$1")
    .replace(/(<\/artifact>)\s*```/gi, "$1");
  const parts = [];
  const open = /<artifact\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let cursor = 0;
  let match;
  while ((match = open.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ type: "text", text: text.slice(cursor, match.index) });
    const bodyStart = match.index + match[0].length;
    const closeAt = text.toLowerCase().indexOf("</artifact>", bodyStart);
    const complete = closeAt !== -1;
    const body = text.slice(bodyStart, complete ? closeAt : text.length);
    const title = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[1]);
    const type = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[1]);
    const html = body.trim();
    const kind = artifactKind(type ? type[1] ?? type[2] : "", html);
    const part = { type: "artifact", title: cleanTitle(title ? title[1] ?? title[2] : ""), html, kind, complete };
    // a kind drawn from data arrives as JSON; what cannot be read is shown as a note, never as a broken card
    if (spec()?.isLive(kind)) {
      const parsed = spec().parse(kind, html);
      if (parsed.ok) { part.html = ""; part.spec = parsed.spec; }
      else if (/<[a-z][\s\S]*>/i.test(html) && !/^\s*[{\[]/.test(html)) { /* written as a page, before these kinds were drawn from data: shown as a page */ }
      else { part.html = ""; part.error = complete ? parsed.error : "This one was cut off before it was finished."; }
    }
    parts.push(part);
    cursor = complete ? closeAt + "</artifact>".length : text.length;
    open.lastIndex = cursor;
  }
  if (cursor < text.length) parts.push({ type: "text", text: text.slice(cursor) });
  return parts.filter((p) => p.type === "artifact" || p.text.trim() !== "");
}

// Every data-cite="Title|page" must name a document and page the answer was actually given. The rest are
// marked unverified (shown, but not clickable) so a made-up reference can never look real.
export function validateCitations(html, sources) {
  const allowed = new Set((sources || []).map((s) => `${String(s.doc).trim().toLowerCase()}|${Number(s.page)}`));
  const valid = [];
  let invalid = 0;
  const out = String(html).replace(/\sdata-cite="([^"]*)"/g, (whole, value) => {
    const raw = decode(value);
    const at = raw.lastIndexOf("|");
    const key = at === -1 ? "" : `${raw.slice(0, at).trim().toLowerCase()}|${parseInt(raw.slice(at + 1), 10)}`;
    if (at !== -1 && allowed.has(key)) {
      valid.push({ doc: raw.slice(0, at).trim(), page: parseInt(raw.slice(at + 1), 10) });
      return whole;
    }
    invalid += 1;
    return ' data-cite-unverified="1" title="This reference could not be checked against the sources"';
  });
  return { html: out, valid, invalid };
}

// Colour tokens passed into the frame, named by the app's own CSS variables.
export const TOKEN_MAP = {
  "--tk-bg": "--surface",
  "--tk-surface": "--surface-2",
  "--tk-sunken": "--sunken",
  "--tk-text": "--text",
  "--tk-text-2": "--text-2",
  "--tk-text-3": "--text-3",
  "--tk-border": "--border",
  "--tk-primary": "--primary",
  "--tk-on-primary": "--on-primary",
  "--tk-bad": "--danger"
};
