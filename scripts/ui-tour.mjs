// Layout tour: screenshots every view in both themes at several window sizes and flags overflow.
// Start the app with --remote-debugging-port=9222 and a PDF, then: node scripts/ui-tour.mjs <outDir> [sizes] [themes] [full]
import fs from 'fs';

const [outDir, sizesArg = '1440x900,1280x800,1100x700,960x640', themesArg = 'dark,light', full = ''] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json`)).json();
const page = targets.find((t) => t.url.includes('index.html'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.click()`);
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.data, 'base64'));
};

const problems = () => ev(`(() => {
  const out = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) out.push('page scrolls horizontally');
  const tb = document.querySelector('.toolbar-center');
  if (tb && tb.offsetParent && tb.scrollWidth > tb.clientWidth + 1) out.push('toolbar overflows by ' + (tb.scrollWidth - tb.clientWidth) + 'px');
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
  document.querySelectorAll('.app-shell *').forEach((el) => {
    if (!el.offsetParent) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') return;
    if (r.right > vw + 2 && !el.closest('.pdf-stage, .pdf-tabs, .chat-container')) out.push('offscreen: ' + name(el) + ' right=' + Math.round(r.right));
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible' && el.children.length === 0 && el.textContent.trim() && cs.display !== 'inline') out.push('text clipped: ' + name(el));
  });
  return [...new Set(out)].slice(0, 6);
})()`);

const waitReady = async () => {
  for (let i = 0; i < 40; i++) {
    const ok = await ev(`!!document.getElementById('chat-input') && document.getElementById('page-num')?.value !== '0'`);
    if (ok) return;
    await sleep(500);
  }
};

let failures = 0;
for (const themeName of themesArg.split(',')) {
  await ev(`window.electronAPI.setItem('smartpdf.theme', ${JSON.stringify(themeName)})`);
  for (const size of sizesArg.split(',')) {
    const [w, h] = size.split('x').map(Number);
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send('Page.reload');
    await sleep(2500);
    await waitReady();
    await sleep(800);
    const tag = `${themeName}-${w}`;

    // reader, chat open
    await click('#nav-reader');
    if (await ev(`!document.getElementById('chat-input').offsetParent`)) await click('#nav-chat');
    await sleep(900);
    await shot(`${tag}-reader`);
    let p = await problems();
    console.log(tag, 'reader', p.length ? 'PROBLEMS ' + JSON.stringify(p) : 'ok');
    failures += p.length;

    await click('#nav-chat'); // close the drawer for the other views
    await click('#nav-home'); await sleep(500);
    await shot(`${tag}-home`);
    p = await problems();
    console.log(tag, 'home  ', p.length ? 'PROBLEMS ' + JSON.stringify(p) : 'ok');
    failures += p.length;

    await click('#nav-settings'); await sleep(500);
    await shot(`${tag}-settings`);
    p = await problems();
    console.log(tag, 'settings', p.length ? 'PROBLEMS ' + JSON.stringify(p) : 'ok');
    failures += p.length;

    if (full && w === 1280) {
      await click('#nav-reader'); await sleep(400);
      await click('#nav-chat'); await sleep(500);
      await click('[data-convo-action=new]'); await sleep(500);
      await shot(`${tag}-chat-new`);
      await click('#save-annotations-btn'); await sleep(600);
      await shot(`${tag}-save-modal`);
      await click('#save-modal-close'); await sleep(300);
      await click('[data-convo-action=instructions]'); await sleep(700);
      await shot(`${tag}-instructions`);
      await ev(`document.querySelector('.instructions-overlay .btn.icon-btn')?.click()`); await sleep(300);
      await click('#ai-capabilities-btn'); await sleep(500);
      await shot(`${tag}-capabilities`);
      await click('#close-ai-capabilities'); await sleep(300);
      await click('#nav-mindmaps'); await sleep(500);
      await shot(`${tag}-mindmaps`);
      await click('#nav-glossary'); await sleep(500);
      await shot(`${tag}-glossary`);
      await click('#nav-thumbs'); await sleep(900);
      await shot(`${tag}-pages`);
    }
  }
}
await send('Emulation.clearDeviceMetricsOverride');
console.log(failures === 0 ? 'NO LAYOUT PROBLEMS' : failures + ' layout problem(s)');
ws.close();
process.exit(0);
