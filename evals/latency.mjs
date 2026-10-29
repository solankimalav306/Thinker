// Times one bare model call (no document, no agent) so pipeline cost can be told apart from model cost.
const page = (await (await fetch('http://127.0.0.1:9222/json')).json()).find((t) => t.url.includes('index.html'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x.result); pend.delete(x.id); } };
const ev = (expression) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); }).then((r) => r.result.value ?? r.exceptionDetails?.exception?.description);
const out = await ev(`(async () => {
  const state = await import('./js/state.js');
  const p = state.getApiProfiles().find((x) => x.id === state.getActiveApiProfileId()) || state.getApiProfiles()[0];
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const res = await window.electronAPI.askLLM({ profile: p, model: p.model, apiKey: p.key || '', parts: [{ text: 'Reply with the single word: ok' }] });
    times.push({ ok: res.ok, ms: Math.round(performance.now() - t0), text: String(res.text || res.result || res.error || '').slice(0, 40) });
  }
  return times;
})()`);
console.log(JSON.stringify(out));
ws.close(); process.exit(0);
