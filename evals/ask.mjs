// Ask one question and print the raw answer plus what retrieval returned: node evals/ask.mjs "question" [auto|document]
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const pdf = path.resolve(here, 'corpus/harbor-lights-manual.pdf');
const [q, mode = 'auto'] = process.argv.slice(2);
const page = (await (await fetch('http://127.0.0.1:9222/json')).json()).find((t) => t.url.includes('index.html'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x.result); pend.delete(x.id); } };
const ev = (expression) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); }).then((r) => r.result.value ?? r.exceptionDetails?.exception?.description);
const out = await ev(`(async () => {
  const state = await import('./js/state.js');
  const p = state.getApiProfiles().find((x) => x.id === state.getActiveApiProfileId()) || state.getApiProfiles()[0];
  const pdfId = await window.electronAPI.getPdfId(${JSON.stringify(pdf)});
  const storagePath = await window.electronAPI.getUserDataPath();
  const hits = await window.electronAPI.queryPDF({ query: ${JSON.stringify(q)}, pdfId, storagePath, k: 3 });
  const res = await window.electronAPI.invokeAgent({ requestId: crypto.randomUUID(), query: ${JSON.stringify(q)}, pdfId, storagePath, apiKey: p.key || '', apiFormat: p.format, apiUrl: p.url || '', model: p.model, profile: p, conversationId: 'ask-' + Date.now(), mode: ${JSON.stringify(mode)}, instructions: [], context: '', messages: [], parts: [] });
  return { retrieved: (hits.result?.chunks || []).map((c) => 'p' + c.page + ': ' + c.text.slice(0, 70)), ok: res.ok, error: res.error, intent: res.result?.intent, answer: res.result?.response_text };
})()`);
console.log(JSON.stringify(out, null, 2));
ws.close(); process.exit(0);
