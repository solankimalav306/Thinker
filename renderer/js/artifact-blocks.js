// Reads an artifact's (already cleaned) HTML into plain blocks for Word and slides for PowerPoint.
// It only reads text and structure from a parsed, inert document; nothing is run or loaded.

const INLINE = new Set(["a", "span", "b", "strong", "i", "em", "code", "small", "sub", "sup", "u", "mark", "abbr", "br", "kbd"]);
const SKIP = new Set(["style", "script", "svg", "img", "canvas"]);

const squash = (text) => String(text).replace(/\s+/g, " ");

// text runs with bold / italic / code, whitespace collapsed
function inlineRuns(node, state = {}, out = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      const text = squash(child.nodeValue);
      if (text) out.push({ text, bold: Boolean(state.bold), italic: Boolean(state.italic), code: Boolean(state.code) });
    } else if (child.nodeType === 1) {
      const tag = child.tagName.toLowerCase();
      if (SKIP.has(tag) || tag === "ul" || tag === "ol") continue;
      if (tag === "br") { out.push({ text: " " }); continue; }
      inlineRuns(child, {
        bold: state.bold || tag === "b" || tag === "strong" || /^h[1-6]$/.test(tag) || tag === "summary",
        italic: state.italic || tag === "i" || tag === "em",
        code: state.code || tag === "code" || tag === "kbd"
      }, out);
    }
  }
  return out;
}

function trimRuns(runs) {
  const list = runs.filter((r) => r.text !== "");
  if (list.length) {
    list[0] = { ...list[0], text: list[0].text.replace(/^\s+/, "") };
    const last = list.length - 1;
    list[last] = { ...list[last], text: list[last].text.replace(/\s+$/, "") };
  }
  return list.filter((r) => r.text !== "");
}

const plain = (runs) => runs.map((r) => r.text).join("");
const hasBlockChild = (el) => [...el.children].some((c) => !INLINE.has(c.tagName.toLowerCase()) && !SKIP.has(c.tagName.toLowerCase()));

function listItems(list, depth, blocks) {
  const ordered = list.tagName.toLowerCase() === "ol";
  for (const item of list.children) {
    if (item.tagName.toLowerCase() !== "li") continue;
    const runs = trimRuns(inlineRuns(item));
    if (runs.length) blocks.push({ t: "li", ordered, depth, runs });
    for (const nested of item.children) {
      if (/^(ul|ol)$/i.test(nested.tagName)) listItems(nested, depth + 1, blocks);
    }
  }
}

function tableBlock(table) {
  const rows = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells = [...tr.children].filter((c) => /^(td|th)$/i.test(c.tagName))
      .map((c) => ({ text: plain(trimRuns(inlineRuns(c))), header: c.tagName.toLowerCase() === "th" }));
    if (cells.length) rows.push(cells);
  }
  return { t: "table", rows };
}

function walk(el, blocks) {
  for (const child of el.children) {
    const tag = child.tagName.toLowerCase();
    if (SKIP.has(tag)) continue;
    if (/^h[1-6]$/.test(tag)) {
      const runs = trimRuns(inlineRuns(child));
      if (runs.length) blocks.push({ t: "h", level: Number(tag[1]), runs });
    } else if (tag === "ul" || tag === "ol") {
      listItems(child, 0, blocks);
    } else if (tag === "table") {
      const table = tableBlock(child);
      if (table.rows.length) blocks.push(table);
    } else if (tag === "details") {
      const summary = child.querySelector("summary");
      if (summary) {
        const runs = trimRuns(inlineRuns(summary, { bold: true }));
        if (runs.length) blocks.push({ t: "p", runs });
      }
      walk(child, blocks);
    } else if (tag === "summary") {
      continue;
    } else if (hasBlockChild(child)) {
      walk(child, blocks);
    } else {
      const runs = trimRuns(inlineRuns(child, { code: tag === "pre" }));
      if (runs.length) blocks.push({ t: "p", runs });
    }
  }
}

export function extractBlocks(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const blocks = [];
  walk(doc.body, blocks);
  return blocks;
}

// one slide per .tk-slide; otherwise one per h2 section; otherwise a single slide
export function extractSlides(html, fallbackTitle = "Slide") {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const slideEls = [...doc.querySelectorAll(".tk-slide")];

  const fromBlocks = (blocks, title) => ({
    title,
    bullets: blocks.filter((b) => b.t === "li" || b.t === "p").map((b) => plain(b.runs)).filter(Boolean)
      .concat(blocks.filter((b) => b.t === "table").flatMap((b) => b.rows.map((r) => r.map((c) => c.text).join(" | "))))
  });

  if (slideEls.length) {
    return slideEls.map((el, i) => {
      const blocks = [];
      walk(el, blocks);
      const headIndex = blocks.findIndex((b) => b.t === "h");
      const title = headIndex >= 0 ? plain(blocks[headIndex].runs) : `${fallbackTitle} ${i + 1}`;
      if (headIndex >= 0) blocks.splice(headIndex, 1);
      return fromBlocks(blocks, title);
    });
  }

  const blocks = extractBlocks(html);
  const slides = [];
  let current = null;
  for (const b of blocks) {
    if (b.t === "h" && b.level <= 2) {
      current = { title: plain(b.runs), blocks: [] };
      slides.push(current);
    } else if (current) current.blocks.push(b);
    else {
      current = { title: fallbackTitle, blocks: [b] };
      slides.push(current);
    }
  }
  return slides.map((s) => fromBlocks(s.blocks, s.title));
}
