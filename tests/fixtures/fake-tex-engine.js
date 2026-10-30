// A stand-in for the TeX engine, used only by tests. Behaviour is chosen by a marker in the main file.
const fs = require('fs');
const path = require('path');
const [main, ...rest] = process.argv.slice(2);
const outdir = rest[rest.indexOf('--outdir') + 1];
const source = fs.readFileSync(main, 'utf8');
fs.mkdirSync(outdir, { recursive: true });
fs.writeFileSync(path.join(outdir, 'args.json'), JSON.stringify({ main, rest, cwd: process.cwd() }));
const pdf = path.join(outdir, path.basename(main).replace(/\.tex$/, '.pdf'));

if (source.includes('%HANG')) {
  setInterval(() => {}, 1000);
} else if (source.includes('%FLOOD')) {
  const line = 'x'.repeat(1000) + '\n';
  for (let i = 0; i < 6000; i += 1) process.stdout.write(line);
  fs.writeFileSync(pdf, '%PDF-fake');
} else if (source.includes('%FAIL')) {
  process.stderr.write('error: main.tex:3: Missing } inserted.\nwarning: main.tex:5: Overfull \\hbox\n');
  process.exit(1);
} else if (source.includes('%NOPDF')) {
  process.exit(0);
} else {
  const delay = source.includes('%SLOW') ? 300 : 0;
  setTimeout(() => {
    fs.writeFileSync(pdf, '%PDF-fake ' + source.length);
    process.exit(0);
  }, delay);
}
