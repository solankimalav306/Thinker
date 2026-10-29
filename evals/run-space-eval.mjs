// Asks a Thinkspace (three PDFs read together) every question in space-questions.json and grades the answers,
// including whether each answer names the right documents and none of the wrong ones.
//   Start the app with a working AI profile and --remote-debugging-port=9222, then:
//   node evals/run-space-eval.mjs [--only S1,S3] [--repeat 2] [--model name] [--out evals/results]
// It creates a Thinkspace called "Eval Thinkspace" and deletes it again at the end.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const only = opt('only', '') ? new Set(opt('only').split(',')) : null;
const repeat = Number(opt('repeat', 1));
const outDir = path.resolve(opt('out', path.join(here, 'results')));
const spec = JSON.parse(fs.readFileSync(path.join(here, 'space-questions.json'), 'utf8'));
const files = spec.documents.map((d) => path.resolve(here, d));

let page;
for (let tries = 0; tries < 60 && !page; tries += 1) {
  try { page = (await (await fetch('http://127.0.0.1:9222/json')).json()).find((t) => t.url.includes('index.html')); } catch { /* starting */ }
  if (!page) await new Promise((r) => setTimeout(r, 1000));
}
if (!page) { console.error('The app window did not appear on port 9222.'); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
ws.onclose = () => { console.error('Lost the connection to the app.'); process.exit(3); };
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result.value;
};
await send('Runtime.enable');

const setup = await ev(`(async () => {
  const api = window.electronAPI;
  const state = await import('./js/state.js');
  const idx = await import('./js/doc-index.js');
  const profile = state.getApiProfiles().find((p) => p.id === state.getActiveApiProfileId()) || state.getApiProfiles()[0] || null;
  if (!profile) return { error: 'no profile' };
  const space = await api.createWorkspace({ name: 'Eval Thinkspace' });
  const added = await api.addWorkspaceDocuments(space.id, ${JSON.stringify(files)});
  const docs = [];
  for (const d of added.workspace.documents) {
    const pdfId = await idx.ensureIndexed(d.path, { api });
    docs.push({ pdfId, title: d.title.replace(/\\.pdf$/i, '') });
  }
  return { spaceId: space.id, docs, profile, storagePath: await api.getUserDataPath() };
})()`);
if (setup.error) { console.error(setup.error); process.exit(2); }
if (opt('model', '')) setup.profile.model = opt('model');
console.log(`Model: ${setup.profile.label || setup.profile.id} (${setup.profile.model}); documents: ${setup.docs.map((d) => d.title).join(', ')}`);

const key = await ev(`(async () => { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('thinkspace:' + ${JSON.stringify(setup.spaceId)})); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); })()`);

const ask = (q, mode) => ev(`(async () => {
  const t0 = performance.now();
  const res = await window.electronAPI.invokeAgent({
    requestId: crypto.randomUUID(), query: ${JSON.stringify(q)}, pdfId: ${JSON.stringify(key)}, storagePath: ${JSON.stringify(setup.storagePath)},
    apiKey: ${JSON.stringify(setup.profile.key || '')}, apiFormat: ${JSON.stringify(setup.profile.format || 'gemini')}, apiUrl: ${JSON.stringify(setup.profile.url || '')},
    model: ${JSON.stringify(setup.profile.model)}, profile: ${JSON.stringify(setup.profile)}, conversationId: 'space-eval-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    mode: ${JSON.stringify(mode)}, instructions: [], context: '', messages: [], parts: [], docs: ${JSON.stringify(setup.docs)}
  });
  return { ...res, ms: Math.round(performance.now() - t0) };
})()`);

const REFUSAL = /(could not|couldn't|does not|doesn't|do not|don't|not)\s+(contain|mention|say|specify|state|provide|include|list|cover|name|address|have)|no (information|mention|details?)|not (found|mentioned|stated|specified|listed|covered|available|in (the|these|this) (document|documents|manual|text))|could(n't| not) (find|locate)|cannot (find|answer)|can't (find|answer)|unable to (find|answer)|isn't (mentioned|in|stated)|outside (of )?(the|these|this) (document|documents|manual)/i;

// which of the Thinkspace's documents the answer cites, by [Title, page N]
function citedDocs(text) {
  const found = new Set();
  for (const m of text.matchAll(/\[([^\[\]]*?\b(?:pages?|pp?\.)\s*\d+[^\[\]]*?)\]/gi)) {
    for (const piece of m[1].split(';')) {
      const t = /^\s*(.+?),\s*(?:pages?|pp?\.)\s*\d+/i.exec(piece);
      if (!t) continue;
      const doc = setup.docs.find((d) => d.title.toLowerCase() === t[1].trim().toLowerCase());
      if (doc) found.add(doc.title);
    }
  }
  return found;
}

function grade(q, text) {
  const problems = [];
  for (const rx of q.must || []) if (!new RegExp(rx, 'i').test(text)) problems.push(`missing /${rx}/`);
  for (const rx of q.mustNot || []) if (new RegExp(rx, 'im').test(text)) problems.push(`forbidden /${rx}/`);
  if (q.refuse && !REFUSAL.test(text)) problems.push('should say the documents do not contain this');
  const cited = citedDocs(text);
  for (const title of q.cites || []) if (!cited.has(title)) problems.push(`does not cite ${title}`);
  const wrong = q.onlyCites ? [...cited].filter((t) => !q.onlyCites.includes(t)) : [];
  if (wrong.length) problems.push(`cites the wrong document: ${wrong.join(', ')}`);
  return { correct: problems.length === 0, problems, cited: [...cited], wrongAttribution: wrong.length > 0 };
}

const results = [];
for (const q of spec.questions.filter((x) => !only || only.has(x.id))) {
  for (let run = 1; run <= repeat; run += 1) {
    const mode = q.mode || 'auto';
    let reply;
    try { reply = await ask(q.q, mode); } catch (e) { reply = { ok: false, error: String(e.message || e) }; }
    const error = reply.ok ? reply.result?.error : reply.error;
    const text = reply.ok && !error ? reply.result.response_text || '' : '';
    const g = error ? { correct: false, problems: [`request failed: ${error}`], cited: [], wrongAttribution: false } : grade(q, text);
    results.push({ id: q.id, kind: q.kind, run, question: q.q, answer: text, ...g, ms: reply.ms });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'space-eval-partial.json'), JSON.stringify({ results }, null, 2));
    console.log(`${g.correct ? 'PASS' : 'FAIL'}  ${q.id.padEnd(4)} ${q.kind.padEnd(14)} ${reply.ms ?? ''}ms${g.correct ? '' : '  -> ' + g.problems.join('; ')}`);
  }
}

await ev(`window.electronAPI.deleteWorkspace(${JSON.stringify(setup.spaceId)})`);
const attributable = results.filter((r) => r.cited.length || r.problems.some((p) => /cite/.test(p)));
const summary = {
  model: setup.profile.model, when: new Date().toISOString(), runs: results.length,
  correct: results.filter((r) => r.correct).length,
  wrongAttributions: results.filter((r) => r.wrongAttribution).length,
  byKind: Object.fromEntries(Object.entries(results.reduce((a, r) => { (a[r.kind] ||= []).push(r); return a; }, {})).map(([k, v]) => [k, `${v.filter((r) => r.correct).length}/${v.length}`])),
  medianMs: [...results.map((r) => r.ms).filter(Boolean)].sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? null,
  attributionChecked: attributable.length
};
fs.writeFileSync(path.join(outDir, `space-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ summary, results }, null, 2));
console.log('\n' + JSON.stringify(summary, null, 2));
ws.onclose = null;
ws.close();
process.exit(0);
