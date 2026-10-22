// Writes the app's annotations into a PDF as real annotation objects (Ink, Highlight, Text),
// so they stay selectable and editable in Acrobat and other readers.
//
// The renderer stores positions normalized to 0..1 of the *displayed* page, origin top-left.
// PDF annotations live in unrotated user space, origin bottom-left, so every point is mapped
// through the page's /Rotate and CropBox.
const { PDFString } = require('pdf-lib');

const DEFAULT_AUTHOR = 'Thinker';
const HIGHLIGHT_COLOR = [1, 0.92, 0.35];
const HIGHLIGHT_OPACITY = 0.35;
const FLAG_PRINT = 4;
const NOTE_ICON_SIZE = 20;

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

function parseColor(input) {
  const raw = String(input || '').trim();
  const hex = raw.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const v = hex[1];
    return { rgb: [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255), opacity: 1 };
  }
  const rgba = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => p.trim());
    const channel = (i) => Math.max(0, Math.min(255, Number(parts[i]) || 0)) / 255;
    const alpha = parts.length > 3 ? clamp01(parts[3]) : 1;
    return { rgb: [channel(0), channel(1), channel(2)], opacity: alpha };
  }
  return { rgb: [1, 0.92, 0.23], opacity: 1 };
}

// Maps normalized displayed-page coordinates to PDF user space for one page.
function makePageMapper(page) {
  const crop = page.getCropBox();
  const rotation = (((page.getRotation().angle || 0) % 360) + 360) % 360;
  const swap = rotation === 90 || rotation === 270;
  const W = crop.width;
  const H = crop.height;
  const displayWidth = swap ? H : W;
  const displayHeight = swap ? W : H;

  function toPdf(nx, ny) {
    const dx = clamp01(nx) * displayWidth;
    const dy = clamp01(ny) * displayHeight;
    let u;
    let v;
    if (rotation === 90) {
      u = dy;
      v = dx;
    } else if (rotation === 180) {
      u = W - dx;
      v = dy;
    } else if (rotation === 270) {
      u = W - dy;
      v = H - dx;
    } else {
      u = dx;
      v = H - dy;
    }
    return { x: crop.x + u, y: crop.y + v };
  }

  return { toPdf, displayWidth, displayHeight };
}

function boundingRect(points, pad = 0) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

function baseAnnotation(author, subtype, rect, color, opacity, contents) {
  const dict = {
    Type: 'Annot',
    Subtype: subtype,
    Rect: rect,
    C: color,
    CA: opacity,
    F: FLAG_PRINT,
    T: PDFString.of(author),
    M: PDFString.of(pdfDate(new Date())),
    NM: PDFString.of(`thinker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  };
  if (contents) dict.Contents = PDFString.of(contents);
  return dict;
}

function pdfDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function attach(pdfDoc, page, dict) {
  const ref = pdfDoc.context.register(pdfDoc.context.obj(dict));
  page.node.addAnnot(ref);
}

function inkStrokeWidth(path, displayWidth) {
  const norm = Number(path?.widthNorm);
  if (Number.isFinite(norm) && norm > 0) return Math.max(0.6, norm * displayWidth);
  const abs = Number(path?.width);
  if (Number.isFinite(abs) && abs > 0) return Math.max(0.6, abs * 0.8);
  return 1.5;
}

function addInk(pdfDoc, page, mapper, path, author) {
  const points = (Array.isArray(path.points) ? path.points : []).map((p) => mapper.toPdf(p.x, p.y));
  if (points.length < 2) return false;
  const { rgb, opacity } = parseColor(path.color);
  const width = inkStrokeWidth(path, mapper.displayWidth);
  const alpha = Math.max(0.1, Math.min(1, opacity < 1 ? opacity : Number(path.alpha) || 1));
  attach(pdfDoc, page, {
    ...baseAnnotation(author, 'Ink', boundingRect(points, width / 2), rgb, alpha),
    InkList: [points.flatMap((p) => [p.x, p.y])],
    BS: { Type: 'Border', W: width, S: 'S' }
  });
  return true;
}

// box: normalized { x, y, w, h } of one highlighted line of text.
function addHighlight(pdfDoc, page, mapper, box, author) {
  const w = clamp01(box.w);
  const h = clamp01(box.h);
  if (w <= 0 || h <= 0) return false;
  const tl = mapper.toPdf(box.x, box.y);
  const tr = mapper.toPdf(Number(box.x) + w, box.y);
  const bl = mapper.toPdf(box.x, Number(box.y) + h);
  const br = mapper.toPdf(Number(box.x) + w, Number(box.y) + h);
  attach(pdfDoc, page, {
    ...baseAnnotation(author, 'Highlight', boundingRect([tl, tr, bl, br]), HIGHLIGHT_COLOR, HIGHLIGHT_OPACITY),
    // Quad point order used by Acrobat in practice: top-left, top-right, bottom-left, bottom-right.
    QuadPoints: [tl.x, tl.y, tr.x, tr.y, bl.x, bl.y, br.x, br.y]
  });
  return true;
}

function addNote(pdfDoc, page, mapper, note, author) {
  const text = String(note.text || '').replace(/\r/g, '').trim().slice(0, 2000) || 'Note';
  const p = mapper.toPdf(note.x, note.y);
  const rect = [p.x, p.y - NOTE_ICON_SIZE, p.x + NOTE_ICON_SIZE, p.y];
  attach(pdfDoc, page, {
    ...baseAnnotation(author, 'Text', rect, [1, 0.88, 0.2], 1, text),
    Name: 'Comment',
    Open: false
  });
  return true;
}

// Adds every annotation to the document; returns how many were written.
function writeRealAnnotations(pdfDoc, annotationsByPage = {}, highlightBoxesByPage = {}, options = {}) {
  const author = String(options.author || '').trim().slice(0, 80) || DEFAULT_AUTHOR;
  let written = 0;
  pdfDoc.getPages().forEach((page, index) => {
    const key = String(index + 1);
    const pageData = annotationsByPage[key] || {};
    const boxes = highlightBoxesByPage[key] || [];
    const mapper = makePageMapper(page);
    for (const path of pageData.paths || []) written += addInk(pdfDoc, page, mapper, path, author) ? 1 : 0;
    for (const box of boxes) written += addHighlight(pdfDoc, page, mapper, box, author) ? 1 : 0;
    for (const note of pageData.stickyNotes || []) written += addNote(pdfDoc, page, mapper, note, author) ? 1 : 0;
  });
  return written;
}

module.exports = { writeRealAnnotations, makePageMapper, parseColor };
