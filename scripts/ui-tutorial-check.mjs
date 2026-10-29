// Walks the welcome and reader tours in a brand-new profile and checks each step.
//   start the app with an EMPTY --user-data-dir and --remote-debugging-port=9222, then:
//   node scripts/ui-tutorial-check.mjs <outDir> <pdf> [WxH]
import fs from 'fs';
import path from 'path';

const [outDir, pdf, sizeArg = '1280x800'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const [W, H] = sizeArg.split('x').map(Number);

const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json`)).json();
const page = targets.find((t) => t.url.includes('index.html'));
const baseUrl = page.url.split('?')[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') problems.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || '').split('\n')[0]);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

let failures = 0;
const check = (ok, name, detail = '') => { if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); };

const stepInfo = () => ev(`(() => {
  const layer = document.querySelector('.tour-layer'); if (!layer) return null;
  const card = layer.querySelector('.tour-card').getBoundingClientRect();
  const spot = layer.querySelector('.tour-spot');
  const spotRect = spot.hidden ? null : spot.getBoundingClientRect();
  const overlap = spotRect && !(card.right < spotRect.left || card.left > spotRect.right || card.bottom < spotRect.top || card.top > spotRect.bottom);
  return {
    count: layer.querySelector('.tour-count').textContent, title: layer.querySelector('.tour-title').textContent,
    inside: card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight,
    card: { l: Math.round(card.left), t: Math.round(card.top), w: Math.round(card.width), h: Math.round(card.height) },
    spot: spotRect && { l: Math.round(spotRect.left), t: Math.round(spotRect.top), w: Math.round(spotRect.width), h: Math.round(spotRect.height) },
    overlap: !!overlap, focus: document.activeElement?.className || '', next: layer.querySelector('.tour-next').textContent
  };
})()`);

async function walk(prefix) {
  let steps = 0;
  for (let guard = 0; guard < 20; guard += 1) {
    await sleep(700);
    const info = await stepInfo();
    if (!info) break;
    steps += 1;
    check(info.inside, `${prefix} step ${steps} "${info.title}" card is fully on screen`, JSON.stringify(info.card));
    check(!info.overlap, `${prefix} step ${steps} card does not cover its target`);
    check(/tour-next/.test(info.focus), `${prefix} step ${steps} keyboard focus is on Next`);
    await shot(`${prefix}-${String(steps).padStart(2, '0')}-${info.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`);
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  }
  return steps;
}

// ---------------- welcome tour (auto-starts for a brand-new person)
await send('Page.reload');
await sleep(3500);
const started = await ev(`!!document.querySelector('.tour-layer')`);
check(started, 'welcome tour starts by itself for a new person');
const welcomeSteps = await walk('welcome');
check(welcomeSteps === 5, 'welcome tour has 5 steps', `${welcomeSteps}`);
check(!(await ev(`!!document.querySelector('.tour-layer')`)), 'tour closes when finished');
check(await ev(`JSON.parse(window.electronAPI.getItem('smartpdf.onboarding') || '{}').tours?.welcome === true`), 'finishing is remembered');

await send('Page.reload');
await sleep(3000);
check(!(await ev(`!!document.querySelector('.tour-layer')`)), 'the welcome tour does not start a second time');

// ---------------- Escape skips
await ev(`document.getElementById('nav-help').click()`);
await sleep(500);
await shot('help-top');
await ev(`[...document.querySelectorAll('.help-tours .btn')][0].click()`);
await sleep(900);
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(500);
check(!(await ev(`!!document.querySelector('.tour-layer')`)), 'Escape closes the tour');

// ---------------- checklist on Home
await ev(`document.getElementById('nav-home').click()`);
await sleep(400);
const gs = await ev(`(() => { const b = document.getElementById('getting-started'); return { visible: !b.hidden, items: b.querySelectorAll('.gs-item').length, done: b.querySelectorAll('.gs-item.done').length, sub: document.getElementById('gs-sub').textContent }; })()`);
check(gs.visible && gs.items === 5 && gs.done === 0, 'checklist shows five untouched steps for a new person', JSON.stringify(gs));
await shot('home-checklist-new');

// ---------------- open a document: the reader nudge, then the reader tour
await send('Page.navigate', { url: `${baseUrl}?open=${encodeURIComponent(pdf)}` });
await sleep(4500);
check(await ev(`!document.getElementById('tour-offer').hidden`), 'first document shows the reader-tour nudge');
await shot('reader-offer');
await ev(`document.querySelector('#tour-offer .btn.primary').click()`);
const readerSteps = await walk('reader');
check(readerSteps >= 8, 'reader tour walks through the reader', `${readerSteps} steps`);
check(await ev(`JSON.parse(window.electronAPI.getItem('smartpdf.onboarding') || '{}').done?.open === true`), 'opening a document ticked "Open a PDF"');
await send('Page.navigate', { url: `${baseUrl}?open=${encodeURIComponent(pdf)}` });
await sleep(3500);
check(await ev(`document.getElementById('tour-offer').hidden`), 'the nudge is shown only once');

// ---------------- checklist ticks itself
await ev(`document.getElementById('nav-home').click()`);
await sleep(400);
const gs2 = await ev(`document.querySelectorAll('#getting-started .gs-item.done').length`);
check(gs2 >= 1, 'the checklist ticked off what was done', `${gs2} of 5`);
await shot('home-checklist-progress');

// ---------------- help screen
await ev(`document.getElementById('nav-help').click()`);
await sleep(500);
const help = await ev(`({ guides: document.querySelectorAll('.guide').length, faq: document.querySelectorAll('.faq').length, shortcuts: document.querySelectorAll('.shortcut-row').length, scrollW: document.getElementById('help-screen').scrollWidth, clientW: document.getElementById('help-screen').clientWidth })`);
check(help.guides >= 6 && help.faq >= 5 && help.shortcuts >= 4, 'help shows guides, shortcuts and questions', JSON.stringify(help));
check(help.scrollW <= help.clientW + 1, 'help does not scroll sideways');
await ev(`document.querySelectorAll('.guide')[1].open = true; document.querySelectorAll('.guide')[1].scrollIntoView({block:'start'})`);
await sleep(400);
await shot('help-guide-open');
await ev(`document.querySelectorAll('.faq')[0].open = true; document.querySelector('.shortcut-list').scrollIntoView({block:'center'})`);
await sleep(300);
await shot('help-shortcuts');

check(problems.length === 0, 'no exceptions during any of this', problems.slice(0, 3).join(' | '));
console.log(failures === 0 ? '\nALL TUTORIAL CHECKS PASSED' : `\n${failures} failure(s)`);
await send('Emulation.clearDeviceMetricsOverride');
ws.close();
process.exit(failures === 0 ? 0 : 1);
