// Hard UI tests against the running app (CDP). Start Thinker with --remote-debugging-port=9222, then:
//   node scripts/ui-stress.mjs <outDir> <fixturesDir> [sections]
// sections (comma separated, default all): docs, text, tabs, viewports, audit, interact
import fs from 'fs';
import path from 'path';

const [outDir, fixturesDir, sectionsArg = 'docs,text,tabs,viewports,audit,interact'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sections = new Set(sectionsArg.split(','));

// ------------------------------------------------------------------ connection
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find((t) => t.url.includes('index.html'));
const baseUrl = page.url.split('?')[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const consoleIssues = [];
const NOISE = /Deprecated API usage|Security Warning|No sticky notes|MinimalTransformer|Electron/i;
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleIssues.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    const text = msg.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200);
    if (!NOISE.test(text)) consoleIssues.push('console.error ' + text);
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    const text = `${msg.params.entry.text} ${msg.params.entry.url || ''}`.slice(0, 200);
    if (!NOISE.test(text)) consoleIssues.push('log.error ' + text);
  }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.click()`);
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
// Tours are covered by ui-tutorial-check.mjs; here they must not pop up over other tests.
await ev(`window.electronAPI.setItem('smartpdf.onboarding', JSON.stringify({ done: {}, dismissed: false, tours: { welcome: true, reader: true, readerOffer: true } }))`);

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
};

// ------------------------------------------------------------------ reporting
const findings = [];
let section = '';
const report = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${name}${detail ? '  -> ' + detail : ''}`);
  if (!ok) findings.push({ section, name, detail });
};
const takeConsole = () => consoleIssues.splice(0, consoleIssues.length);

async function openDoc(file, { settleMs = 1800 } = {}) {
  await send('Page.navigate', { url: `${baseUrl}?open=${encodeURIComponent(file)}` });
  await sleep(settleMs);
  for (let i = 0; i < 40; i += 1) {
    const state = await ev(`({ ready: document.readyState, count: document.getElementById('page-count')?.textContent, status: document.getElementById('status-text')?.textContent })`);
    if (state.ready === 'complete' && state.count && state.count !== '0') return state;
    if (/fail|error|invalid|password|could not be opened|locked/i.test(state.status || '') && i > 3) return state;
    await sleep(400);
  }
  return ev(`({ status: document.getElementById('status-text')?.textContent, count: document.getElementById('page-count')?.textContent })`);
}
const setTheme = (theme) => ev(`window.electronAPI.setItem('smartpdf.theme', ${JSON.stringify(theme)})`);
const viewport = (w, h, scale = 1) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false });

// generic page health: horizontal overflow, clipped text, widgets outside the window
const layoutProblems = () => ev(`(() => {
  const out = [];
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  if (document.documentElement.scrollWidth > vw + 1) out.push('page scrolls horizontally by ' + (document.documentElement.scrollWidth - vw));
  if (document.body.scrollHeight > vh + 1) out.push('page scrolls vertically');
  const rail = document.querySelector('.activity-bar');
  if (rail && rail.offsetParent && innerHeight >= 600 && rail.scrollHeight > rail.clientHeight + 1) out.push('the navigation rail scrolls (' + (rail.scrollHeight - rail.clientHeight) + 'px hidden)');
  const tb = document.querySelector('.toolbar-center');
  if (tb && tb.offsetParent && tb.scrollWidth > tb.clientWidth + 1 && !/auto|scroll/.test(getComputedStyle(tb).overflowX)) out.push('toolbar overflows by ' + (tb.scrollWidth - tb.clientWidth));
  const tabs = document.getElementById('pdf-tabs');
  if (tabs) { const r = tabs.getBoundingClientRect(); if (r.right > vw - 130) out.push('tabs run under the window controls (right=' + Math.round(r.right) + ')'); }
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
  document.querySelectorAll('.app-shell *, .modal-overlay *').forEach((el) => {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || el.classList.contains('resizer')) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') return;
    if (el.closest('.pdf-stage, .pdf-tabs, .chat-history, .chat-rows, .notes-list, .reader-sidebar, .settings-screen, .welcome-screen')) {
      // scrollable regions: check only that children do not exceed the region horizontally
      const host = el.closest('.chat-history, .chat-rows, .notes-list, .reader-sidebar, .settings-screen, .welcome-screen');
      if (host && host !== el) { const h = host.getBoundingClientRect(); if (r.right > h.right + 2 && cs.position !== 'fixed' && !el.closest('.bot-msg pre, .bot-msg table')) out.push('overflows its panel: ' + name(el) + ' by ' + Math.round(r.right - h.right)); }
    } else if (r.right > vw + 2 && cs.position !== 'fixed' && !el.closest('.toolbar-center')) out.push('offscreen: ' + name(el) + ' right=' + Math.round(r.right));
    if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible' && cs.display !== 'inline') out.push('text clipped: ' + name(el) + ' "' + el.textContent.trim().slice(0, 30) + '"');
  });
  return [...new Set(out)].slice(0, 8);
})()`);

// ------------------------------------------------------------------ DOCS
if (sections.has('docs')) {
  section = 'docs';
  await viewport(1280, 800);
  await setTheme('dark');
  const cases = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.pdf'));
  for (const file of cases) {
    takeConsole();
    const full = path.join(fixturesDir, file);
    const started = Date.now();
    const state = await openDoc(full, { settleMs: file.startsWith('big') ? 3000 : 1800 });
    const elapsed = Date.now() - started;
    const label = file.length > 36 ? file.slice(0, 33) + '...' : file;
    const broken = /corrupt|empty|password/.test(file);
    const shotName = 'doc-' + file.replace(/[^a-z0-9]+/gi, '_').slice(0, 24);
    await sleep(500);
    await shot(shotName);
    const info = await ev(`({
      pages: document.getElementById('page-count')?.textContent,
      tab: [...document.querySelectorAll('.pdf-tab .tab-title')].map(t => ({ text: t.textContent, over: t.scrollWidth > t.clientWidth, w: Math.round(t.getBoundingClientRect().width) })),
      status: document.getElementById('status-text')?.textContent,
      view: document.getElementById('welcome-screen').classList.contains('visible') ? 'home' : document.getElementById('reader-layout').classList.contains('visible') ? 'reader' : 'other',
      canvas: (() => { const c = document.getElementById('pdf-render'); if (!c || !c.width) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 400) if (d[i] < 200) ink++; return { w: c.width, h: c.height, ink }; })(),
      dialog: !!document.querySelector('.password-dialog, .error-view, [role=alertdialog], .doc-error')
    })`);
    if (!broken) {
      report(info.view === 'reader' && Number(info.pages) > 0, `opens: ${label}`, `${info.pages} pages in ${elapsed}ms`);
      report(info.canvas && info.canvas.ink > 0 && info.canvas.w < 5000 && info.canvas.w > 80, `renders content at a sane size: ${label}`, JSON.stringify(info.canvas));
      const fit = await ev(`(() => { const c = document.getElementById('pdf-render'); const st = document.getElementById('pdf-stage'); return c && st ? +(c.getBoundingClientRect().width / (st.clientWidth - 36)).toFixed(2) : null; })()`);
      report(fit !== null && fit >= 0.85 && fit <= 1.02 || /tiny|mixed/.test(file), `page is fitted to the window: ${label}`, `page/stage width ratio ${fit}`);
      const tab = info.tab.find((t) => t.text && !/^\s*Home\s*$/.test(t.text));
      report(!tab || tab.w <= 230, `tab stays a sane width: ${label}`, tab ? `${tab.w}px "${tab.text.slice(0, 24)}..."` : '');
    } else {
      // broken files: the user must see a clear message and must not be stranded
      const friendly = info.dialog && !/Exception/.test(info.status || '') && !/Exception/.test(await ev(`document.getElementById('doc-state').innerText.split('Technical details')[0]`));
      report(friendly, `broken file gives a clear message: ${file}`, `status="${info.status}" view=${info.view}`);
      report(await ev(`!!document.getElementById('nav-home') && !document.getElementById('nav-home').disabled`), `app stays usable after: ${file}`);
    }
    const errs = takeConsole();
    report(errs.length === 0 || broken, `no console errors: ${label}`, errs.slice(0, 2).join(' | '));
    if (file.startsWith('password')) {
      const hasField = await ev(`!!document.querySelector('.doc-error input[type=password]')`);
      report(hasField, 'locked PDF asks for a password');
      await ev(`(() => { const i = document.querySelector('.doc-error input[type=password]'); i.value = 'nope'; i.form.requestSubmit(); })()`);
      await sleep(1500);
      report(await ev(`/didn.t work/.test(document.getElementById('doc-state').innerText)`), 'a wrong password is explained, not silent');
      await shot('doc-password-wrong');
      await ev(`(() => { const i = document.querySelector('.doc-error input[type=password]'); i.value = 'secret'; i.form.requestSubmit(); })()`);
      await sleep(2000);
      report(await ev(`document.getElementById('page-count').textContent`) === '1' && await ev(`document.getElementById('doc-state').hidden`), 'the right password opens the document');
    }
    if (file.startsWith('big')) {
      const t0 = Date.now();
      await ev(`window.dispatchEvent(new CustomEvent('navigate-pdf-page', { detail: { page: 300 } }))`);
      await sleep(900);
      report(await ev(`document.getElementById('page-num').value`) === '300', 'jump to page 300 of 300', `${Date.now() - t0}ms`);
      await click('#nav-thumbs');
      const t1 = Date.now();
      await sleep(2500);
      const thumbs = await ev(`document.querySelectorAll('.thumb-item').length`);
      report(thumbs > 0, 'thumbnails panel renders for 300 pages', `${thumbs} thumbs, ${Date.now() - t1}ms`);
      const responsive = await ev(`(async () => { const t = performance.now(); await new Promise(r => setTimeout(r, 0)); return performance.now() - t; })()`);
      report(responsive < 200, 'UI thread is responsive after opening big thumbnails', `${Math.round(responsive)}ms event-loop delay`);
    }
  }
}

// ------------------------------------------------------------------ TEXT (hostile content)
if (sections.has('text')) {
  section = 'text';
  await viewport(1280, 800);
  await setTheme('dark');
  const doc = path.join(fixturesDir, 'single-page.pdf');
  await openDoc(doc);
  await click('#nav-chat');
  const wasClosed = await ev(`!document.getElementById('chat-input').offsetParent`);
  if (wasClosed) await click('#nav-chat');
  await sleep(500);
  takeConsole();

  const nasty = {
    html: 'Try <img src=x onerror="window.__pwned=1"> and <script>window.__pwned=1<\/script> and <b>bold?</b> [click](javascript:window.__pwned=1)',
    longword: 'Supercalifragilisticexpialidocious'.repeat(12),
    url: 'See https://example.com/' + 'a-very-long-path-segment/'.repeat(10) + 'end',
    rtl: 'مرحبا بالعالم، هذا اختبار للنص من اليمين إلى اليسار. ' + 'नमस्ते दुनिया, यह एक परीक्षण है।',
    emoji: 'Great job 🎉🚀👩🏽‍💻 — résumé naïve café — 日本語のテキスト — Ελληνικά',
    code: '```python\nfor i in range(10):\n    print("a very long line of code that goes on and on and on " * 5, i)\n```',
    table: '| Concept | Definition | Page |\n|---|---|---|\n| Preemption | Forcibly switching the running task on a timer tick, which the scheduler uses to share the CPU fairly | 12 |\n| Context switch | Saving and restoring registers | 14 |',
    quote: '> A quoted passage\n> over two lines\n\n1. one\n2. two\n   - nested **bold** and *italic*\n\n# Heading one\n## Heading two\n### Heading three'
  };

  // seed one conversation per nasty string (title and answer), via the real storage API
  for (const [key, content] of Object.entries(nasty)) {
    const conv = await ev(`window.electronAPI.createConversation(${JSON.stringify(doc)}, { title: ${JSON.stringify(content.slice(0, 80))} })`);
    await ev(`window.electronAPI.appendConversationMessage(${JSON.stringify(conv.id)}, { role: 'user', text: ${JSON.stringify(content)}, question: ${JSON.stringify(content)} })`);
    await ev(`window.electronAPI.appendConversationMessage(${JSON.stringify(conv.id)}, { role: 'assistant', text: ${JSON.stringify(content + '\n\nAs shown on [Page 3] and [Page 12]. [AI Knowledge] also applies.')} })`);
  }
  // a very long chat title
  const longTitle = 'x'.repeat(200);
  await ev(`window.electronAPI.createConversation(${JSON.stringify(doc)}, { title: ${JSON.stringify(longTitle)} })`);
  await send('Page.reload');
  await sleep(2500);
  if (await ev(`!document.getElementById('chat-input').offsetParent`)) await click('#nav-chat');
  await sleep(600);

  const convs = await ev(`window.electronAPI.listConversations(${JSON.stringify(doc)})`);
  for (const [key] of Object.entries(nasty)) {
    const conv = convs.find((c) => c.title === nasty[key].slice(0, 80));
    if (!conv) { report(false, `seeded chat found: ${key}`); continue; }
    await ev(`(async () => { document.querySelector('.convo-current').click(); await new Promise(r => setTimeout(r, 200)); [...document.querySelectorAll('.chat-row')].find(r => r.textContent.includes(${JSON.stringify(nasty[key].slice(0, 20))}))?.click(); })()`);
    await sleep(500);
    const probs = await layoutProblems();
    const own = await ev(`(() => { const h = document.getElementById('chat-history'); return { sw: h.scrollWidth, cw: h.clientWidth, msgs: [...h.querySelectorAll('.user-msg, .bot-msg')].map(m => Math.round(m.getBoundingClientRect().right - h.getBoundingClientRect().right)), pwned: !!window.__pwned, imgs: h.querySelectorAll('.bot-msg img[src="x"], .bot-msg script').length }; })()`);
    report(own.sw <= own.cw + 1, `chat does not scroll sideways: ${key}`, `scrollWidth ${own.sw} vs ${own.cw}`);
    report(Math.max(...own.msgs, -999) <= 2, `bubbles stay inside the panel: ${key}`, `max overflow ${Math.max(...own.msgs, -999)}px`);
    report(!own.pwned && own.imgs === 0, `hostile markup is inert: ${key}`);
    report(probs.length === 0, `no layout problems: ${key}`, probs.join(' | '));
    if (['html', 'longword', 'rtl', 'table', 'code'].includes(key)) await shot(`text-${key}`);
  }

  // the long title and the full list
  await click('.convo-current');
  await sleep(400);
  const listInfo = await ev(`(() => { const l = document.getElementById('chat-list'); const rows = [...l.querySelectorAll('.chat-row')]; const t = rows.map(r => r.querySelector('.chat-row-title')); return { rows: rows.length, h: Math.round(l.getBoundingClientRect().height), bottom: Math.round(l.getBoundingClientRect().bottom), winH: innerHeight, titleOver: t.some(x => x && x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).textOverflow !== 'ellipsis'), rowOverflow: rows.some(r => r.scrollWidth > r.clientWidth + 1) }; })()`);
  report(listInfo.rows >= 9, 'chat list shows all seeded chats', `${listInfo.rows} rows`);
  report(listInfo.bottom <= listInfo.winH, 'chat list stays inside the window', `bottom ${listInfo.bottom} vs ${listInfo.winH}`);
  report(!listInfo.titleOver && !listInfo.rowOverflow, 'long chat titles are truncated with an ellipsis');
  await shot('text-chat-list');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);

  // rename edge cases
  await click('.convo-current');
  await sleep(300);
  await ev(`document.querySelector('.chat-row .chat-row-btn[title=Rename]').click()`);
  await sleep(200);
  await ev(`(() => { const i = document.querySelector('.chat-row-rename'); i.value = '<img src=x onerror=window.__pwned=1> & "quoted"'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(500);
  report(!(await ev(`!!window.__pwned`)), 'renaming a chat with markup is inert');
  const titles = await ev(`window.electronAPI.listConversations(${JSON.stringify(doc)}).then(l => l.map(c => c.title))`);
  report(titles.some((t) => t.includes('<img src=x')), 'markup is kept as plain text in the title');

  // notes / glossary / history / mind map panels with hostile + long content
  const hostile = '<img src=x onerror=window.__pwned=1><b>bold</b> ' + 'verylongwordwithoutanyspaces'.repeat(8);
  await ev(`window.electronAPI.saveNotes(${JSON.stringify(doc)}, [{ id: 'n1', source: ${JSON.stringify(hostile.slice(0, 40))}, date: new Date().toISOString(), content: ${JSON.stringify(hostile + '\n\n## Heading\n- item one\n- item two')} }, { id: 'n2', source: 'Chat', date: new Date().toISOString(), content: 'Short note' }])`);
  await ev(`window.electronAPI.addToGlossary({ term: ${JSON.stringify(hostile.slice(0, 60))}, definition: ${JSON.stringify(hostile)}, source: 'llm' })`);
  await ev(`window.electronAPI.saveMindmap(${JSON.stringify(doc)}, { title: ${JSON.stringify(hostile.slice(0, 80))}, code: ${JSON.stringify('# Root\n## Child')} })`);
  await send('Page.reload');
  await sleep(2500);
  for (const [nav, name] of [['#nav-notes', 'notes'], ['#nav-glossary', 'glossary'], ['#nav-mindmaps', 'mindmaps'], ['#nav-history', 'history']]) {
    await click(nav);
    await sleep(700);
    const probs = await layoutProblems();
    report(probs.length === 0, `${name} panel handles hostile and long content`, probs.join(' | '));
    report(!(await ev(`!!window.__pwned`)), `${name} panel is inert`);
    await shot(`text-panel-${name}`);
  }
  await click('#nav-notes');
  await sleep(400);
  await ev(`document.getElementById('tab-sticky-notes')?.click()`);
  await sleep(300);
  await shot('text-panel-sticky-empty');
  const errs = takeConsole();
  report(errs.length === 0, 'no console errors while rendering hostile content', errs.slice(0, 3).join(' | '));
}

// ------------------------------------------------------------------ TABS
if (sections.has('tabs')) {
  section = 'tabs';
  await viewport(1280, 800);
  await setTheme('dark');
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.pdf') && !/corrupt|empty|password/.test(f)).map((f) => path.join(fixturesDir, f));
  await ev(`window.electronAPI.setItem('smartpdf.recents', ${JSON.stringify(JSON.stringify(files))})`);
  await openDoc(files[0]);
  takeConsole();
  for (let i = 1; i < files.length; i += 1) {
    await click('#nav-home');
    await sleep(300);
    await ev(`document.querySelectorAll('.recent-item-btn')[${i}]?.click()`);
    await sleep(900);
  }
  await sleep(800);
  const tabInfo = await ev(`(() => { const t = document.getElementById('pdf-tabs'); const vw = innerWidth; return { n: document.querySelectorAll('.pdf-tab:not(.tab-add):not(.pdf-tab-home)').length, right: Math.round(t.getBoundingClientRect().right), scroll: t.scrollWidth > t.clientWidth, widths: [...t.querySelectorAll('.pdf-tab')].map(x => Math.round(x.getBoundingClientRect().width)), addVisible: (() => { const a = t.querySelector('.tab-add'); const r = a.getBoundingClientRect(); return r.right <= t.getBoundingClientRect().right + 1 && r.width > 0; })() }; })()`);
  report(tabInfo.n >= 5, 'many documents open as tabs', `${tabInfo.n} tabs`);
  report(tabInfo.right <= 1280 - 130, 'tab strip stays clear of the window controls', `right edge ${tabInfo.right}`);
  report(tabInfo.widths.slice(0, -1).every((w) => w >= 56), 'no tab is squashed to nothing', tabInfo.widths.join(','));
  await shot('tabs-many');
  report((await layoutProblems()).length === 0, 'layout is clean with many tabs', (await layoutProblems()).join(' | '));
  // close the active tab repeatedly
  for (let i = 0; i < 3; i += 1) { await ev(`document.querySelector('.pdf-tab.active .tab-close')?.click()`); await sleep(500); }
  report(await ev(`!!document.querySelector('.pdf-tab.active')`), 'closing tabs always leaves one active');
  const errs = takeConsole();
  report(errs.length === 0, 'no console errors while opening and closing tabs', errs.slice(0, 3).join(' | '));
}

// ------------------------------------------------------------------ VIEWPORTS (sizes + OS display scaling / zoom)
if (sections.has('viewports')) {
  section = 'viewports';
  const doc = path.join(fixturesDir, 'mixed-pages.pdf');
  const combos = [
    [960, 620, 1], [1024, 768, 1], [1366, 768, 1], [1920, 1080, 1], [2560, 1440, 1],
    [768, 500, 1.25], [640, 450, 1.5], [480, 400, 2]  // layout widths under 125/150/200% zoom of a 960px window
  ];
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    for (const [w, h, scale] of combos) {
      await viewport(w, h, scale);
      await openDoc(doc);
      if (await ev(`!document.getElementById('chat-input').offsetParent`)) await click('#nav-chat');
      await sleep(700);
      const tag = `${theme}-${w}x${h}@${scale}`;
      const probs = await layoutProblems();
      const note = w < 960 ? ' (below the supported window size; must still degrade gracefully)' : '';
      report(probs.length === 0, `reader + chat ${tag}${note}`, probs.join(' | '));
      if (w === 960 || w === 2560 || w === 640) await shot(`vp-${tag}`);
      await click('#nav-chat');
      for (const nav of ['#nav-home', '#nav-settings']) {
        await click(nav);
        await sleep(400);
        const p2 = await layoutProblems();
        report(p2.length === 0, `${nav.slice(5)} ${tag}`, p2.join(' | '));
      }
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
}

// ------------------------------------------------------------------ AUDIT (contrast, fonts, icons, focus)
if (sections.has('audit')) {
  section = 'audit';
  await viewport(1280, 800);
  const auditFn = `(async () => {
    await Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1500))]);
    const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { chain.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = chain.length - 1; i >= 0; i--) base = blend(chain[i], base); return base; };
    const effAlpha = (el) => { let a = 1; for (let e = el; e; e = e.parentElement) a *= parseFloat(getComputedStyle(e).opacity); return a; };
    const issues = { contrast: [], fonts: [], small: [], icons: [], hit: [] };
    const sel = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : ''));
    const seen = new Set();
    const visibleRoots = document.querySelectorAll('.app-shell, .modal-overlay, .modal, .status-toast, .custom-context-menu, .dict-tooltip, .tour-layer, .tour-offer');
    visibleRoots.forEach((root) => {
      if (root.offsetParent === null && getComputedStyle(root).position !== 'fixed') return;
      if (getComputedStyle(root).display === 'none') return;
      root.querySelectorAll('*').forEach((el) => {
        if (el.closest('.textLayer, .pdf-viewer, canvas, svg, .pdf-page-card, .thumb-item canvas')) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        if (el.offsetParent === null && cs.position !== 'fixed') return;
        // icons
        if (el.tagName === 'I' && /(^| )fa-/.test(el.className)) {
          const content = getComputedStyle(el, '::before').content;
          if (!content || content === 'none' || content === 'normal' || content === '""') issues.icons.push(sel(el) + ' ' + el.className);
          return;
        }
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        const isField = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
        if (!own && !isField) {
          return;
        }
        const key = sel(el) + '|' + (el.textContent || el.placeholder || '').trim().slice(0, 20);
        if (seen.has(key)) return;
        seen.add(key);
        const fg0 = parse(cs.color);
        if (!fg0) return;
        if (effAlpha(el) < 0.6) return;
        const alpha = fg0.a * effAlpha(el);
        const bg = bgOf(el);
        const fg = blend({ ...fg0, a: alpha }, bg);
        const size = parseFloat(cs.fontSize);
        const bold = parseInt(cs.fontWeight, 10) >= 700;
        const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
        const rr = ratio(fg, bg);
        const text = (el.value || el.textContent || el.placeholder || '').trim().slice(0, 28);
        if (rr < need && !el.disabled && !el.closest('[disabled]') && cs.opacity !== '0') issues.contrast.push(sel(el) + ' "' + text + '" ' + rr.toFixed(2) + ' (need ' + need + ') ' + cs.color);
        if (size < 11.5) issues.small.push(sel(el) + ' ' + size + 'px "' + text + '"');
        const fam = cs.fontFamily;
        if (!/Figtree|Bricolage|ui-monospace|Cascadia|Consolas/i.test(fam)) issues.fonts.push(sel(el) + ' -> ' + fam.slice(0, 40));
      });
      root.querySelectorAll('button, a[href], [role=button], select, input:not([type=hidden]):not([type=checkbox]):not([type=color]):not([type=range])').forEach((el) => {
        const cs = getComputedStyle(el); if (cs.display === 'none' || el.offsetParent === null) return;
        const r = el.getBoundingClientRect(); if (r.width === 0) return;
        if ((r.height < 24 || r.width < 24) && !el.closest('.toggle-switch') && !(el.classList.contains('tab-close')) && !el.closest('.dropdown-content') && !el.classList.contains('welcome-link') && el.tagName !== 'INPUT') issues.hit.push(sel(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
    });
    const uniq = (a) => [...new Set(a)].slice(0, 12);
    return { contrast: uniq(issues.contrast), fonts: uniq(issues.fonts), small: uniq(issues.small), icons: uniq(issues.icons), hit: uniq(issues.hit) };
  })()`;
  const doc = path.join(fixturesDir, 'single-page.pdf');
  const accents = [null, '#4f46e5', '#ff6b57', '#2fbf9b', '#a259f7'];
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    for (const accent of accents) {
      if (accent) await ev(`window.electronAPI.setItem('custom-accent-color', ${JSON.stringify(accent)})`);
      else await ev(`window.electronAPI.removeItem('custom-accent-color')`);
      await openDoc(doc);
      if (await ev(`!document.getElementById('chat-input').offsetParent`)) await click('#nav-chat');
      await sleep(500);
      const views = [['reader', async () => click('#nav-reader')], ['home', async () => click('#nav-home')], ['settings', async () => click('#nav-settings')], ['help', async () => click('#nav-help')]];
      if (!accent) {
        views.push(['chat-list', async () => { await click('#nav-reader'); await click('.convo-current'); }]);
        views.push(['notes', async () => { await click('#nav-reader'); await click('#nav-notes'); }]);
        views.push(['save-dialog', async () => { await click('#nav-reader'); await click('#save-annotations-btn'); }]);
        views.push(['instructions', async () => { await click('#save-modal-close'); await click('[data-convo-action=instructions], #instructions-btn'); }]);
        views.push(['tour', async () => { await click('#nav-help'); await ev(`document.querySelector('.help-tours .btn').click()`); await sleep(900); }]);
        views.push(['help-dialog', async () => { await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(400); await ev(`document.querySelector('.instructions-overlay .btn.icon-btn')?.click()`); await click('#nav-reader'); await click('#ai-capabilities-btn'); }]);
      }
      for (const [name, go] of views) {
        await go();
        await sleep(450);
        const res = await ev(auditFn);
        const tag = `${theme}${accent ? ' ' + accent : ' default'} / ${name}`;
        report(res.contrast.length === 0, `contrast ${tag}`, res.contrast.slice(0, 4).join(' | '));
        if (!accent) {
          report(res.fonts.length === 0, `fonts ${tag}`, res.fonts.slice(0, 3).join(' | '));
          report(res.small.length === 0, `no tiny text ${tag}`, res.small.slice(0, 3).join(' | '));
          report(res.icons.length === 0, `icons resolve ${tag}`, res.icons.slice(0, 3).join(' | '));
          report(res.hit.length === 0, `hit targets ${tag}`, res.hit.slice(0, 3).join(' | '));
        }
      }
      await ev(`document.querySelector('#ai-capabilities-modal') && (document.querySelector('#ai-capabilities-modal').style.display = 'none')`);
    }
  }
  await ev(`window.electronAPI.removeItem('custom-accent-color')`);

  // keyboard: press Tab for real and require a visible focus indicator on every stop
  await setTheme('dark');
  await openDoc(doc);
  await click('#nav-reader');
  await ev(`document.activeElement?.blur(); document.body.focus()`);
  const stops = [];
  for (let i = 0; i < 45; i += 1) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(40);
    stops.push(await ev(`(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a); const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'; return { name: a.id || String(a.className).split(' ')[0] || a.tagName, ring }; })()`));
  }
  const seenStops = stops.filter(Boolean);
  report(seenStops.length >= 20, 'Tab reaches many controls', `${seenStops.length} stops`);
  const noRing = seenStops.filter((x) => !x.ring).map((x) => x.name);
  report(noRing.length === 0, 'every Tab stop shows a focus ring', noRing.slice(0, 6).join(', '));
}

// ------------------------------------------------------------------ INTERACT (behaviour edge cases)
if (sections.has('interact')) {
  section = 'interact';
  await viewport(1280, 800);
  await setTheme('dark');
  const doc = path.join(fixturesDir, 'single-page.pdf');
  await openDoc(doc);
  if (await ev(`!document.getElementById('chat-input').offsetParent`)) await click('#nav-chat');
  takeConsole();

  // 1. asking without any AI model saved
  await ev(`window.electronAPI.setItem('smartpdf.apiProfiles', '[]')`);
  await ev(`window.electronAPI.removeItem('smartpdf.activeApiProfileId')`);
  await send('Page.reload');
  await sleep(2500);
  if (await ev(`!document.getElementById('chat-input').offsetParent`)) await click('#nav-chat');
  await sleep(500);
  await ev(`(() => { const i = document.getElementById('chat-input'); i.value = 'hello'; document.getElementById('chat-send').click(); })()`);
  await sleep(1500);
  const noModel = await ev(`({ guided: !!document.querySelector('.setup-card'), text: document.getElementById('chat-history').innerText.slice(-200), status: document.getElementById('status-text').textContent, nativePrompt: false })`);
  report(noModel.guided, 'asking with no AI model guides the user to set one up', `status="${noModel.status}"`);
  await shot('interact-no-model');

  // 2. rapid double click on New, empty rename, instructions overflow
  await click('#nav-home'); await click('#nav-reader');
  await ev(`(() => { const b = document.querySelector('[data-convo-action=new]'); b.click(); b.click(); b.click(); })()`);
  await sleep(400);
  report((await ev(`window.electronAPI.listConversations(${JSON.stringify(doc)})`)).filter((c) => c.title === 'New chat').length === 0, 'triple-clicking New does not create empty chats');
  report(await ev(`document.querySelectorAll('.agent-welcome').length`) === 1, 'only one welcome card after rapid New clicks');

  await click('#instructions-btn');
  await sleep(500);
  await ev(`[...document.querySelectorAll('.instructions-presets button')][0]?.click()`);
  await sleep(500);
  const bigText = 'x '.repeat(1500);
  await ev(`(() => { const t = document.querySelector('.instruction-card textarea'); t.value = ${JSON.stringify(bigText)}; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(700);
  const dlg = await ev(`(() => { const m = document.querySelector('.instructions-modal'); const r = m.getBoundingClientRect(); return { bottom: Math.round(r.bottom), winH: innerHeight, scrolls: m.scrollHeight > m.clientHeight, foot: document.querySelector('.instructions-foot')?.textContent }; })()`);
  report(dlg.bottom <= dlg.winH, 'instructions dialog stays inside the window with long text', `bottom ${dlg.bottom} of ${dlg.winH}`);
  await shot('interact-instructions-long');
  await ev(`window.electronAPI.listInstructions('global','').then(l => Promise.all(l.map(i => window.electronAPI.deleteInstruction(i.id))))`);
  await ev(`document.querySelector('.instructions-overlay .btn.icon-btn')?.click()`);

  // 3. Escape closes every overlay
  for (const [open, close, name] of [
    ['#save-annotations-btn', '#save-modal', 'export dialog'],
    ['#ai-capabilities-btn', '#ai-capabilities-modal', 'help dialog']
  ]) {
    await click(open); await sleep(300);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
    await sleep(300);
    const stillOpen = await ev(`getComputedStyle(document.querySelector(${JSON.stringify(close)})).display !== 'none'`);
    report(!stillOpen, `Escape closes the ${name}`);
    if (stillOpen) await ev(`document.querySelector(${JSON.stringify(close)}).style.display = 'none'`);
  }

  // 4. settings form validation
  await click('#nav-settings'); await sleep(400);
  await click('#settings-api-add'); await sleep(500);
  const toast = await ev(`document.getElementById('status-text').textContent`);
  report((await ev(`document.querySelectorAll('.settings-inline-form .field-error').length`)) >= 1 && (await ev(`JSON.parse(window.electronAPI.getItem('smartpdf.apiProfiles') || '[]').length`)) === 0, 'saving an empty AI model form explains what is missing and saves nothing', `toast="${toast}"`);
  await shot('interact-settings-validation');
  await ev(`(() => { const l = document.getElementById('settings-api-label'); l.value = '<b>Evil</b> "name" & co'; const m = document.getElementById('settings-chat-model'); m.value = 'gemini-3.5-flash-lite'; })()`);
  await click('#settings-api-add'); await sleep(600);
  const label = await ev(`[...document.querySelectorAll('.settings-api-label')].map(e => e.innerHTML).join('|')`);
  report(!/<b>/.test(label), 'AI model names are shown as plain text');
  await ev(`window.electronAPI.getItem('smartpdf.apiProfiles') && JSON.parse(window.electronAPI.getItem('smartpdf.apiProfiles')).forEach(p => {})`);

  // 5. toast with a very long message and quick repeats
  await ev(`(() => { const t = document.getElementById('status-text'); t.textContent = 'Something went wrong while talking to the model: ' + 'details '.repeat(60); document.getElementById('status-toast').classList.add('show'); })()`);
  await sleep(400);
  const toastBox = await ev(`(() => { const r = document.getElementById('status-toast').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), b: Math.round(r.bottom), h: Math.round(r.height), vw: innerWidth, vh: innerHeight }; })()`);
  report(toastBox.l >= 0 && toastBox.r <= toastBox.vw && toastBox.b <= toastBox.vh && toastBox.h < 300, 'a very long toast stays on screen and compact', JSON.stringify(toastBox));
  await shot('interact-long-toast');

  const errs = takeConsole();
  report(errs.length === 0, 'no console errors during interaction tests', errs.slice(0, 3).join(' | '));
}

// ------------------------------------------------------------------ summary
await send('Emulation.clearDeviceMetricsOverride');
fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(findings, null, 2));
console.log(`\n${findings.length} finding(s)`);
ws.close();
process.exit(0);
