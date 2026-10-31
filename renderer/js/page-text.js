// The text of one PDF page for search: its lines, in reading order, one per row.
//
// pdf.js gives a page as a list of small pieces of text with their positions. Joining them all with a space (what the
// app did before) throws away where lines and paragraphs end, which is what lets the indexer find headings, drop running
// titles and join words split by a hyphen at a line end. Here a new line starts wherever the baseline moves.
export function pageText(content) {
  const lines = [];
  let line = "";
  let lastY = null;
  let lastHeight = 10;
  let lastEnd = null;
  const flush = () => {
    if (line.trim()) lines.push(line.replace(/\s+$/, ""));
    line = "";
    lastY = null;
    lastEnd = null;
  };
  for (const item of content?.items || []) {
    if (typeof item.str !== "string") continue;
    const y = item.transform ? item.transform[5] : 0;
    const x = item.transform ? item.transform[4] : 0;
    const height = item.height || lastHeight;
    if (lastY !== null && Math.abs(y - lastY) > height * 0.6) flush();
    // a gap between two pieces that carries no space of its own is a space
    if (line && lastEnd !== null && x - lastEnd > height * 0.15 && !/\s$/.test(line) && !/^\s/.test(item.str)) line += " ";
    line += item.str;
    lastY = y;
    lastHeight = height;
    lastEnd = item.transform ? x + (item.width || 0) : null;
    if (item.hasEOL) flush();
  }
  flush();
  return lines.join("\n");
}
