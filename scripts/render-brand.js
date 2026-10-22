// Renders the operating-system icon from the ORIGINAL logo: `npx electron scripts/render-brand.js`.
// The T is the untouched renderer/assets/logo.png, tinted ink and centred on a highlighter-yellow
// rounded square (an OS icon needs a background to stay legible). Output: PNGs and a multi-size ICO.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const brandDir = path.join(root, 'renderer', 'assets', 'brand');
const buildDir = path.join(root, 'build');
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const INK = '#1c1b2e';
const HIGHLIGHTER = '#ffd23f';

// One large off-screen window is reused for every size: Windows will not create tiny windows.
async function rasterise(win, logoDataUrl, size) {
  const glyphHeight = size * 0.56;
  const glyphWidth = glyphHeight * (397 / 461);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
    <div style="width:${size}px;height:${size}px;border-radius:${size * 0.226}px;background:${HIGHLIGHTER};position:relative">
      <div style="position:absolute;left:${(size - glyphWidth) / 2}px;top:${(size - glyphHeight) / 2 + size * 0.01}px;width:${glyphWidth}px;height:${glyphHeight}px;background:${INK};
        -webkit-mask:url(${logoDataUrl}) center/contain no-repeat"></div>
    </div></body></html>`;
  const file = path.join(os.tmpdir(), `thinker-brand-${size}.html`);
  fs.writeFileSync(file, html);
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 250));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  fs.unlinkSync(file);
  return image.toPNG();
}

// PNG-compressed ICO: a header, one directory entry per size, then the PNG payloads.
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, png }, i) => {
    dir.writeUInt8(size >= 256 ? 0 : size, i * 16);
    dir.writeUInt8(size >= 256 ? 0 : size, i * 16 + 1);
    dir.writeUInt8(0, i * 16 + 2);
    dir.writeUInt8(0, i * 16 + 3);
    dir.writeUInt16LE(1, i * 16 + 4);
    dir.writeUInt16LE(32, i * 16 + 6);
    dir.writeUInt32LE(png.length, i * 16 + 8);
    dir.writeUInt32LE(offset, i * 16 + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

app.whenReady().then(async () => {
  const logo = fs.readFileSync(path.join(root, 'renderer', 'assets', 'logo.png'));
  const logoDataUrl = `data:image/png;base64,${logo.toString('base64')}`;
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(brandDir, { recursive: true });

  const win = new BrowserWindow({ show: false, width: 512, height: 512, transparent: true, frame: false });
  const entries = [];
  for (const size of ICON_SIZES) entries.push({ size, png: await rasterise(win, logoDataUrl, size) });
  win.destroy();

  fs.writeFileSync(path.join(brandDir, 'app-icon-512.png'), entries.find((e) => e.size === 512).png);
  fs.writeFileSync(path.join(brandDir, 'app-icon-256.png'), entries.find((e) => e.size === 256).png);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(entries.filter((e) => e.size <= 256)));
  console.log('rendered', ICON_SIZES.join(', '), '-> app-icon-512.png, app-icon-256.png, build/icon.ico');
  app.quit();
});
