// A plain, non-interactive version of an interactive artifact: for saving as an HTML file, a PDF, a picture, a Word document or
// slides, and for copying as text. Interactive things become what they would look like on paper: a quiz lists its questions and
// answers, a checklist its open boxes, a chart its numbers and bars.

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// **bold**, *italic*, `code`; maths stays as its own text between dollar signs
function fmt(text) {
  return esc(text)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

function block(text) {
  const lines = String(text).split("\n").filter((l) => l.trim());
  const bullets = lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l));
  const numbers = lines.length && lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
  if (bullets || numbers) {
    const tag = numbers ? "ol" : "ul";
    return `<${tag}>${lines.map((l) => `<li>${fmt(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))}</li>`).join("")}</${tag}>`;
  }
  return `<p>${lines.map(fmt).join("<br>")}</p>`;
}

const rich = (text) => String(text).split(/\n{2,}/).map(block).join("");
const page = (cite) => {
  if (!cite) return "";
  const n = parseInt(cite.slice(cite.lastIndexOf("|") + 1), 10);
  return Number.isFinite(n) ? ` <span class="tk-badge tk-info">page ${n}</span>` : "";
};

const BUILDERS = {
  checklist: (s) => s.groups.map((g) => `${g.title ? `<h3>${esc(g.title)}</h3>` : ""}<ul class="tk-todo">${g.items.map((i) => `<li>☐ ${fmt(i.text)}${i.note ? ` <span class="tk-muted">${fmt(i.note)}</span>` : ""}${page(i.cite)}</li>`).join("")}</ul>`).join(""),
  steps: (s) => `${s.intro ? rich(s.intro) : ""}<ol class="tk-steps">${s.steps.map((x) => `<li><strong>${fmt(x.title)}</strong>${x.due ? ` <span class="tk-badge tk-info">${esc(x.due)}</span>` : ""}${page(x.cite)}${x.detail ? rich(x.detail) : ""}</li>`).join("")}</ol>`,
  quiz: (s) => `<ol>${s.questions.map((q) => `<li><p><strong>${fmt(q.q)}</strong></p><ol type="A">${q.options.map((o, i) => `<li>${i === q.answer ? "<strong>" : ""}${fmt(o)}${i === q.answer ? " ✓</strong>" : ""}</li>`).join("")}</ol>${q.why ? `<p class="tk-muted">${fmt(q.why)}${page(q.cite)}</p>` : ""}</li>`).join("")}</ol>`,
  flashcards: (s) => `<table class="tk-table"><thead><tr><th>Question</th><th>Answer</th></tr></thead><tbody>${s.cards.map((c) => `<tr><td>${fmt(c.front)}</td><td>${fmt(c.back)}${page(c.cite)}</td></tr>`).join("")}</tbody></table>`,
  table: (s) => `${s.caption ? `<p>${fmt(s.caption)}</p>` : ""}<table class="tk-table"><thead><tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map((c) => `<td>${fmt(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
  chart: (s) => {
    const max = Math.max(1, ...s.series.flatMap((x) => x.values.map((v) => Math.abs(v ?? 0))));
    const rows = s.labels.map((label, i) => `<tr><th>${esc(label)}</th>${s.series.map((x) => {
      const v = x.values[i];
      return `<td>${v === null || v === undefined ? "" : `<div class="tk-bar" style="--v:${Math.round(Math.abs(v) / max * 100)}%"><span>${esc(v)}${esc(s.unit)}</span></div>`}</td>`;
    }).join("")}</tr>`).join("");
    return `${s.caption ? `<p>${fmt(s.caption)}</p>` : ""}<table class="tk-table"><thead><tr><th></th>${s.series.map((x) => `<th>${esc(x.name)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  },
  diagram: (s) => {
    const label = Object.fromEntries(s.nodes.map((n) => [n.id, n.label]));
    const lines = s.edges.map((e) => `<li>${esc(label[e.from])} → ${esc(label[e.to])}${e.label ? ` <span class="tk-muted">(${esc(e.label)})</span>` : ""}</li>`).join("");
    return `<ul>${s.nodes.map((n) => `<li><strong>${esc(n.label)}</strong>${n.detail ? `: ${fmt(n.detail)}` : ""}</li>`).join("")}</ul>${lines ? `<h3>Connections</h3><ul>${lines}</ul>` : ""}`;
  },
  timeline: (s) => `<div class="tk-timeline">${s.events.map((e) => `<div class="tk-event"><strong>${esc(e.when)}</strong> ${fmt(e.title)}${page(e.cite)}${e.detail ? rich(e.detail) : ""}</div>`).join("")}</div>`,
  document: (s) => s.sections.map((x) => `${x.heading ? `<h2>${esc(x.heading)}</h2>` : ""}${rich(x.text)}${page(x.cite)}`).join("")
};

export function specToHtml(kind, spec) {
  const build = BUILDERS[kind];
  return build && spec ? build(spec) : "";
}

// A plain-text version, for copying.
export function specToText(kind, spec) {
  const html = specToHtml(kind, spec);
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return doc.body.innerText || doc.body.textContent || "";
}
