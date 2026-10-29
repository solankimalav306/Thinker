// The "normal" editor's model of a LaTeX document: a list of blocks that can be edited visually.
//
// The one rule that matters: whatever the person does not touch is written back exactly as it was.
// Every block keeps its original source text and only blocks marked `dirty` are generated again, so
// opening a document in the visual editor and saving it can never change it by itself. Anything the
// visual editor does not understand stays a "raw" block (shown and edited as source), never dropped.

const BS = String.fromCharCode(92);

const HEADING_LEVELS = { chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 };
const HEADING_BY_LEVEL = ['chapter', 'section', 'subsection', 'subsubsection', 'paragraph'];
const MATH_ENVS = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'displaymath']);
const LIST_ENVS = new Set(['itemize', 'enumerate']);
const MARKS = { textbf: 'bold', textit: 'italic', emph: 'italic', texttt: 'code', underline: 'underline' };
const MARK_COMMAND = { bold: 'textbf', italic: 'emph', code: 'texttt', underline: 'underline' };
const BLOCK_COMMANDS = /^\\(maketitle|tableofcontents|listoffigures|listoftables|newpage|clearpage|bibliography|bibliographystyle|printbibliography|label|caption|centering|includegraphics|input|include|vspace|hspace|noindent|item|usepackage|title|author|date|appendix|newcommand|renewcommand|def|let|setlength|pagestyle|thispagestyle|frontmatter|mainmatter|backmatter)\b/;

// ---------------------------------------------------------------------------------------------------
// Small text helpers

function stripComment(line) {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '%' && (i === 0 || line[i - 1] !== BS)) return line.slice(0, i);
  }
  return line;
}

const hasComment = (text) => text.split('\n').some((line) => stripComment(line).length !== line.length);

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

// Finds the "}" that closes the "{" at `open`, or -1.
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === BS) { i += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------------
// Inline text: bold, italic, code, maths, and everything else kept as a chip with its exact source.

const ESCAPES = { '%': '%', '&': '&', '_': '_', '#': '#', '$': '$', '{': '{', '}': '}' };

export function parseInline(source) {
  const nodes = [];
  let buffer = '';
  const flush = () => { if (buffer) { nodes.push({ t: 'text', text: buffer }); buffer = ''; } };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    if (ch === BS) {
      const next = source[i + 1];
      if (next !== undefined && ESCAPES[next] !== undefined) { buffer += ESCAPES[next]; i += 2; continue; }
      if (next === BS) { flush(); nodes.push({ t: 'raw', src: BS + BS }); i += 2; continue; }
      if (next === '(') {
        const end = source.indexOf(BS + ')', i + 2);
        if (end < 0) throw new Error('unclosed math');
        flush();
        nodes.push({ t: 'math', src: source.slice(i + 2, end), delim: 'paren' });
        i = end + 2;
        continue;
      }
      const name = /^[A-Za-z]+\*?/.exec(source.slice(i + 1));
      if (!name) { flush(); nodes.push({ t: 'raw', src: BS + (next || '') }); i += 2; continue; }
      const command = name[0];
      let cursor = i + 1 + command.length;
      if (MARKS[command] && source[cursor] === '{') {
        const close = matchBrace(source, cursor);
        if (close < 0) throw new Error('unclosed group');
        flush();
        nodes.push({ t: 'mark', kind: MARKS[command], children: parseInline(source.slice(cursor + 1, close)), command });
        i = close + 1;
        continue;
      }
      // any other command keeps its optional [..] and {..} arguments as one chip
      while (source[cursor] === '[' || source[cursor] === '{') {
        if (source[cursor] === '[') {
          const close = source.indexOf(']', cursor);
          if (close < 0) break;
          cursor = close + 1;
        } else {
          const close = matchBrace(source, cursor);
          if (close < 0) throw new Error('unclosed group');
          cursor = close + 1;
        }
      }
      flush();
      nodes.push({ t: 'raw', src: source.slice(i, cursor) });
      i = cursor;
      continue;
    }

    if (ch === '$') {
      if (source[i + 1] === '$') throw new Error('display math inside text');
      let end = i + 1;
      while (end < source.length && !(source[end] === '$' && source[end - 1] !== BS)) end += 1;
      if (end >= source.length) throw new Error('unclosed math');
      flush();
      nodes.push({ t: 'math', src: source.slice(i + 1, end), delim: 'dollar' });
      i = end + 1;
      continue;
    }

    if (ch === '{') {
      const close = matchBrace(source, i);
      if (close < 0) throw new Error('unclosed group');
      flush();
      nodes.push({ t: 'raw', src: source.slice(i, close + 1) });
      i = close + 1;
      continue;
    }
    if (ch === '}') throw new Error('stray bracket');

    buffer += ch;
    i += 1;
  }
  flush();
  return nodes;
}

function escapeText(text) {
  let out = '';
  for (const ch of text) {
    if (ch === BS) out += BS + 'textbackslash{}';
    else if (ch === '^') out += BS + 'textasciicircum{}';
    else if (ch in ESCAPES) out += BS + ch;
    else out += ch;
  }
  return out;
}

export function serializeInline(nodes) {
  return nodes.map((n) => {
    if (n.t === 'text') return escapeText(n.text);
    if (n.t === 'raw') return n.src;
    if (n.t === 'math') return n.delim === 'paren' ? BS + '(' + n.src + BS + ')' : '$' + n.src + '$';
    if (n.t === 'mark') return BS + (n.command && MARKS[n.command] === n.kind ? n.command : MARK_COMMAND[n.kind]) + '{' + serializeInline(n.children) + '}';
    return '';
  }).join('');
}

const HEADING_LINE = /^\s*\\(chapter|section|subsection|subsubsection|paragraph)\*?\s*(\[[^\]\n]*\])?\{.*\}\s*(\\label\{[^}]*\})?\s*$/;

// ---------------------------------------------------------------------------------------------------
// Documents

export function parseDocument(rawSource) {
  const eol = rawSource.includes('\r\n') ? '\r\n' : '\n';
  const source = rawSource.replace(/\r\n/g, '\n');
  const begin = /\\begin\{document\}[ \t]*\n?/.exec(source);
  if (!begin) return { ok: false, reason: 'This file has no \\begin{document}, so it is not a full document. Use the code view.' };
  const start = begin.index + begin[0].length;
  const end = source.lastIndexOf(BS + 'end{document}');
  if (end < start) return { ok: false, reason: 'This file has no \\end{document}. Use the code view.' };
  const body = source.slice(start, end);
  const { lead, blocks } = splitBlocks(body);
  return { ok: true, eol, preamble: source.slice(0, start), postamble: source.slice(end), lead, blocks };
}

export function serializeDocument(model) {
  const body = model.lead + model.blocks.map((b) => (b.dirty ? generate(b) : b.src) + b.sep).join('');
  return (model.preamble + body + model.postamble).replace(/\n/g, model.eol === '\r\n' ? '\r\n' : '\n');
}

// Splits the text between \begin{document} and \end{document} into chunks at blank lines, but never
// inside an environment or display maths. Returns the text before the first chunk and the chunks,
// each with the exact whitespace that followed it.
function splitBlocks(body) {
  const lines = body.split('\n');
  const chunks = [];
  let offset = 0;
  let depth = 0;
  let dollars = 0;
  let current = null;

  lines.forEach((line, index) => {
    const lineStart = offset;
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
    const blank = /^\s*$/.test(line);
    const code = stripComment(line);
    const begins = count(code, /\\begin\{(?!document\})/g);
    const ends = count(code, /\\end\{(?!document\})/g);
    const opens = count(code, /\\\[/g);
    const closes = count(code, /\\\]/g);
    const wasInside = depth > 0 || dollars % 2 === 1;

    // A heading on a line of its own is its own block, even with text right under it (the usual style).
    if (!wasInside && !blank && code.length === line.length && HEADING_LINE.test(line)) {
      if (current) { chunks.push(current); current = null; }
      chunks.push({ start: lineStart, end: lineStart + line.length });
      return;
    }

    if (blank && !wasInside) {
      if (current) { chunks.push(current); current = null; }
      return;
    }
    if (!current) current = { start: lineStart, end: lineStart };
    current.end = lineStart + line.length;
    depth = Math.max(0, depth + begins - ends + opens - closes);
    dollars += count(code, /\$\$/g);
  });
  if (current) chunks.push(current);

  const blocks = chunks.map((chunk, i) => {
    const next = chunks[i + 1];
    const src = body.slice(chunk.start, chunk.end);
    const sep = body.slice(chunk.end, next ? next.start : body.length);
    return { ...classify(src), src, sep, dirty: false };
  });
  return { lead: chunks.length ? body.slice(0, chunks[0].start) : body, blocks };
}

function classify(src) {
  const trimmed = src.trim();
  if (hasComment(src)) return { kind: 'raw', label: 'Commented source' };

  const env = /^\\begin\{([A-Za-z]+\*?)\}/.exec(trimmed);
  if (env) {
    const name = env[1];
    const tail = BS + 'end{' + name + '}';
    if (!trimmed.endsWith(tail)) return { kind: 'raw', env: name, label: name };
    const inner = trimmed.slice(env[0].length, trimmed.length - tail.length);
    if (LIST_ENVS.has(name)) {
      const list = parseList(name, inner);
      if (list) return list;
      return { kind: 'raw', env: name, label: name };
    }
    if (MATH_ENVS.has(name)) return { kind: 'math', env: name, math: inner.trim(), label: name };
    return { kind: 'raw', env: name, label: name };
  }

  if (trimmed.startsWith(BS + '[') && trimmed.endsWith(BS + ']')) return { kind: 'math', env: 'bracket', math: trimmed.slice(2, -2).trim(), label: 'equation' };
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) return { kind: 'math', env: 'dollars', math: trimmed.slice(2, -2).trim(), label: 'equation' };

  const heading = /^\\(chapter|section|subsection|subsubsection|paragraph)(\*?)\s*(\[[^\]\n]*\])?\{/.exec(trimmed);
  if (heading && !trimmed.includes('\n')) {
    const open = heading[0].length - 1;
    const close = matchBrace(trimmed, open);
    if (close > 0) {
      const tail = trimmed.slice(close + 1);
      if (/^\s*(\\label\{[^}]*\})?\s*$/.test(tail)) {
        try {
          const inner = trimmed.slice(open + 1, close);
          parseInline(inner);
          return { kind: 'heading', level: HEADING_LEVELS[heading[1]], starred: heading[2] === '*', short: heading[3] || '', text: inner, tail: tail.trim() };
        } catch { /* falls through to raw */ }
      }
    }
  }

  if (BLOCK_COMMANDS.test(trimmed)) return { kind: 'raw', label: 'Command' };
  if (/^\\(begin|end)\b/.test(trimmed)) return { kind: 'raw', label: 'Source' };

  try {
    parseInline(trimmed);
  } catch {
    return { kind: 'raw', label: 'Source' };
  }
  return { kind: 'paragraph', text: trimmed };
}

function parseList(name, inner) {
  const text = inner.replace(/^\s+|\s+$/g, '');
  if (!text) return { kind: 'list', ordered: name === 'enumerate', items: [''], label: name };
  if (!text.startsWith(BS + 'item')) return null;
  if (/\\begin\{/.test(text)) return null;
  const pieces = text.split(/(?:^|\n)\s*\\item(?![A-Za-z])\s?/).slice(1);
  if (!pieces.length) return null;
  try {
    pieces.forEach((p) => parseInline(p.trim()));
  } catch {
    return null;
  }
  return { kind: 'list', ordered: name === 'enumerate', items: pieces.map((p) => p.trim()), label: name };
}

// ---------------------------------------------------------------------------------------------------
// Writing a changed block back as LaTeX

function generate(block) {
  switch (block.kind) {
    case 'paragraph':
      return block.text;
    case 'heading': {
      const name = HEADING_BY_LEVEL[block.level] || 'section';
      return BS + name + (block.starred ? '*' : '') + (block.short || '') + '{' + block.text + '}' + (block.tail ? ' ' + block.tail : '');
    }
    case 'list': {
      const env = block.ordered ? 'enumerate' : 'itemize';
      return BS + 'begin{' + env + '}\n' + block.items.map((it) => '  ' + BS + 'item ' + it).join('\n') + '\n' + BS + 'end{' + env + '}';
    }
    case 'math':
      if (block.env === 'bracket') return BS + '[\n' + block.math + '\n' + BS + ']';
      if (block.env === 'dollars') return '$$\n' + block.math + '\n$$';
      return BS + 'begin{' + block.env + '}\n' + block.math + '\n' + BS + 'end{' + block.env + '}';
    default:
      return block.src;
  }
}

// ---------------------------------------------------------------------------------------------------
// Editing operations. They return a new model; the old one is never changed.

const copyModel = (model) => ({ ...model, blocks: model.blocks.map((b) => ({ ...b })) });
const BLOCK_SEP = '\n\n';

function mark(block) {
  block.dirty = true;
  if (block.kind === 'raw') block.dirty = false; // raw blocks carry their own source in `src`
  return block;
}

export function updateBlock(model, index, patch) {
  const next = copyModel(model);
  const block = next.blocks[index];
  if (!block) return model;
  Object.assign(block, patch);
  if (block.kind === 'raw') block.dirty = false;
  else block.dirty = true;
  return next;
}

export function setRawSource(model, index, src) {
  const next = copyModel(model);
  const block = next.blocks[index];
  if (!block) return model;
  const sep = block.sep;
  next.blocks[index] = { ...classifyForEdit(src), src, sep, dirty: false };
  return next;
}

// After a person edits source by hand, the block may now be something the visual editor understands.
function classifyForEdit(src) {
  const c = classify(src);
  return c.kind === 'raw' ? c : c; // same rules; kept separate so it can be tightened later
}

export function insertBlock(model, afterIndex, block) {
  const next = copyModel(model);
  const fresh = { sep: BLOCK_SEP, dirty: true, ...block };
  if (fresh.kind === 'raw') { fresh.dirty = false; fresh.src = fresh.src ?? ''; }
  else fresh.src = fresh.src ?? generate(fresh);
  if (next.blocks.length === 0) {
    next.blocks.push({ ...fresh, sep: '\n' });
    return next;
  }
  const index = Math.max(-1, Math.min(afterIndex, next.blocks.length - 1));
  if (index === next.blocks.length - 1) {
    // the last block's separator leads into \end{document}; keep it for the new last block
    fresh.sep = next.blocks[index].sep;
    next.blocks[index].sep = BLOCK_SEP;
  }
  next.blocks.splice(index + 1, 0, fresh);
  return next;
}

export function deleteBlock(model, index) {
  const next = copyModel(model);
  if (!next.blocks[index]) return model;
  const [removed] = next.blocks.splice(index, 1);
  if (index === next.blocks.length && next.blocks.length > 0) next.blocks[next.blocks.length - 1].sep = removed.sep;
  return next;
}

export function moveBlock(model, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= model.blocks.length || !model.blocks[index]) return model;
  const next = copyModel(model);
  const a = next.blocks[index];
  const b = next.blocks[target];
  // separators stay in place; only the content moves
  const aSep = a.sep;
  const bSep = b.sep;
  next.blocks[index] = { ...b, sep: aSep };
  next.blocks[target] = { ...a, sep: bSep };
  return next;
}

export function newBlock(kind, options = {}) {
  switch (kind) {
    case 'paragraph': return { kind: 'paragraph', text: options.text ?? '' };
    case 'heading': return { kind: 'heading', level: options.level ?? 1, starred: false, short: '', text: options.text ?? 'New section', tail: '' };
    case 'list': return { kind: 'list', ordered: Boolean(options.ordered), items: options.items ?? [''] , label: options.ordered ? 'enumerate' : 'itemize' };
    case 'equation': return { kind: 'math', env: 'equation', math: options.math ?? 'a^2 + b^2 = c^2', label: 'equation' };
    case 'table': return {
      kind: 'raw', label: 'table',
      src: [BS + 'begin{table}[h]', BS + 'centering', BS + 'begin{tabular}{lll}', BS + 'toprule', 'A & B & C ' + BS + BS, BS + 'midrule', '1 & 2 & 3 ' + BS + BS, '4 & 5 & 6 ' + BS + BS, BS + 'bottomrule', BS + 'end{tabular}', BS + 'caption{A table.}', BS + 'end{table}'].join('\n')
    };
    case 'figure': return {
      kind: 'raw', label: 'figure',
      src: [BS + 'begin{figure}[h]', BS + 'centering', BS + 'includegraphics[width=0.7' + BS + 'linewidth]{example-image}', BS + 'caption{A figure.}', BS + 'end{figure}'].join('\n')
    };
    default: return { kind: 'raw', label: 'Source', src: options.src ?? '' };
  }
}

// What a block means in plain words, for labels in the interface.
export function describeBlock(block) {
  switch (block.kind) {
    case 'heading': return ['Chapter', 'Section', 'Subsection', 'Subsubsection', 'Paragraph heading'][block.level] || 'Heading';
    case 'paragraph': return 'Paragraph';
    case 'list': return block.ordered ? 'Numbered list' : 'Bulleted list';
    case 'math': return 'Equation';
    default: return block.label ? block.label[0].toUpperCase() + block.label.slice(1) : 'Source';
  }
}
