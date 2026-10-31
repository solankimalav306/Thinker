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
const PROMPT = (doc, page, q1, text) => `A person is chatting with a document ("${doc}"). They already asked: "${q1}"
Write ONE short follow-up question that depends on that earlier question for its meaning (it uses a pronoun or leaves something out, like "and what about the second one?", "why does it do that?", "how big is it?") and that is answered by this passage from page ${page}. It must NOT repeat the key terms of the earlier question. Also copy word for word the EVIDENCE (10 to 30 consecutive words) from the passage that answers it.
Return only JSON: {"question":"...","evidence":"..."}

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

const docs = Object.fromEntries(fs.readdirSync(path.join(HERE, 'docs')).map((f) => { const d = JSON.parse(fs.readFileSync(path.join(HERE, 'docs', f), 'utf8')); return [d.id, d]; }));
const seeds = JSON.parse(fs.readFileSync(path.join(HERE, 'questions.json'), 'utf8')).filter((q) => q.type === 'direct');
const jobs = seeds.map((q) => [q, docs[q.doc].pages.find((p) => p.page === q.pages[0])]);
console.log(jobs.length, 'passages');
const out = [];
let next = 0;
const worker = async () => {
  while (next < jobs.length) {
    const [q, p] = jobs[next++];
    const raw = await call(PROMPT(q.doc, p.page, q.question, p.lines.slice(0, 5000)));
    let it = null; try { it = JSON.parse(raw); } catch { /* skip */ }
    if (!it || !it.question || !it.evidence) continue;
    const words = String(it.evidence).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); const have = new Set(p.flat.toLowerCase().split(/[^a-z0-9]+/));
    if (words.length < 5 || words.filter((w) => have.has(w)).length / words.length < 0.92) continue;
    out.push({ doc: q.doc, prev: q.question, question: String(it.question).trim(), evidence: String(it.evidence), pages: [p.page] });
  }
};
await worker();
fs.writeFileSync(path.join(HERE, 'followups.json'), JSON.stringify(out, null, 1));
const count = (k) => out.reduce((a, q) => ((a[q[k]] = (a[q[k]] || 0) + 1), a), {});
console.log(out.length, 'follow-ups', JSON.stringify(count('doc')));
ws.close();
