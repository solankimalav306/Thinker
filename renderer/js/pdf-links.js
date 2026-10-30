// Clickable links on a PDF page: the links the document itself defines (to a page, or to a web address), and web
// addresses that are only printed as text. Boxes sit above the text layer, so a click on a link follows it while
// dragging across text still selects.

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'\])}]+/gi;

// Web addresses in a piece of text, with where they start and end. Closing punctuation is not part of the address.
export function findUrls(text) {
  const found = [];
  const source = String(text ?? "");
  URL_PATTERN.lastIndex = 0;
  let match;
  while ((match = URL_PATTERN.exec(source)) !== null) {
    let value = match[0].replace(/[.,;:!?]+$/, "");
    if (!value) continue;
    const href = /^www\./i.test(value) ? `https://${value}` : value;
    found.push({ start: match.index, end: match.index + value.length, text: value, href });
  }
  return found;
}

// Only web and mail addresses are followed; anything else a document can contain (file:, javascript:, ...) is not.
export function safeHref(value) {
  try {
    const url = new URL(String(value));
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function box(rect, className) {
  const el = document.createElement("a");
  el.className = className;
  el.setAttribute("role", "link");
  el.tabIndex = 0;
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  return el;
}

const activate = (el, handler) => {
  el.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); handler(); });
  el.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); handler(); } });
};

// `page` is a pdf.js page, `viewport` the one it was drawn with, `textLayer` the drawn text. Returns the layer or null.
// `onPage(number)` and `onUrl(href)` are what happens on a click.
export async function buildLinkLayer({ page, viewport, textLayer, pdfDoc, onPage, onUrl }) {
  const layer = document.createElement("div");
  layer.className = "pdf-link-layer";

  // links the document defines
  let annotations = [];
  try { annotations = await page.getAnnotations({ intent: "display" }); } catch { annotations = []; }
  for (const a of annotations) {
    if (a.subtype !== "Link" || !a.rect) continue;
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
    const rect = { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    if (rect.width < 2 || rect.height < 2) continue;

    const href = safeHref(a.url || a.unsafeUrl || "");
    if (href) {
      const el = box(rect, "pdf-link pdf-link-web");
      el.title = href;
      activate(el, () => onUrl(href));
      layer.appendChild(el);
    } else if (a.dest) {
      const el = box(rect, "pdf-link pdf-link-page");
      el.title = "Go to the linked page";
      activate(el, async () => {
        try {
          let dest = a.dest;
          if (typeof dest === "string") dest = await pdfDoc.getDestination(dest);
          if (!Array.isArray(dest) || dest[0] == null) return;
          const index = typeof dest[0] === "object" ? await pdfDoc.getPageIndex(dest[0]) : Number(dest[0]);
          if (Number.isFinite(index)) onPage(index + 1);
        } catch { /* a broken link in the document: nothing to do */ }
      });
      layer.appendChild(el);
    }
  }

  // addresses that are just printed in the text
  if (textLayer && textLayer.isConnected) {
    const origin = textLayer.getBoundingClientRect();
    for (const span of textLayer.querySelectorAll("span")) {
      const node = span.firstChild;
      if (!node || node.nodeType !== 3) continue;
      for (const hit of findUrls(node.nodeValue)) {
        const href = safeHref(hit.href);
        if (!href) continue;
        const range = document.createRange();
        range.setStart(node, hit.start);
        range.setEnd(node, hit.end);
        const r = range.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const el = box({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height }, "pdf-link pdf-link-web");
        el.title = href;
        activate(el, () => onUrl(href));
        layer.appendChild(el);
      }
    }
  }

  return layer.childElementCount ? layer : null;
}
