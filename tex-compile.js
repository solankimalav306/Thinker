// ThinkerTex compile service: runs a TeX engine safely and reports the result as data.
//
// The engine is given as { command, args } so the real one (Tectonic) and a test double behave the same.
// Safety rules, all enforced here and not left to the caller:
//   - the main file must be inside the project folder (no absolute paths, no "..")
//   - the engine runs with the project as its working folder and writes only to a separate build folder
//   - hard time limit and output cap; the whole process tree is killed on timeout or cancel
//   - one build per project at a time; a newer request replaces one that is still waiting
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseLog } = require('./tex-log');

const PREPARE_DOCUMENT = [
  '\\documentclass{article}',
  '\\usepackage{amsmath,amssymb,booktabs,graphicx,hyperref,geometry}',
  '\\begin{document}',
  'Thinker is getting ready. $e^{i\\pi}+1=0$',
  '\\end{document}',
  ''
].join('\n');

const DEFAULTS = { timeoutMs: 60000, maxOutputBytes: 2 * 1024 * 1024 };

function insideProject(root, file) {
  if (!file || path.isAbsolute(file) || /^[a-z]:/i.test(file)) return null;
  const full = path.resolve(root, file);
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return full;
}

function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      childProcess.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

function createCompiler(options = {}) {
  const engine = options.engine; // { command, args: [...] }
  const spawn = options.spawn || childProcess.spawn;
  const engineEnv = { ...process.env, ...(options.env || {}) };
  const limits = { ...DEFAULTS, ...(options.limits || {}) };
  const running = new Map(); // projectId -> { child, cancelled }
  const waiting = new Map(); // projectId -> { request, resolve }

  if (!engine || !engine.command) throw new Error('No TeX engine is configured.');

  function buildArgs({ mainFull, buildDir, mode, onlyCached }) {
    const args = [...(engine.args || [])];
    args.push(mainFull, '--outdir', buildDir, '--keep-logs', '--untrusted');
    if (mode === 'full') args.push('--synctex');
    if (onlyCached) args.push('--only-cached');
    return args;
  }

  function run(request) {
    const { projectId, root, mainFile = 'main.tex', buildDir, mode = 'full', onlyCached = false } = request;
    const timeoutMs = request.timeoutMs || limits.timeoutMs;
    const started = Date.now();
    const mainFull = insideProject(root, mainFile);
    const fail = (message) => ({ ok: false, pdfPath: null, problems: [{ severity: 'error', file: mainFile, line: null, message, hint: '' }], durationMs: 0, timedOut: false, cancelled: false, log: '' });
    if (!mainFull) return Promise.resolve(fail('The main file must be inside the project folder.'));
    if (!fs.existsSync(mainFull)) return Promise.resolve(fail(`${mainFile} was not found in the project.`));
    fs.mkdirSync(buildDir, { recursive: true });

    return new Promise((resolve) => {
      const args = buildArgs({ mainFull: path.relative(root, mainFull), buildDir, mode, onlyCached });
      const child = spawn(engine.command, args, { cwd: root, env: engineEnv, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      const state = { child, cancelled: false };
      running.set(projectId, state);

      let output = '';
      let truncated = false;
      let timedOut = false;
      const take = (chunk) => {
        if (output.length >= limits.maxOutputBytes) {
          if (!truncated) { truncated = true; output += '\n[output cut off]\n'; }
          return;
        }
        output += chunk.toString('utf8');
      };
      child.stdout?.on('data', take);
      child.stderr?.on('data', take);

      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);

      const finish = (code, spawnError) => {
        clearTimeout(timer);
        running.delete(projectId);
        const pdfName = path.basename(mainFull).replace(/\.tex$/i, '.pdf');
        const pdfPath = path.join(buildDir, pdfName);
        let log = output;
        const logFile = path.join(buildDir, pdfName.replace(/\.pdf$/i, '.log'));
        try { if (fs.existsSync(logFile)) log += '\n' + fs.readFileSync(logFile, 'utf8').slice(-limits.maxOutputBytes); } catch { /* the console output is enough */ }
        const problems = parseLog(log, { mainFile });
        if (spawnError) problems.unshift({ severity: 'error', file: '', line: null, message: `The TeX engine could not start: ${spawnError.message}`, hint: 'Reinstall Thinker, or pick another engine in Settings.' });
        if (timedOut) problems.unshift({ severity: 'error', file: '', line: null, message: `The build took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`, hint: 'A very large document or a loop in a macro can cause this.' });
        const exists = fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0;
        const ok = code === 0 && !timedOut && !state.cancelled && !spawnError && exists;
        if (!ok && !problems.some((p) => p.severity === 'error') && !state.cancelled) {
          problems.push({ severity: 'error', file: '', line: null, message: 'The build did not produce a PDF.', hint: 'Open the log for details.' });
        }
        resolve({ ok, pdfPath: ok ? pdfPath : null, problems, durationMs: Date.now() - started, timedOut, cancelled: state.cancelled, log });
      };

      child.on('error', (error) => finish(-1, error));
      child.on('close', (code) => finish(code, null));
    });
  }

  // Builds one project at a time. While one runs, only the newest later request is kept; older waiting
  // requests are answered as "superseded" so their callers know to ignore them.
  const busy = new Set();
  const superseded = { ok: false, pdfPath: null, problems: [], durationMs: 0, timedOut: false, cancelled: true, superseded: true, log: '' };

  async function start(request) {
    const id = request.projectId;
    busy.add(id);
    try {
      return await run(request);
    } finally {
      const next = waiting.get(id);
      waiting.delete(id);
      if (next) start(next.request).then(next.resolve);
      else busy.delete(id);
    }
  }

  function compile(request) {
    const id = request.projectId;
    if (!id) return Promise.reject(new Error('A build needs a project id.'));
    if (!busy.has(id)) return start(request);
    return new Promise((resolve) => {
      waiting.get(id)?.resolve(superseded);
      waiting.set(id, { request, resolve });
    });
  }

  function cancel(projectId) {
    const state = running.get(projectId);
    waiting.get(projectId)?.resolve(superseded);
    waiting.delete(projectId);
    if (!state) return false;
    state.cancelled = true;
    killTree(state.child);
    return true;
  }

  // The engine fetches the packages it needs from the internet the first time, which can take minutes.
  // This compiles a small document that uses the common packages, with a long limit, so that later
  // builds are quick and can run offline.
  async function prepare({ root, buildDir, timeoutMs = 10 * 60 * 1000 }) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'main.tex'), PREPARE_DOCUMENT);
    return compile({ projectId: '__prepare__', root, buildDir, mainFile: 'main.tex', timeoutMs });
  }

  return { compile, prepare, cancel, isBuilding: (id) => running.has(id), insideProject };
}

module.exports = { createCompiler, insideProject, killTree };
