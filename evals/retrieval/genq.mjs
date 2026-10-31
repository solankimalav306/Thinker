// Writes retrieval questions from real passages, through the app's own model call (the key never leaves the app).
import fs from 'fs';
import path from 'path';
const HERE = process.argv[2];
const PORT = process.argv[3] || '9226';
let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const usable = (p) => {
  const t = p.flat; if (t.split(/\s+/).length < 160) return false;
  const years = (t.match(/\b(?:19|20)\d\d\b/g) || []).length; const refs = (t.match(/arXiv|Proceedings|Conference|pp\./g) || []).length;
  return !(years >= 9 && refs >= 3);
};
const PROMPT = (doc, page, text) => `You are writing test questions for a document search system. Below is one passage from a paper (page ${page} of "${doc}").
Write exactly 3 questions that can be answered ONLY from this passage, each with a short answer and an EVIDENCE quote copied word for word from the passage (10 to 30 consecutive words that contain the answer).
1. "direct": a natural question that uses the passage's own key terms.
2. "paraphrase": a question about the same fact that deliberately avoids the passage's distinctive words (use synonyms, describe the idea).
3. "detail": a question about a specific number, name, setting, table value or definition in the passage.
Questions must make sense without seeing the passage (never say "in this passage" or "the text"). Do not ask about references or authors.
Return only JSON: [{"type":"direct","question":"...","answer":"...","evidence":"..."}, ...]

PASSAGE:
${text}`;

const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.url.includes('index.html'));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } };
const ev = (expression) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
const profile = (await ev(`(async () => { const s = await import('./js/state.js'); const ps = s.getApiProfiles(); const a = s.getActiveApiProfileId(); return ps.find((p) => p.id === a) || ps[0]; })()`)).result.value;
const call = async (text) => {
  for (let a = 0; a < 3; a += 1) {
    const r = (await ev(`window.electronAPI.askLLM({ profile: ${JSON.stringify(profile)}, model: ${JSON.stringify(profile.model)}, parts: [{ text: ${JSON.stringify(text)} }], json: true, maxTokens: 2000, temperature: 0.4 })`)).result.value;
    if (r?.ok) return r.text;
    await new Promise((x) => setTimeout(x, 2000 * (a + 1)));
  }
  return null;
};

const docs = fs.readdirSync(path.join(HERE, 'docs')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(HERE, 'docs', f), 'utf8')));
const jobs = [];
for (const d of docs) {
  const pages = d.pages.filter(usable);
  const n = Math.max(6, Math.min(36, Math.floor(pages.length / 2.2)));
  for (let i = pages.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [pages[i], pages[j]] = [pages[j], pages[i]]; }
  for (const p of pages.slice(0, n)) jobs.push([d, p]);
}
console.log(jobs.length, 'passages');
const out = [];
let next = 0;
const worker = async () => {
  while (next < jobs.length) {
    const [d, p] = jobs[next++];
    const raw = await call(PROMPT(d.id, p.page, p.lines.slice(0, 5000)));
    let items = []; try { items = JSON.parse(raw); } catch { /* skip */ }
    const pn = norm(p.flat);
    for (const it of Array.isArray(items) ? items : []) {
      const ev2 = String(it.evidence || ''); const q = String(it.question || '').trim();
      if (norm(ev2).length < 25 || !q) continue;
      const words = ev2.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); const have = new Set(p.flat.toLowerCase().split(/[^a-z0-9]+/));
      if (!pn.includes(norm(ev2)) && words.filter((w) => have.has(w)).length / words.length < 0.92) continue;
      out.push({ doc: d.id, type: it.type || 'direct', question: q, answer: String(it.answer || ''), evidence: ev2, pages: [p.page] });
    }
  }
};
await Promise.all([worker(), worker(), worker(), worker()]);
fs.writeFileSync(path.join(HERE, 'questions.json'), JSON.stringify(out, null, 1));
const count = (k) => out.reduce((a, q) => ((a[q[k]] = (a[q[k]] || 0) + 1), a), {});
console.log(out.length, 'questions', JSON.stringify(count('type')), JSON.stringify(count('doc')));
ws.close();
