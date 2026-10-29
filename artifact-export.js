// Turns an artifact's content into a Word or PowerPoint file. The renderer reads the cleaned page into plain
// blocks (headings, paragraphs, lists, tables, one picture); nothing here ever sees or runs the HTML.
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, AlignmentType
} = require('docx');
const PptxGenJS = require('pptxgenjs');

const MAX_BLOCKS = 2000;
const MAX_SLIDES = 100;
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

const str = (v, max = 4000) => String(v ?? '').slice(0, max);

function pngBuffer(data) {
  const raw = String(data || '').replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(raw, 'base64');
  const isPng = buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47;
  if (!isPng) return null;
  return { buffer, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const runs = (list, extra = {}) => (Array.isArray(list) && list.length ? list : [{ text: '' }])
  .slice(0, 400)
  .map((r) => new TextRun({ text: str(r.text), bold: Boolean(r.bold), italics: Boolean(r.italic), font: r.code ? 'Consolas' : undefined, ...extra }));

async function buildDocx({ title, blocks }) {
  const children = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: str(title, 200) })] })];
  for (const b of (Array.isArray(blocks) ? blocks : []).slice(0, MAX_BLOCKS)) {
    if (b.t === 'h') {
      children.push(new Paragraph({ heading: HEADINGS[Math.min(Math.max((b.level || 1) - 1, 0), 3)], children: runs(b.runs) }));
    } else if (b.t === 'li') {
      const depth = Math.min(Math.max(b.depth || 0, 0), 4);
      children.push(b.ordered
        ? new Paragraph({ numbering: { reference: 'numbers', level: depth }, children: runs(b.runs) })
        : new Paragraph({ bullet: { level: depth }, children: runs(b.runs) }));
    } else if (b.t === 'table') {
      const rows = (b.rows || []).slice(0, 200).map((row) => new TableRow({
        tableHeader: Boolean(row[0]?.header),
        children: row.slice(0, 20).map((cell) => new TableCell({
          children: [new Paragraph({ children: runs([{ text: cell.text, bold: Boolean(cell.header) }]) })]
        }))
      })).filter((r) => r.options.children.length);
      if (rows.length) children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      children.push(new Paragraph({ children: [] }));
    } else if (b.t === 'img') {
      const png = pngBuffer(b.data);
      if (png) {
        const width = 560;
        const height = Math.max(1, Math.round(width * png.height / png.width));
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: png.buffer, transformation: { width, height } })] }));
      }
    } else {
      children.push(new Paragraph({ children: runs(b.runs) }));
    }
  }
  const levels = [0, 1, 2, 3, 4].map((level) => ({ level, format: 'decimal', text: `%${level + 1}.`, alignment: AlignmentType.START }));
  const doc = new Document({
    creator: 'Thinker',
    title: str(title, 200),
    numbering: { config: [{ reference: 'numbers', levels }] },
    sections: [{ children }]
  });
  return Packer.toBuffer(doc);
}

async function buildPptx({ title, slides }) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = str(title, 200);
  pptx.author = 'Thinker';
  const list = (Array.isArray(slides) ? slides : []).slice(0, MAX_SLIDES);
  if (!list.length) list.push({ title: str(title, 200), bullets: [] });
  for (const s of list) {
    const slide = pptx.addSlide();
    slide.addText(str(s.title, 200), { x: 0.6, y: 0.35, w: 8.8, h: 0.9, fontSize: 28, bold: true, color: '1c1b2e', fontFace: 'Calibri' });
    const png = s.image ? pngBuffer(s.image) : null;
    const bullets = (s.bullets || []).slice(0, 30).map((t) => ({ text: str(t, 500), options: { bullet: true, breakLine: true } }));
    if (bullets.length) {
      slide.addText(bullets, { x: 0.6, y: 1.4, w: png ? 4.4 : 8.8, h: 3.8, fontSize: 18, color: '333333', valign: 'top', fontFace: 'Calibri' });
    }
    if (png) {
      const maxW = bullets.length ? 4.4 : 8.8;
      const maxH = 3.8;
      const ratio = png.width / png.height;
      const w = Math.min(maxW, maxH * ratio);
      slide.addImage({ data: `data:image/png;base64,${png.buffer.toString('base64')}`, x: bullets.length ? 5.2 : 0.6, y: 1.4, w, h: w / ratio });
    }
  }
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}

module.exports = { buildDocx, buildPptx, pngBuffer };
