// Turns a TeX engine's output into a list of problems a person can act on.
// Understands two shapes: Tectonic's "error: main.tex:12: message" lines and the classic TeX log,
// where an error starts with "! message" and the next "l.12 ..." line names the line.

const FRIENDLY = [
  [/undefined control sequence/i, 'A command here is not known. Check the spelling, or that the package that defines it is loaded.'],
  [/missing \$ inserted/i, 'Maths is used outside a maths environment. Put it between $ signs, or use \\( and \\).'],
  [/missing \} inserted|extra \}, or forgotten/i, 'A curly bracket is missing or extra. Check that every { has a matching }.'],
  [/runaway argument/i, 'A bracket was opened and never closed, so TeX read on past where you meant to stop.'],
  [/file `?([^'`]+)'? not found|can't find file|cannot find file/i, 'A file this document needs was not found. Check its name and folder.'],
  [/environment (\S+) undefined/i, 'That environment is not defined. A package may be missing.'],
  [/\\begin\{(\S+)\} on input line \d+ ended by \\end\{(\S+)\}/i, 'A \\begin and its \\end do not match.'],
  [/emergency stop|fatal error/i, 'TeX could not continue. Fix the first error above it; the later ones are usually consequences.'],
  [/overfull \\hbox/i, 'A line is too wide for the page. Rephrase, or allow a line break.'],
  [/reference .* undefined|citation .* undefined/i, 'A reference or citation could not be resolved. Compile again, or check the label and the .bib entry.']
];

function friendly(message) {
  for (const [pattern, text] of FRIENDLY) if (pattern.test(message)) return text;
  return '';
}

function parseLog(text, { mainFile = '' } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const problems = [];
  const seen = new Set();
  const add = (severity, file, line, message) => {
    const clean = String(message || '').trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const key = `${severity}|${file || mainFile}|${line}|${clean.replace(/[.\s]+$/, '').toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({ severity, file: file || mainFile || '', line: line || null, message: clean, hint: friendly(clean) });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];

    // Tectonic: "error: main.tex:12: Missing } inserted."
    const t = raw.match(/^(error|warning):\s*(?:(.+?\.(?:tex|sty|cls|bib|bbl)):(\d+):\s*)?(.*)$/i);
    if (t) {
      add(t[1].toLowerCase(), t[2], t[3] ? Number(t[3]) : null, t[4]);
      continue;
    }

    // TeX: "./main.tex:12: Undefined control sequence." (file-line-error style)
    const f = raw.match(/^\.?\/?(.+?\.(?:tex|sty|cls)):(\d+):\s*(.*)$/);
    if (f) {
      add('error', f[1], Number(f[2]), f[3]);
      continue;
    }

    // TeX: "! Undefined control sequence." then a few lines later "l.12 \foo"
    if (raw.startsWith('! ')) {
      const message = raw.slice(2);
      let line = null;
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
        const l = lines[j].match(/^l\.(\d+)\b/);
        if (l) {
          line = Number(l[1]);
          break;
        }
      }
      add('error', '', line, message);
      continue;
    }

    // LaTeX warnings, with the line when it says so.
    const w = raw.match(/^(?:LaTeX|Package \S+|Class \S+) Warning:\s*(.*?)(?: on input line (\d+)\.?)?$/);
    if (w) add('warning', '', w[2] ? Number(w[2]) : null, w[1]);
    const o = raw.match(/^(Overfull|Underfull) \\[hv]box .* at lines? (\d+)/);
    if (o) add('warning', '', Number(o[2]), raw);
  }

  // The engine adds generic lines around a real error ("something bad happened inside XeTeX");
  // they say nothing a person can use, so they go once a specific error has been found.
  const generic = /something bad happened inside XeTeX|the XeTeX engine had an unrecoverable error|^halted/i;
  const specific = problems.some((p) => p.severity === 'error' && !generic.test(p.message));
  return specific ? problems.filter((p) => !(p.severity === 'error' && generic.test(p.message))) : problems;
}

module.exports = { parseLog, friendly };
