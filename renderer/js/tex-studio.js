// ThinkerTex: the project list and the studio (files, editor, compile, live preview, problems).
// The code editor is CodeMirror (bundled); the visual editor and the agent plug in from their own modules.
import { PdfController } from "./pdf-controller.js";

const BS = String.fromCharCode(92);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(label, className, icon, onClick, title) {
  const b = el("button", className);
  b.type = "button";
  if (icon) {
    b.append(el("i", `fa-solid ${icon}`));
    if (label) b.append(document.createTextNode(` ${label}`));
  } else {
    b.textContent = label;
  }
  if (title) { b.title = title; b.setAttribute("aria-label", title); }
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

// Every tex call answers { ok, value } or { ok: false, error }; this turns a failure into a thrown error.
async function call(promise) {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const debounce = (fn, ms) => {
  let timer = null;
  const wrapped = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.flush = (...args) => { clearTimeout(timer); return fn(...args); };
  return wrapped;
};

// Section outline from the text: [{ level, title, line }]
export function outlineOf(text) {
  const out = [];
  const lines = String(text || "").split("\n");
  const rx = /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\{(.*)\}/;
  lines.forEach((line, i) => {
    const m = rx.exec(line);
    if (!m) return;
    const level = { part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3 }[m[1]];
    out.push({ level, title: m[2].replace(/\\[A-Za-z]+\*?\{?|[{}]/g, "").trim() || m[1], line: i + 1 });
  });
  return out;
}

export function createTexStudio(deps) {
  const { container, api = window.electronAPI, setStatus, go, getSpaces } = deps;
  const tex = api.tex;

  const state = {
    view: "home",
    project: null,
    files: [],
    spaces: [],
    path: null,
    buffers: new Map(), // path -> { text, saved }
    mode: "code",
    auto: true,
    problems: [],
    log: "",
    compiling: false,
    lastOk: null,
    engine: { found: true, prepared: true },
    settingUp: false,
    pdfLoaded: false
  };

  let code = null; // the code editor
  let visual = null; // the visual editor
  let agent = null; // the ThinkerTex agent panel
  let preview = null; // { controller, ... }
  let dom = {};
  let stopProgress = null;

  const currentBuffer = () => state.buffers.get(state.path);

  // ================================================================================== home
  async function showHome() {
    state.view = "home";
    await flushAll();
    go();
    container.textContent = "";
    const page = el("div", "tex-home");
    const head = el("header", "tex-home-head");
    const title = el("div");
    title.append(el("p", "home-eyebrow", "Write"), el("h1", "space-title", "ThinkerTex"),
      el("p", "space-sub", "Write LaTeX with a live PDF preview, in a code view or a normal writing view, with an AI that writes and compiles for you."));
    head.append(title);
    page.append(head);

    dom.homeBanner = el("div", "tex-banner-slot");
    page.append(dom.homeBanner);

    const actions = el("div", "tex-home-actions");
    actions.append(
      btn("New project", "btn primary lg", "fa-plus", () => showNewProject()),
      btn("Open a folder", "btn lg", "fa-folder-open", () => openExisting("folder")),
      btn("Open a .tex file", "btn lg", "fa-file-lines", () => openExisting("file"))
    );
    page.append(actions);

    dom.newPanel = el("div", "tex-new-panel");
    dom.newPanel.hidden = true;
    page.append(dom.newPanel);

    const listSection = el("section", "space-section");
    const listHead = el("div", "card-head");
    listHead.append(el("h3", "", "Your LaTeX projects"));
    listSection.append(listHead);
    dom.projectList = el("ul", "space-list");
    listSection.append(dom.projectList);
    page.append(listSection);
    container.append(page);

    refreshEngineBanner(dom.homeBanner);
    await renderProjectList();
  }

  async function renderProjectList() {
    const list = await call(tex.projects());
    dom.projectList.textContent = "";
    if (!list.length) {
      dom.projectList.append(el("li", "space-list-empty", "No projects yet. Start one from a template, or open a folder you already have."));
      return;
    }
    for (const project of list) {
      const li = el("li", "space-row");
      const icon = el("span", "space-row-icon tex");
      icon.append(el("i", "fa-solid fa-pen-nib"));
      const text = el("span", "space-row-text");
      text.append(el("strong", "", project.name), el("small", "", project.missing ? "Folder not found: " + project.rootPath : project.rootPath));
      const open = btn("Open", "btn", "fa-pen-to-square", () => openProject(project.id), `Open ${project.name}`);
      open.disabled = project.missing;
      const forget = btn("", "btn icon-btn", "fa-xmark", async () => {
        await call(tex.forget(project.id));
        setStatus(`${project.name} removed from this list. Its files were not deleted.`);
        renderProjectList();
      }, `Remove ${project.name} from this list (keeps the files)`);
      li.append(icon, text, open, forget);
      dom.projectList.append(li);
    }
  }

  async function showNewProject(workspaceId = null) {
    if (state.view !== "home" || !dom.newPanel || !container.contains(dom.newPanel)) await showHome();
    const templates = await call(tex.templates());
    const panel = dom.newPanel;
    panel.hidden = false;
    panel.textContent = "";
    panel.append(el("h3", "", "New LaTeX project"));
    const name = el("input", "tex-name-input");
    name.type = "text";
    name.placeholder = "Project name";
    name.maxLength = 80;
    name.value = "Untitled paper";
    name.setAttribute("aria-label", "Project name");
    panel.append(name);

    let chosen = "article";
    const grid = el("div", "tex-template-grid");
    templates.forEach((t) => {
      const card = el("button", "tex-template" + (t.id === chosen ? " selected" : ""));
      card.type = "button";
      card.append(el("strong", "", t.label), el("span", "", t.description));
      card.addEventListener("click", () => {
        chosen = t.id;
        grid.querySelectorAll(".tex-template").forEach((c) => c.classList.toggle("selected", c === card));
      });
      grid.append(card);
    });
    panel.append(grid);

    let targetSpace = workspaceId;
    const spaces = await api.listWorkspaces();
    if (spaces.length) {
      const row = el("label", "tex-space-pick", "Put it in a Thinkspace (optional) ");
      const select = el("select");
      select.append(new Option("None: keep it on its own", ""));
      spaces.forEach((s) => select.append(new Option(s.name, s.id)));
      select.value = workspaceId || "";
      select.addEventListener("change", () => { targetSpace = select.value || null; });
      row.append(select);
      panel.append(row);
    }

    const actions = el("div", "tex-new-actions");
    const create = btn("Create project", "btn primary", "fa-check", async () => {
      create.disabled = true;
      try {
        const project = await call(tex.create({ name: name.value.trim() || "Untitled paper", template: chosen, workspaceId: targetSpace }));
        setStatus("Project created.");
        await openProject(project.id);
      } catch (error) {
        setStatus(error.message);
        create.disabled = false;
      }
    });
    actions.append(create, btn("Cancel", "btn", "", () => { panel.hidden = true; }));
    panel.append(actions);
    name.focus();
    name.select();
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") create.click(); if (e.key === "Escape") panel.hidden = true; });
  }

  async function openExisting(kind) {
    try {
      const project = await call(kind === "folder" ? tex.openFolder() : tex.openFile());
      if (project) await openProject(project.id);
    } catch (error) {
      setStatus(error.message);
    }
  }

  // ================================================================================== engine
  async function refreshEngine() {
    try { state.engine = await call(tex.engine()); } catch { state.engine = { found: false, prepared: false }; }
    return state.engine;
  }

  async function refreshEngineBanner(slot) {
    const engine = await refreshEngine();
    slot.textContent = "";
    if (!engine.found) {
      const b = el("div", "tex-banner warn");
      b.append(el("i", "fa-solid fa-triangle-exclamation"), el("span", "", "The ThinkerTex compiler is not part of this build, so documents cannot be compiled. You can still write and use the AI."));
      slot.append(b);
      return;
    }
    if (!engine.prepared) {
      const b = el("div", "tex-banner");
      const text = el("span", "", state.settingUp ? "Setting up ThinkerTex… this takes a few minutes the first time." : "One-time setup: ThinkerTex downloads the LaTeX packages it needs (about 40 MB). After that it works offline.");
      const button = btn(state.settingUp ? "Setting up…" : "Set up now", "btn primary", "fa-download", () => runSetup(slot), "Download the LaTeX packages");
      button.disabled = state.settingUp;
      b.append(el("i", "fa-solid fa-circle-info"), text, button);
      slot.append(b);
    }
  }

  async function runSetup(slot) {
    if (state.settingUp) return false;
    state.settingUp = true;
    setStatus("Setting up ThinkerTex…");
    stopProgress?.();
    stopProgress = tex.onSetupProgress(({ seconds }) => {
      const label = slot?.querySelector(".tex-banner span");
      if (label) label.textContent = `Setting up ThinkerTex… ${seconds}s. This takes a few minutes the first time, and you can keep writing.`;
    });
    refreshEngineBanner(slot);
    try {
      const result = await call(tex.setup());
      state.settingUp = false;
      stopProgress?.();
      if (result.ok) {
        setStatus(`ThinkerTex is ready (set up in ${result.seconds}s).`);
        await refreshEngineBanner(slot);
        return true;
      }
      setStatus("Setup did not finish: " + (result.problems[0]?.message || "unknown problem") + ". Check your internet connection and try again.");
    } catch (error) {
      setStatus(error.message);
      state.settingUp = false;
      stopProgress?.();
    }
    await refreshEngineBanner(slot);
    return false;
  }

  // ================================================================================== studio
  async function openProject(id) {
    try {
      await flushAll();
      const opened = await call(tex.open(id));
      state.project = opened.project;
      state.files = opened.files;
      state.spaces = opened.spaces;
      state.buffers = new Map();
      state.problems = [];
      state.log = "";
      state.lastOk = null;
      state.pdfLoaded = false;
      state.view = "studio";
      go();
      buildStudioDom();
      renderTree();
      await openFile(state.project.mainFile || "main.tex");
      refreshEngineBanner(dom.studioBanner);
      loadExistingPdf();
    } catch (error) {
      setStatus(error.message);
      showHome();
    }
  }

  function buildStudioDom() {
    container.textContent = "";
    dom = {};
    const studio = el("div", "tex-studio");
    dom.studio = studio;

    // ---- top bar
    const bar = el("div", "tex-bar");
    const left = el("div", "tex-bar-group");
    left.append(btn("Projects", "btn tex-back", "fa-chevron-left", () => showHome(), "Back to your projects"));
    dom.title = el("span", "tex-title", state.project.name);
    left.append(dom.title);
    if (state.spaces.length) {
      const chip = el("span", "tex-chip", state.spaces.map((s) => s.name).join(", "));
      chip.title = "Linked Thinkspaces";
      left.append(chip);
    }

    const mid = el("div", "tex-bar-group");
    dom.modeCode = btn("Code", "tex-seg active", "fa-code", () => setMode("code"), "Edit the LaTeX source");
    dom.modeVisual = btn("Visual", "tex-seg", "fa-feather-pointed", () => setMode("visual"), "Edit like a normal document");
    const seg = el("div", "tex-segment");
    seg.append(dom.modeCode, dom.modeVisual);
    mid.append(seg);

    const right = el("div", "tex-bar-group");
    dom.compileBtn = btn("Recompile", "btn primary", "fa-play", () => compile({ manual: true }), "Compile (Ctrl+Enter)");
    dom.status = el("span", "tex-status", "Not compiled yet");
    dom.status.setAttribute("aria-live", "polite");
    const autoLabel = el("label", "tex-auto");
    dom.autoBox = el("input");
    dom.autoBox.type = "checkbox";
    dom.autoBox.checked = state.auto;
    dom.autoBox.addEventListener("change", () => { state.auto = dom.autoBox.checked; });
    autoLabel.append(dom.autoBox, document.createTextNode(" Auto"));
    autoLabel.title = "Compile a moment after you stop typing";
    dom.exportBtn = btn("", "btn icon-btn", "fa-download", exportPdf, "Download the PDF");
    dom.agentBtn = btn("Ask AI", "btn", "fa-wand-magic-sparkles", () => showRightTab("agent"), "Ask ThinkerTex to write, edit or fix");
    right.append(dom.status, autoLabel, dom.compileBtn, dom.exportBtn, dom.agentBtn);
    bar.append(left, mid, right);

    dom.studioBanner = el("div", "tex-banner-slot");

    // ---- body
    const body = el("div", "tex-body");

    const side = el("aside", "tex-side");
    const sideHead = el("div", "tex-side-head");
    sideHead.append(el("strong", "", "Files"),
      btn("", "btn icon-btn", "fa-file-circle-plus", () => addFile(), "New file"),
      btn("", "btn icon-btn", "fa-folder-plus", () => addFolder(), "New folder"),
      btn("", "btn icon-btn", "fa-image", () => importImages(), "Add images"));
    dom.tree = el("div", "tex-tree");
    dom.tree.setAttribute("role", "tree");
    const outlineHead = el("div", "tex-side-head");
    outlineHead.append(el("strong", "", "Outline"));
    dom.outline = el("div", "tex-outline");
    side.append(sideHead, dom.tree, outlineHead, dom.outline);

    const edit = el("section", "tex-edit");
    dom.tabs = el("div", "tex-file-tabs");
    dom.codeMount = el("div", "tex-code");
    dom.visualMount = el("div", "tex-visual");
    dom.visualMount.hidden = true;
    dom.cursor = el("div", "tex-cursor", "");
    edit.append(dom.tabs, dom.codeMount, dom.visualMount, dom.cursor);

    const rightPane = el("section", "tex-right");
    const tabs = el("div", "tex-right-tabs");
    dom.tabPreview = btn("Preview", "tex-tab active", "fa-file-pdf", () => showRightTab("preview"));
    dom.tabAgent = btn("Ask ThinkerTex", "tex-tab", "fa-wand-magic-sparkles", () => showRightTab("agent"));
    tabs.append(dom.tabPreview, dom.tabAgent);
    dom.previewMount = el("div", "tex-preview");
    dom.agentMount = el("div", "tex-agent");
    dom.agentMount.hidden = true;
    rightPane.append(tabs, dom.previewMount, dom.agentMount);

    body.append(side, makeResizer("--tex-side-width", side, false), edit, makeResizer("--tex-right-width", rightPane, true), rightPane);

    // ---- problems strip
    const problems = el("section", "tex-problems");
    const probHead = el("div", "tex-problems-head");
    dom.problemTabs = [
      btn("Problems", "tex-tab active", "", () => showProblemsTab("problems")),
      btn("Log", "tex-tab", "", () => showProblemsTab("log"))
    ];
    dom.fixBtn = btn("Fix with AI", "btn", "fa-wand-magic-sparkles", () => fixWithAi(), "Ask ThinkerTex to fix these errors");
    dom.fixBtn.hidden = true;
    dom.problemToggle = btn("", "btn icon-btn", "fa-chevron-down", () => problems.classList.toggle("collapsed"), "Show or hide");
    probHead.append(...dom.problemTabs, el("span", "tex-spacer"), dom.fixBtn, dom.problemToggle);
    dom.problemList = el("ul", "tex-problem-list");
    dom.logView = el("pre", "tex-log");
    dom.logView.hidden = true;
    problems.append(probHead, dom.problemList, dom.logView);
    dom.problemsEl = problems;

    studio.append(bar, dom.studioBanner, body, problems);
    container.append(studio);

    mountEditors();
    mountPreview();
    mountAgent();
    renderProblems();
  }

  // Drag handle between panes. The width lives in a CSS variable on the studio.
  function makeResizer(variable, pane, fromRight) {
    const handle = el("div", "tex-resizer");
    handle.setAttribute("role", "separator");
    handle.tabIndex = 0;
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = pane.getBoundingClientRect().width;
      const move = (e) => {
        const delta = fromRight ? startX - e.clientX : e.clientX - startX;
        const next = Math.max(180, Math.min(startWidth + delta, window.innerWidth * 0.6));
        dom.studio.style.setProperty(variable, `${Math.round(next)}px`);
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    return handle;
  }

  // ---------------------------------------------------------------------------- files and tree
  function renderTree() {
    dom.tree.textContent = "";
    if (!state.files.length) {
      dom.tree.append(el("p", "tex-side-empty", "No files yet."));
      return;
    }
    state.files.forEach((file) => {
      const depth = file.path.split("/").length - 1;
      const row = el("div", "tex-tree-row" + (file.path === state.path ? " active" : ""));
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.setAttribute("role", "treeitem");
      const name = file.path.split("/").pop();
      const icon = file.type === "dir" ? "fa-folder" : file.type === "image" ? "fa-image" : file.path === state.project.mainFile ? "fa-file-code" : "fa-file-lines";
      row.append(el("i", `fa-regular ${icon}`), el("span", "tex-tree-name", name));
      if (file.path === state.project.mainFile) row.append(el("small", "tex-main-badge", "main"));
      row.title = file.path;
      if (file.type === "text") row.addEventListener("click", () => openFile(file.path));
      if (file.type === "image") row.addEventListener("dblclick", () => insertImage(file.path));
      const actions = el("span", "tex-tree-actions");
      if (file.type === "text" && file.path !== state.project.mainFile && /\.tex$/i.test(file.path)) {
        actions.append(btn("", "tex-mini", "fa-star", () => setMain(file.path), `Make ${name} the main file`));
      }
      actions.append(btn("", "tex-mini", "fa-pen", () => renameFile(file), `Rename ${name}`), btn("", "tex-mini", "fa-trash", () => deleteFile(file), `Delete ${name}`));
      row.append(actions);
      dom.tree.append(row);
    });
  }

  async function refreshFiles() {
    state.files = await call(tex.files(state.project.id));
    renderTree();
  }

  async function openFile(path) {
    if (state.path === path && currentBuffer()) return;
    await flushCurrent();
    try {
      if (!state.buffers.has(path)) {
        const text = await call(tex.read(state.project.id, path));
        state.buffers.set(path, { text, saved: text });
      }
    } catch (error) {
      setStatus(error.message);
      return;
    }
    state.path = path;
    const buffer = currentBuffer();
    code?.reset(buffer.text);
    applyProblemsToEditor();
    if (state.mode === "visual") renderVisual();
    updateModeAvailability();
    renderTabs();
    renderTree();
    renderOutline();
  }

  function renderTabs() {
    dom.tabs.textContent = "";
    const paths = [...state.buffers.keys()];
    for (const path of paths) {
      const buffer = state.buffers.get(path);
      const tab = el("div", "tex-file-tab" + (path === state.path ? " active" : ""));
      tab.append(el("span", "", path.split("/").pop() + (buffer.text !== buffer.saved ? " •" : "")));
      tab.title = path;
      tab.addEventListener("click", () => openFile(path));
      if (paths.length > 1) {
        tab.append(btn("", "tex-mini", "fa-xmark", (e) => { e.stopPropagation(); closeTab(path); }, `Close ${path}`));
      }
      dom.tabs.append(tab);
    }
  }

  async function closeTab(path) {
    await saveBuffer(path);
    state.buffers.delete(path);
    if (state.path === path) {
      state.path = null;
      const next = [...state.buffers.keys()].pop() || state.project.mainFile;
      await openFile(next);
    } else renderTabs();
  }

  async function addFile() {
    inlineAsk("New file name", "chapter2.tex", async (value) => {
      const path = /\.[a-z]+$/i.test(value) ? value : `${value}.tex`;
      await call(tex.newFile(state.project.id, path, ""));
      await refreshFiles();
      await openFile(path);
    });
  }

  function addFolder() {
    inlineAsk("New folder name", "figures", async (value) => {
      await call(tex.newFolder(state.project.id, value));
      await refreshFiles();
    });
  }

  function renameFile(file) {
    inlineAsk(`Rename ${file.path}`, file.path, async (value) => {
      await flushAll();
      await call(tex.renameFile(state.project.id, file.path, value));
      if (state.buffers.has(file.path)) {
        const buffer = state.buffers.get(file.path);
        state.buffers.delete(file.path);
        state.buffers.set(value, buffer);
        if (state.path === file.path) state.path = value;
      }
      if (state.project.mainFile === file.path) state.project = await call(tex.setMain(state.project.id, value));
      await refreshFiles();
      renderTabs();
    });
  }

  function deleteFile(file) {
    inlineAsk(`Move ${file.path} to the Recycle Bin? Type yes to confirm`, "", async (value) => {
      if (value.trim().toLowerCase() !== "yes") return;
      await call(tex.deleteFile(state.project.id, file.path));
      state.buffers.delete(file.path);
      if (state.path === file.path) { state.path = null; await openFile(state.project.mainFile); }
      await refreshFiles();
      renderTabs();
    });
  }

  async function setMain(path) {
    state.project = await call(tex.setMain(state.project.id, path));
    setStatus(`${path} is now the main file.`);
    renderTree();
  }

  async function importImages() {
    try {
      const added = await call(tex.importFiles(state.project.id, "figures"));
      if (added.length) {
        await refreshFiles();
        setStatus(`${added.length} file${added.length === 1 ? "" : "s"} added. Double-click an image to insert it.`);
      }
    } catch (error) { setStatus(error.message); }
  }

  function insertImage(path) {
    const snippet = `${BS}begin{figure}[h]\n${BS}centering\n${BS}includegraphics[width=0.8${BS}linewidth]{${path}}\n${BS}caption{Describe this figure.}\n${BS}end{figure}\n`;
    if (state.mode === "code" && code) { code.insertAtCursor(snippet); code.focus(); } else setStatus("Switch to Code to insert it at the cursor.");
  }

  // A small inline question bar (the app has no window.prompt).
  function inlineAsk(label, initial, onDone) {
    dom.studio.querySelector(".tex-ask")?.remove();
    const bar = el("form", "tex-ask");
    const input = el("input");
    input.type = "text";
    input.value = initial;
    input.setAttribute("aria-label", label);
    bar.append(el("span", "", label), input, btn("OK", "btn primary", "", null), btn("Cancel", "btn", "", () => bar.remove()));
    bar.querySelector(".btn.primary").type = "submit";
    bar.addEventListener("submit", async (e) => {
      e.preventDefault();
      const value = input.value.trim();
      bar.remove();
      if (!value) return;
      try { await onDone(value); } catch (error) { setStatus(error.message); }
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") bar.remove(); });
    dom.studio.insertBefore(bar, dom.studio.querySelector(".tex-body"));
    input.focus();
    input.select();
  }

  // ---------------------------------------------------------------------------- editors
  async function mountEditors() {
    const { createCodeEditor } = await import("../vendor/code-editor/code-editor.js");
    code = createCodeEditor(dom.codeMount, {
      doc: currentBuffer()?.text || "",
      placeholder: "Write LaTeX here…",
      onChange: (text) => onText(text, "code"),
      onSave: () => flushAll().then(() => setStatus("Saved.")),
      onCompile: () => compile({ manual: true }),
      onCursor: ({ line, column }) => { dom.cursor.textContent = `Line ${line}, column ${column}`; }
    });
    code.reset(currentBuffer()?.text || "");
    applyProblemsToEditor();
  }

  function onText(text, from) {
    const buffer = currentBuffer();
    if (!buffer) return;
    buffer.text = text;
    if (from !== "code" && code) code.setValue(text);
    scheduleSave();
    renderOutline();
    updateModeAvailability();
    dom.tabs.querySelector(".tex-file-tab.active span") && renderTabs();
    if (state.auto && !state.compiling) scheduleAutoCompile();
  }

  const scheduleSave = debounce(() => saveBuffer(state.path), 900);
  const scheduleAutoCompile = debounce(() => compile({ manual: false }), 1800);

  async function saveBuffer(path) {
    const buffer = state.buffers.get(path);
    if (!buffer || buffer.text === buffer.saved || !state.project) return;
    const text = buffer.text;
    try {
      await call(tex.write(state.project.id, path, text));
      buffer.saved = text;
      renderTabs();
    } catch (error) {
      setStatus("Could not save " + path + ": " + error.message);
    }
  }

  async function flushCurrent() {
    scheduleSave.cancel();
    if (state.path) await saveBuffer(state.path);
  }

  async function flushAll() {
    scheduleSave.cancel();
    scheduleAutoCompile.cancel();
    for (const path of state.buffers.keys()) await saveBuffer(path);
  }

  function setMode(mode) {
    if (mode === "visual" && !visualAvailable().ok) { setStatus(visualAvailable().reason); return; }
    state.mode = mode;
    dom.modeCode.classList.toggle("active", mode === "code");
    dom.modeVisual.classList.toggle("active", mode === "visual");
    dom.codeMount.hidden = mode !== "code";
    dom.visualMount.hidden = mode !== "visual";
    if (mode === "visual") renderVisual();
    else {
      code?.setValue(currentBuffer()?.text || "");
      code?.focus();
    }
  }

  function visualAvailable() {
    const buffer = currentBuffer();
    if (!buffer || !/\.tex$/i.test(state.path || "")) return { ok: false, reason: "The visual view is for .tex documents." };
    if (!/\\begin\{document\}/.test(buffer.text)) return { ok: false, reason: "Open the main document to use the visual view. This file is a part of a larger one." };
    return { ok: true };
  }

  function updateModeAvailability() {
    const a = visualAvailable();
    dom.modeVisual.disabled = !a.ok;
    dom.modeVisual.title = a.ok ? "Edit like a normal document" : a.reason;
    if (!a.ok && state.mode === "visual") setMode("code");
  }

  async function renderVisual() {
    try {
      if (!visual) {
        const { createVisualEditor } = await import("./visual-editor.js");
        visual = createVisualEditor(dom.visualMount, {
          onChange: (text) => onText(text, "visual"),
          onSave: () => flushAll().then(() => setStatus("Saved.")),
          onCompile: () => compile({ manual: true }),
          getCitationKeys: () => citationKeys(),
          setStatus
        });
      }
      visual.setText(currentBuffer()?.text || "");
    } catch (error) {
      setStatus("The visual view could not start: " + error.message);
      setMode("code");
    }
  }

  function citationKeys() {
    const keys = [];
    for (const [path, buffer] of state.buffers) {
      if (!/\.bib$/i.test(path)) continue;
      for (const m of buffer.text.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)) keys.push(m[1]);
    }
    return keys;
  }

  function renderOutline() {
    const buffer = currentBuffer();
    dom.outline.textContent = "";
    const items = outlineOf(buffer?.text);
    if (!items.length) { dom.outline.append(el("p", "tex-side-empty", "Sections appear here.")); return; }
    for (const item of items) {
      const row = el("button", "tex-outline-row");
      row.type = "button";
      row.style.paddingLeft = `${8 + item.level * 12}px`;
      row.textContent = item.title;
      row.title = `Line ${item.line}`;
      row.addEventListener("click", () => {
        if (state.mode === "code") code?.goToLine(item.line);
        else visual?.scrollToHeading?.(item.title);
      });
      dom.outline.append(row);
    }
  }

  // ---------------------------------------------------------------------------- compile and problems
  async function compile({ manual }) {
    if (state.compiling) {
      if (manual) await call(tex.cancel(state.project.id)).catch(() => {});
      else return;
    }
    scheduleAutoCompile.cancel();
    await flushAll();
    const engine = await refreshEngine();
    if (!engine.found) { setStatus("The ThinkerTex compiler is not part of this build."); return; }
    if (!engine.prepared) {
      if (!manual) return;
      const ok = await runSetup(dom.studioBanner);
      if (!ok) return;
    }
    state.compiling = true;
    dom.compileBtn.disabled = false;
    dom.compileBtn.classList.add("busy");
    dom.status.textContent = "Compiling…";
    try {
      const result = await call(tex.compile(state.project.id, { draft: !manual }));
      if (result.superseded) return;
      if (result.notReady) { await refreshEngineBanner(dom.studioBanner); return; }
      state.problems = result.problems || [];
      state.log = result.log || "";
      state.lastOk = Boolean(result.ok);
      if (result.cancelled) { dom.status.textContent = "Stopped"; return; }
      dom.status.textContent = result.ok ? `Compiled in ${(result.durationMs / 1000).toFixed(1)} s` : `${state.problems.filter((p) => p.severity === "error").length} error(s)`;
      dom.status.classList.toggle("bad", !result.ok);
      if (result.ok) await loadPreview();
      renderProblems();
      applyProblemsToEditor();
      if (!result.ok && state.problems.some((p) => p.severity === "error")) dom.problemsEl.classList.remove("collapsed");
    } catch (error) {
      dom.status.textContent = "Compile failed";
      setStatus(error.message);
    } finally {
      state.compiling = false;
      dom.compileBtn.classList.remove("busy");
    }
  }

  function renderProblems() {
    const errors = state.problems.filter((p) => p.severity === "error");
    const warnings = state.problems.filter((p) => p.severity !== "error");
    dom.problemTabs[0].textContent = `Problems${state.problems.length ? ` (${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}`;
    dom.problemList.textContent = "";
    dom.fixBtn.hidden = errors.length === 0;
    if (!state.problems.length) {
      dom.problemList.append(el("li", "tex-problem-empty", state.lastOk === null ? "Compile to see problems here." : "No problems. Nice."));
    }
    for (const p of state.problems) {
      const li = el("li", `tex-problem ${p.severity}`);
      li.append(el("i", `fa-solid ${p.severity === "error" ? "fa-circle-xmark" : "fa-triangle-exclamation"}`));
      const body = el("span", "tex-problem-text");
      body.append(el("strong", "", p.message));
      if (p.hint) body.append(el("small", "", p.hint));
      li.append(body);
      const where = el("button", "tex-problem-where", p.line ? `${p.file || state.project.mainFile}:${p.line}` : p.file || "");
      where.type = "button";
      where.addEventListener("click", async () => {
        const file = p.file || state.project.mainFile;
        if (state.buffers.has(file) || state.files.some((f) => f.path === file)) await openFile(file);
        setMode("code");
        if (p.line) code?.goToLine(p.line);
      });
      li.append(where);
      dom.problemList.append(li);
    }
    dom.logView.textContent = state.log || "No log yet.";
  }

  function showProblemsTab(which) {
    dom.problemTabs[0].classList.toggle("active", which === "problems");
    dom.problemTabs[1].classList.toggle("active", which === "log");
    dom.problemList.hidden = which !== "problems";
    dom.logView.hidden = which !== "log";
  }

  function applyProblemsToEditor() {
    if (!code) return;
    const here = state.problems.filter((p) => (p.file || state.project.mainFile) === state.path);
    code.setProblems(here);
  }

  // ---------------------------------------------------------------------------- preview
  function mountPreview() {
    const host = dom.previewMount;
    host.textContent = "";
    const toolbar = el("div", "tex-preview-bar");
    const prev = btn("", "btn icon-btn", "fa-arrow-left", null, "Previous page");
    const next = btn("", "btn icon-btn", "fa-arrow-right", null, "Next page");
    const pageInfo = el("span", "page-info");
    const pageNum = el("span", "", "0");
    const pageCount = el("span", "", "0");
    pageInfo.append(document.createTextNode("Page "), pageNum, document.createTextNode(" of "), pageCount);
    const zoomOut = btn("", "btn icon-btn", "fa-magnifying-glass-minus", null, "Zoom out");
    const zoomInput = el("input", "tex-zoom");
    zoomInput.type = "text";
    zoomInput.value = "100%";
    zoomInput.setAttribute("aria-label", "Zoom");
    const zoomIn = btn("", "btn icon-btn", "fa-magnifying-glass-plus", null, "Zoom in");
    const fit = el("select", "fit-select");
    fit.setAttribute("aria-label", "Fit");
    fit.append(new Option("Fit: Width", "auto"), new Option("Fit: Actual", "actual"));
    toolbar.append(prev, next, pageInfo, el("span", "tex-spacer"), zoomOut, zoomInput, zoomIn, fit);

    const stage = el("div", "pdf-stage tex-preview-stage");
    stage.tabIndex = 0;
    const empty = el("div", "tex-preview-empty");
    empty.append(el("i", "fa-regular fa-file-pdf"), el("p", "", "Your PDF appears here after you compile."), btn("Compile now", "btn primary", "fa-play", () => compile({ manual: true })));
    dom.previewEmpty = empty;
    const pdfContainer = el("div", "pdf-container");
    const viewer = el("div", "pdf-viewer");
    const canvas = document.createElement("canvas");
    const textLayer = el("div", "textLayer");
    viewer.append(canvas, textLayer);
    const multi = el("div", "pdf-multi-view");
    pdfContainer.append(viewer, multi);
    stage.append(empty, pdfContainer);
    host.append(toolbar, stage);

    const controller = new PdfController({
      canvas, textLayerDiv: textLayer, pdfViewer: viewer, multiView: multi,
      pageNumEl: pageNum, pageCountEl: pageCount, zoomInput, fitModeSelect: fit, stageElement: stage,
      prevBtn: prev, nextBtn: next, outlineList: el("div"), thumbnailList: el("div"), storagePath: "",
      onStatus() {}, onPathChange() {}, onRendered() {}, onViewChange() {},
      onLoadError: () => setStatus("The preview could not open the compiled PDF.")
    });
    controller.viewMode = "scroll";
    prev.addEventListener("click", () => controller.prevPage());
    next.addEventListener("click", () => controller.nextPage());
    zoomIn.addEventListener("click", () => controller.zoomBy(1.1));
    zoomOut.addEventListener("click", () => controller.zoomBy(1 / 1.1));
    zoomInput.addEventListener("change", () => controller.setScaleFromInput(zoomInput.value));
    stage.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); controller.zoomBy(1.1); }
      if (e.key === "-") { e.preventDefault(); controller.zoomBy(1 / 1.1); }
      if (e.key === "0") { e.preventDefault(); controller.fitToWidth(); }
    });
    preview = { controller, stage };
  }

  async function loadPreview() {
    const bytes = await call(tex.pdf(state.project.id));
    if (!bytes) return;
    dom.previewEmpty.hidden = true;
    const c = preview.controller;
    if (c.hasDocument()) c.captureViewPosition();
    const view = c.hasDocument() ? c.getViewState() : { pageNum: 1, viewMode: "scroll" };
    const ok = await c.load(`thinkertex:${state.project.id}`, { ...view, viewMode: "scroll" }, { data: new Uint8Array(bytes), light: true, keepPosition: true });
    state.pdfLoaded = ok;
  }

  async function loadExistingPdf() {
    try { await loadPreview(); } catch { /* nothing built yet */ }
  }

  async function exportPdf() {
    try {
      const saved = await call(tex.exportPdf(state.project.id));
      if (saved) setStatus(`PDF saved to ${saved}`);
    } catch (error) { setStatus(error.message); }
  }

  // ---------------------------------------------------------------------------- the agent
  async function mountAgent() {
    try {
      const { createTexAgent } = await import("./tex-agent.js");
      agent = createTexAgent(dom.agentMount, {
        getContext: () => ({
          project: state.project,
          path: state.path,
          files: state.files,
          text: currentBuffer()?.text || "",
          selection: state.mode === "code" ? code?.getSelection() : null,
          problems: state.problems,
          log: state.log,
          mainFile: state.project.mainFile,
          readFile: async (path) => (state.buffers.get(path)?.text ?? (await call(tex.read(state.project.id, path)))),
          spaceId: state.spaces[0]?.id || null
        }),
        applyEdits: (path, edits) => applyAgentEdits(path, edits),
        setFileText: (path, text) => setFileText(path, text),
        tryChange: (overlay) => call(tex.tryChange(state.project.id, overlay)),
        setStatus
      });
    } catch (error) {
      dom.agentMount.append(el("p", "tex-side-empty", "The AI panel is not available yet."));
    }
  }

  async function applyAgentEdits(path, edits) {
    if (path !== state.path) await openFile(path);
    if (state.mode === "visual") setMode("code");
    code.applyEdits(edits);
  }

  async function setFileText(path, text) {
    if (path === state.path) {
      if (state.mode === "visual") setMode("code");
      code.applyEdits([{ from: 0, to: code.getValue().length, insert: text }]);
      return;
    }
    const exists = state.files.some((f) => f.path === path);
    if (!exists) { await call(tex.newFile(state.project.id, path, text)); await refreshFiles(); }
    else await call(tex.write(state.project.id, path, text));
    state.buffers.set(path, { text, saved: text });
    renderTabs();
  }

  function fixWithAi() {
    showRightTab("agent");
    agent?.fixErrors?.();
  }

  function showRightTab(which) {
    const isAgent = which === "agent";
    dom.previewMount.hidden = isAgent;
    dom.agentMount.hidden = !isAgent;
    dom.tabPreview.classList.toggle("active", !isAgent);
    dom.tabAgent.classList.toggle("active", isAgent);
    if (isAgent) agent?.focus?.();
  }

  return {
    showHome,
    // Back to where you were: the open project if there is one, otherwise the project list.
    show() {
      if (state.view === "studio" && state.project) { go(); return; }
      showHome();
    },
    openProject,
    showNewProject,
    newProjectIn: (workspaceId) => showNewProject(workspaceId),
    flush: flushAll,
    getState: () => state
  };
}
