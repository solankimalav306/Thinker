// Asks the chat agent every question in questions.json and grades the answers.
//
//   Start the app with a profile that has a working key, plus --remote-debugging-port=9222, then:
//   node evals/run-eval.mjs [--only L1,N1] [--repeat 2] [--model gemini-3.5-flash-lite] [--out evals/results]
//
// It runs inside the real app, so it uses the real key, the real indexing and the real agent. It
// makes one model call per question (a few more for repeats), so it uses a little of the key's quota.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const only = opt('only', '') ? new Set(opt('only').split(',')) : null;
const repeat = Number(opt('repeat', 1));
const outDir = path.resolve(opt('out', path.join(here, 'results')));
const spec = JSON.parse(fs.readFileSync(path.join(here, 'questions.json'), 'utf8'));
const pdfPath = path.resolve(here, spec.document);

let page;
for (let tries = 0; tries < 60 && !page; tries += 1) {
  try { page = (await (await fetch('http://127.0.0.1:9222/json')).json()).find((t) => t.url.includes('index.html')); } catch { /* app still starting */ }
  if (!page) await new Promise((r) => setTimeout(r, 1000));
}
if (!page) { console.error('The app window did not appear on port 9222.'); process.exit(2); }
const baseUrl = page.url.split('?')[0];
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');

// Open the document through the app so it is indexed exactly as a person would index it.
await send('Page.navigate', { url: `${baseUrl}?open=${encodeURIComponent(pdfPath)}` });
await sleep(6000);
const setup = await ev(`(async () => {
  const state = await import('./js/state.js');
  const profiles = state.getApiProfiles();
  const active = state.getActiveApiProfileId();
  const profile = profiles.find((p) => p.id === active) || profiles[0] || null;
  const pdfId = await window.electronAPI.getPdfId(${JSON.stringify(pdfPath)});
  const storagePath = await window.electronAPI.getUserDataPath();
  return { profile, pdfId, storagePath, hasProfile: !!profile };
})()`);
if (opt('model', '')) setup.profile.model = opt('model');
if (!setup.hasProfile) { console.error('No AI profile in this app. Add one in Settings first.'); process.exit(2); }
console.log(`Model: ${setup.profile.label || setup.profile.id} (${setup.profile.model}); document id ${setup.pdfId.slice(0, 12)}…`);

const ask = (q, mode, convo) => ev(`(async () => {
  const t0 = performance.now();
  const res = await window.electronAPI.invokeAgent({
    requestId: crypto.randomUUID(), query: ${JSON.stringify(q)}, pdfId: ${JSON.stringify(setup.pdfId)},
    storagePath: ${JSON.stringify(setup.storagePath)}, apiKey: ${JSON.stringify(setup.profile.key || '')},
    apiFormat: ${JSON.stringify(setup.profile.format || 'gemini')}, apiUrl: ${JSON.stringify(setup.profile.url || '')},
    model: ${JSON.stringify(setup.profile.model)}, profile: ${JSON.stringify(setup.profile)},
    conversationId: ${JSON.stringify(convo)}, mode: ${JSON.stringify(mode)}, instructions: [], context: '', messages: [], parts: []
  });
  return { ...res, ms: Math.round(performance.now() - t0) };
})()`);

const retrieve = (q) => ev(`window.electronAPI.queryPDF({ query: ${JSON.stringify(q)}, pdfId: ${JSON.stringify(setup.pdfId)}, storagePath: ${JSON.stringify(setup.storagePath)}, k: 3 })`);

const REFUSAL = /(could not|couldn't|does not|doesn't|do not|don't|not)\s+(contain|mention|say|specify|state|provide|include|list|cover|name|address|have)|no (information|mention|details?)|not (found|mentioned|stated|specified|listed|covered|available|in (the|this) (document|manual|text))|could(n't| not) (find|locate)|cannot (find|answer)|can't (find|answer)|unable to (find|answer)|isn't (mentioned|in|stated)|outside (of )?(the|this) (document|manual)/i;
const citedPages = (text) => [...text.matchAll(/(?:pages?|pp?\.)\s*(\d{1,3})(?:\s*(?:,|and|&|-|–)\s*(\d{1,3}))*/gi)].flatMap((m) => [...m[0].matchAll(/\d{1,3}/g)].map((n) => Number(n[0])));

function grade(q, text) {
  const problems = [];
  const t = text || '';
  for (const rx of q.must || []) if (!new RegExp(rx, 'i').test(t)) problems.push(`missing /${rx}/`);
  for (const rx of q.mustNot || []) if (new RegExp(rx, 'im').test(t)) problems.push(`forbidden /${rx}/`);
  if (q.refuse && !REFUSAL.test(t)) problems.push('should say the document does not contain this');
  const cited = citedPages(t);
  const wantsCite = (q.pages || []).length > 0 && !q.refuse;
  const citeOk = !wantsCite || cited.some((p) => q.pages.includes(p));
  return { correct: problems.length === 0, problems, cited, citeOk: wantsCite ? citeOk : null };
}

const results = [];
const list = spec.questions.filter((q) => !only || only.has(q.id));
for (const q of list) {
  for (let run = 1; run <= repeat; run += 1) {
    const mode = q.mode || 'auto';
    let reply; let hits = null;
    try { reply = await ask(q.q, mode, `eval-${q.id}-${run}-${Date.now()}`); } catch (e) { reply = { ok: false, error: String(e.message || e) }; }
    try { const r = await retrieve(q.q); hits = (r.result?.chunks || []).map((c) => c.page); } catch { /* retrieval is informational */ }
    const text = reply.ok ? reply.result.response_text : '';
    const backendError = reply.ok ? reply.result?.error : reply.error;
    const g = reply.ok && !backendError ? grade(q, text) : { correct: false, problems: [`request failed: ${backendError}`], cited: [], citeOk: null };
    const retrievalHit = (q.pages || []).length === 0 || !hits ? null : q.pages.some((p) => hits.includes(p));
    results.push({ id: q.id, kind: q.kind, run, mode, question: q.q, answer: text, intent: reply.result?.intent, error: backendError || null, correct: g.correct, problems: g.problems, cited: g.cited, citeOk: g.citeOk, retrievedPages: hits, retrievalHit, ms: reply.result ? reply.ms : null, tokens: reply.result?.usage?.total_tokens ?? null });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'eval-partial.json'), JSON.stringify({ results }, null, 2));
    console.log(`${g.correct ? 'PASS' : 'FAIL'}  ${q.id.padEnd(3)} ${q.kind.padEnd(16)} ${reply.ms ?? ''}ms${g.correct ? '' : '  -> ' + g.problems.join('; ')}`);
  }
}

const by = (fn) => results.reduce((acc, r) => { (acc[fn(r)] ||= []).push(r); return acc; }, {});
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');
const summary = {
  model: setup.profile.model, when: new Date().toISOString(), runs: results.length,
  correct: results.filter((r) => r.correct).length,
  byKind: Object.fromEntries(Object.entries(by((r) => r.kind)).map(([k, v]) => [k, `${v.filter((r) => r.correct).length}/${v.length}`])),
  citationOk: pct(results.filter((r) => r.citeOk === true).length, results.filter((r) => r.citeOk !== null).length),
  retrievalHit: pct(results.filter((r) => r.retrievalHit === true).length, results.filter((r) => r.retrievalHit !== null).length),
  medianMs: [...results.map((r) => r.ms).filter(Boolean)].sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? null,
  avgTokens: Math.round(results.reduce((s, r) => s + (r.tokens || 0), 0) / Math.max(1, results.length))
};
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(path.join(outDir, `eval-${stamp}.json`), JSON.stringify({ summary, results }, null, 2));
console.log('\n' + JSON.stringify(summary, null, 2));
ws.onclose = null;
ws.close();
process.exit(0);
