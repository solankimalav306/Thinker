import { strokeTouchedBy } from "./page-geometry.js";

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const HISTORY_LIMIT = 100;

// Marks (pens, highlighters, eraser, sticky notes) live on "surfaces": one transparent canvas per page
// that is on screen. Single-page view has one surface (the original #annotation-canvas, which always
// shows the current page); two-page and continuous view register one surface per page card. Tool state
// is shared, and every stroke is stored per page with coordinates relative to the page, so marks line
// up at any zoom and in any view.
export class AnnotationController {
  constructor(options) {
    this.pdfViewer = options.pdfViewer;
    this.textLayer = options.textLayer;
    this.penControls = options.penControls;
    this.highlighterControls = options.highlighterControls;
    this.penColorInput = options.penColorInput;
    this.penWidthInput = options.penWidthInput;
    this.highlighterColorInput = options.highlighterColorInput;
    this.highlighterWidthInput = options.highlighterWidthInput;
    this.penButtons = options.penButtons;
    this.highlighterButtons = options.highlighterButtons;
    this.eraserButton = options.eraserButton;
    this.onStatus = options.onStatus;
    this.onChange = options.onChange || (() => {});
    this.getStorageKeyForPage = options.getStorageKeyForPage;
    this.getCurrentPage = options.getCurrentPage;
    this.getPageCount = options.getPageCount;

    this.isAnnotating = false;
    this.toolType = null;
    this.tool = null;
    this.drawing = false;
    this.activePath = null;
    this.placementHandler = null; // set by the app while a sticky note is being placed

    this.penStates = this.penButtons.map((_, i) => ({
      color: ["#222222", "#e74c3c", "#3498db"][i] || "#222222",
      width: 2
    }));

    this.highlighterStates = this.highlighterButtons.map((_, i) => ({
      color: ["#ffff00", "#00ff00"][i] || "#ffff00",
      width: 12
    }));

    this.activeButtonIndex = -1;
    this.isEnabled = true;
    this.eraserSize = 12;
    this.lastErasePoint = null;
    this.undoStack = [];
    this.redoStack = [];

    this.surfaces = new Map(); // page number -> surface (two-page and continuous view)
    this.main = this.makeSurface({ canvas: options.canvas, host: options.pdfViewer, pageNum: null });
    this.mainVisible = true;
    this.active = this.main;

    this.updateButtonColors();
  }

  // ---- surfaces -----------------------------------------------------------------------------------

  makeSurface({ canvas, host, pageNum }) {
    return { canvas, ctx: canvas.getContext("2d"), host, pageNum, paths: [], stickyNotes: [], bound: false };
  }

  // Code written for one canvas keeps working: these follow whichever surface is being used.
  get canvas() { return this.active.canvas; }
  get ctx() { return this.active.ctx; }
  get paths() { return this.active.paths; }
  set paths(value) { this.active.paths = value; }
  get stickyNotes() { return this.active.stickyNotes; }
  set stickyNotes(value) { this.active.stickyNotes = value; }

  pageOf(surface = this.active) {
    return surface.pageNum ?? this.getCurrentPage();
  }

  allSurfaces() {
    return this.mainVisible ? [this.main] : [...this.surfaces.values()];
  }

  // The page view switches the original canvas on (single page) or off (two-page / continuous).
  setSurfaceMode(mode) {
    this.mainVisible = mode === "single";
    if (this.mainVisible) {
      this.surfaces.clear();
      this.active = this.main;
    }
    this.applyInteractivity();
  }

  registerSurface(card, pageNum, width, height) {
    if (!card) return null;
    card.querySelector(":scope > canvas.annotation-surface")?.remove();
    const canvas = document.createElement("canvas");
    canvas.className = "annotation-surface";
    canvas.width = Math.floor(width);
    canvas.height = Math.floor(height);
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    card.appendChild(canvas);

    const surface = this.makeSurface({ canvas, host: card, pageNum });
    this.surfaces.set(pageNum, surface);
    this.attachSurface(surface);
    this.loadSurface(surface);
    canvas.style.pointerEvents = this.isAnnotating ? "auto" : "none";
    return surface;
  }

  unregisterSurface(pageNum) {
    const surface = this.surfaces.get(pageNum);
    if (!surface) return;
    surface.canvas.remove();
    this.surfaces.delete(pageNum);
    if (this.active === surface) this.active = this.main;
  }

  clearSurfaces() {
    this.surfaces.clear();
    this.active = this.main;
  }

  surfaceFor(pageNum) {
    if (this.mainVisible) return pageNum === this.getCurrentPage() ? this.main : null;
    return this.surfaces.get(pageNum) || null;
  }

  applyInteractivity() {
    const value = this.isAnnotating ? "auto" : "none";
    this.main.canvas.style.pointerEvents = value;
    this.surfaces.forEach((surface) => { surface.canvas.style.pointerEvents = value; });
  }

  // ---- geometry -----------------------------------------------------------------------------------

  updateButtonColors() {
    this.penButtons.forEach((btn, i) => {
      if (btn) btn.style.color = this.penStates[i].color;
    });
    this.highlighterButtons.forEach((btn, i) => {
      if (btn) btn.style.color = this.highlighterStates[i].color;
    });
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.stopMode();
    }
  }

  getPoint(event, surface = this.active) {
    const rect = surface.host.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
  }

  toNormalized(point, surface = this.active) {
    const w = Math.max(1, surface.canvas.width || 1);
    const h = Math.max(1, surface.canvas.height || 1);
    return {
      x: Math.max(0, Math.min(1, point.x / w)),
      y: Math.max(0, Math.min(1, point.y / h))
    };
  }

  fromNormalized(point, surface = this.active) {
    return {
      x: (Number(point?.x) || 0) * Math.max(1, surface.canvas.width || 1),
      y: (Number(point?.y) || 0) * Math.max(1, surface.canvas.height || 1)
    };
  }

  widthToCanvas(path, surface = this.active) {
    if (Number.isFinite(path?.widthNorm) && path.widthNorm > 0) {
      return Math.max(1, path.widthNorm * Math.max(1, surface.canvas.width || 1));
    }
    return Math.max(1, Number(path?.width) || 1);
  }

  resizeTo(width, height) {
    this.main.canvas.width = width;
    this.main.canvas.height = height;
    this.main.canvas.style.width = `${width}px`;
    this.main.canvas.style.height = `${height}px`;
    this.redrawSurface(this.main);
  }

  // ---- storage ------------------------------------------------------------------------------------

  getStorageData(pageNum = this.pageOf()) {
    const key = this.getStorageKeyForPage(pageNum);
    const raw = window.electronAPI.getItem(key);
    if (!raw) {
      return { paths: [], stickyNotes: [] };
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return { paths: parsed, stickyNotes: [] };
      }
      return {
        paths: Array.isArray(parsed.paths) ? parsed.paths : [],
        stickyNotes: Array.isArray(parsed.stickyNotes) ? parsed.stickyNotes : []
      };
    } catch {
      return { paths: [], stickyNotes: [] };
    }
  }

  normalizeLoadedPath(path, surface = this.active) {
    const points = Array.isArray(path?.points) ? path.points : [];
    const looksNormalized = points.length > 0 && points.every((pt) => Number(pt?.x) <= 1 && Number(pt?.y) <= 1);
    const normalizedPoints = looksNormalized ? points : points.map((pt) => this.toNormalized(pt, surface));
    const width = Number(path?.width) || 2;
    const widthNorm = Number(path?.widthNorm) || (width / Math.max(1, surface.canvas.width || 1));

    return {
      color: path?.color || '#222222',
      width,
      widthNorm,
      alpha: Number(path?.alpha) || 1,
      points: normalizedPoints
    };
  }

  normalizeLoadedNote(note, surface = this.active) {
    const maybeNorm = Number(note?.x) <= 1 && Number(note?.y) <= 1;
    if (maybeNorm) {
      return {
        text: String(note?.text || ''),
        x: Math.max(0, Math.min(1, Number(note?.x) || 0)),
        y: Math.max(0, Math.min(1, Number(note?.y) || 0)),
        date: Number(note?.date) || Date.now()
      };
    }

    const converted = this.toNormalized({ x: Number(note?.x) || 0, y: Number(note?.y) || 0 }, surface);
    return {
      text: String(note?.text || ''),
      x: converted.x,
      y: converted.y,
      date: Number(note?.date) || Date.now()
    };
  }

  loadSurface(surface) {
    const data = this.getStorageData(this.pageOf(surface));
    surface.paths = (data.paths || []).map((path) => this.normalizeLoadedPath(path, surface));
    surface.stickyNotes = (data.stickyNotes || []).map((note) => this.normalizeLoadedNote(note, surface));
    this.redrawSurface(surface);
  }

  // Reloads the surface that shows `pageNum`, if one is on screen.
  loadPageAnnotations(pageNum = this.pageOf()) {
    const surface = this.surfaceFor(pageNum);
    if (surface) this.loadSurface(surface);
  }

  reloadAllSurfaces() {
    this.allSurfaces().forEach((surface) => this.loadSurface(surface));
  }

  saveSurface(surface) {
    const key = this.getStorageKeyForPage(this.pageOf(surface));
    window.electronAPI.setItem(key, JSON.stringify({
      paths: surface.paths,
      stickyNotes: surface.stickyNotes
    }));
  }

  savePageAnnotations(pageNum = this.pageOf()) {
    const surface = this.surfaceFor(pageNum) || this.active;
    this.saveSurface(surface);
  }

  collectDocumentAnnotations() {
    const total = this.getPageCount ? Number(this.getPageCount()) : 0;
    const byPage = {};
    for (let page = 1; page <= total; page += 1) {
      const data = this.getStorageData(page);
      if ((data.paths?.length || 0) === 0 && (data.stickyNotes?.length || 0) === 0) {
        continue;
      }

      byPage[page] = {
        paths: (data.paths || []).map((path) => this.normalizeLoadedPath(path)),
        stickyNotes: (data.stickyNotes || []).map((note) => this.normalizeLoadedNote(note))
      };
    }
    return byPage;
  }

  applyDocumentAnnotations(byPage = {}) {
    const total = this.getPageCount ? Number(this.getPageCount()) : 0;
    for (let page = 1; page <= total; page += 1) {
      const pageData = byPage[String(page)] || byPage[page] || { paths: [], stickyNotes: [] };
      const normalized = {
        paths: (pageData.paths || []).map((path) => this.normalizeLoadedPath(path)),
        stickyNotes: (pageData.stickyNotes || []).map((note) => this.normalizeLoadedNote(note))
      };
      window.electronAPI.setItem(this.getStorageKeyForPage(page), JSON.stringify(normalized));
    }
    this.reloadAllSurfaces();
  }

  getStickyNotesForPage(pageNum = this.pageOf()) {
    const data = this.getStorageData(pageNum);
    return (data.stickyNotes || []).map((note) => this.normalizeLoadedNote(note));
  }

  // ---- undo / redo --------------------------------------------------------------------------------

  docKey() {
    return String(this.getStorageKeyForPage(1)).replace(/:page-\d+$/, "");
  }

  snapshotPage(pageNum) {
    const data = this.getStorageData(pageNum);
    return JSON.stringify({ paths: data.paths || [], stickyNotes: data.stickyNotes || [] });
  }

  recordChange(pageNum, before) {
    const after = this.snapshotPage(pageNum);
    if (before === after) return;
    this.undoStack.push({ doc: this.docKey(), page: pageNum, before, after });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  applyPageState(pageNum, serialized) {
    window.electronAPI.setItem(this.getStorageKeyForPage(pageNum), serialized);
    this.loadPageAnnotations(pageNum);
    this.onChange(pageNum);
  }

  step(from, to, field) {
    const doc = this.docKey();
    while (from.length && from[from.length - 1].doc !== doc) from.pop(); // never reach into another document
    const entry = from.pop();
    if (!entry) return false;
    this.applyPageState(entry.page, entry[field]);
    to.push(entry);
    return entry.page;
  }

  undo() {
    const page = this.step(this.undoStack, this.redoStack, "before");
    this.onStatus(page ? `Undid a mark on page ${page}.` : "Nothing to undo.");
    return page;
  }

  redo() {
    const page = this.step(this.redoStack, this.undoStack, "after");
    this.onStatus(page ? `Redid a mark on page ${page}.` : "Nothing to redo.");
    return page;
  }

  // ---- drawing ------------------------------------------------------------------------------------

  redraw() {
    this.redrawSurface(this.active);
  }

  redrawSurface(surface) {
    const { ctx, canvas } = surface;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const path of surface.paths) {
      ctx.strokeStyle = path.color;
      ctx.lineWidth = this.widthToCanvas(path, surface);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = path.alpha || 1;
      ctx.beginPath();

      path.points.forEach((rawPoint, index) => {
        const pt = this.fromNormalized(rawPoint, surface);
        if (index === 0) {
          ctx.moveTo(pt.x, pt.y);
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      });

      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const note of surface.stickyNotes) {
      this.drawStickyNoteIcon(note, surface);
    }
  }

  drawStickyNoteIcon(note, surface = this.active) {
    const ctx = surface.ctx;
    const { x, y } = this.fromNormalized(note, surface);
    const size = 24;

    ctx.shadowBlur = 4;
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = "#f1c40f";
    ctx.beginPath();
    ctx.roundRect(x - size / 2, y - size / 2, size, size, 4);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = "#927608";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 4);
    ctx.lineTo(x + 6, y - 4);
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x + 6, y);
    ctx.moveTo(x - 6, y + 4);
    ctx.lineTo(x + 2, y + 4);
    ctx.stroke();
  }

  // ---- sticky notes -------------------------------------------------------------------------------

  handleCanvasClick(event, surface = this.active) {
    if (!this.isEnabled) return;
    this.active = surface;

    if (this.placementHandler && this.placementHandler(event, surface)) return;

    const point = this.getPoint(event, surface);
    const hit = this.findStickyNoteAtPoint(point, surface);

    if (hit) {
      this.showStickyNotePopover(hit.note, event.clientX, event.clientY, this.pageOf(surface));
      if (this.isAnnotating) {
        this.drawing = false;
        event.stopImmediatePropagation();
      }
    }
  }

  findStickyNoteAtPoint(point, surface = this.active) {
    const radius = 20;
    for (const note of surface.stickyNotes || []) {
      const p = this.fromNormalized(note, surface);
      if (Math.hypot(point.x - p.x, point.y - p.y) <= radius) {
        return { note };
      }
    }
    return null;
  }

  // Edits one page's data in storage, keeps undo history and refreshes the surface and notes panel.
  updatePage(pageNum, mutate) {
    const before = this.snapshotPage(pageNum);
    const data = this.getStorageData(pageNum);
    mutate(data);
    window.electronAPI.setItem(this.getStorageKeyForPage(pageNum), JSON.stringify(data));
    this.recordChange(pageNum, before);
    this.loadPageAnnotations(pageNum);
    this.onChange(pageNum);
  }

  showStickyNotePopover(note, clientX, clientY, pageNum = this.pageOf()) {
    document.querySelector(".sticky-tooltip")?.remove();

    const el = document.createElement("div");
    el.className = "sticky-tooltip";
    el.innerHTML = `
      <div class="sticky-tooltip-header">
        <div class="sticky-tooltip-title">Sticky Note</div>
        <button class="sticky-tooltip-close" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="sticky-tooltip-body"></div>
      <div class="sticky-tooltip-actions">
        <button type="button" class="sticky-edit"><i class="fa-solid fa-pen"></i> Edit</button>
        <button type="button" class="sticky-delete"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    `;
    const body = el.querySelector(".sticky-tooltip-body");
    body.textContent = String(note?.text || "");

    document.body.appendChild(el);
    el.style.left = `${clientX}px`;
    el.style.top = `${clientY}px`;

    const place = () => {
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 16}px`;
      if (rect.bottom > window.innerHeight) el.style.top = `${Math.max(10, clientY - rect.height - 10)}px`;
    };
    place();

    const matches = (n) => n.date === note.date && n.text === note.text;
    let outside;
    const close = () => {
      el.remove();
      document.removeEventListener("mousedown", outside);
    };
    outside = (e) => { if (!el.contains(e.target)) close(); };

    el.querySelector(".sticky-tooltip-close").addEventListener("click", close);
    el.querySelector(".sticky-delete").addEventListener("click", () => {
      this.updatePage(pageNum, (data) => {
        const index = (data.stickyNotes || []).findIndex(matches);
        if (index >= 0) data.stickyNotes.splice(index, 1);
      });
      this.onStatus("Sticky note deleted. Press Ctrl+Z to bring it back.");
      close();
    });
    el.querySelector(".sticky-edit").addEventListener("click", () => {
      const area = document.createElement("textarea");
      area.className = "sticky-edit-area";
      area.value = note.text || "";
      area.rows = 3;
      body.replaceWith(area);
      el.querySelector(".sticky-tooltip-actions").innerHTML = `<button type="button" class="sticky-save"><i class="fa-solid fa-check"></i> Save</button>`;
      area.focus();
      area.select();
      place();
      const save = () => {
        const text = area.value.trim();
        if (!text) return;
        this.updatePage(pageNum, (data) => {
          const target = (data.stickyNotes || []).find(matches);
          if (target) target.text = text;
        });
        this.onStatus("Sticky note updated.");
        close();
      };
      el.querySelector(".sticky-save").addEventListener("click", save);
      area.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
        if (e.key === "Escape") { e.stopPropagation(); close(); }
      });
    });
    setTimeout(() => document.addEventListener("mousedown", outside), 10);
  }

  addStickyNote(text, x, y, pageNum = this.pageOf(), surface = null) {
    const target = surface || this.surfaceFor(pageNum);
    const reference = target || this.active;
    const normalized = this.toNormalized({ x, y }, reference);
    const note = { text, x: normalized.x, y: normalized.y, date: Date.now() };

    this.updatePage(pageNum, (data) => {
      data.stickyNotes = Array.isArray(data.stickyNotes) ? data.stickyNotes : [];
      data.stickyNotes.push(note);
    });
    window.dispatchEvent(new CustomEvent("thinker:milestone", { detail: "markup" }));
  }

  addAgentComments(comments = []) {
    comments.forEach((comment) => {
      const page = Number(comment.page) || this.getCurrentPage();
      const nx = Number(comment.x);
      const ny = Number(comment.y);

      if (Number.isFinite(nx) && Number.isFinite(ny)) {
        const w = Math.max(1, this.active.canvas.width || 1);
        const h = Math.max(1, this.active.canvas.height || 1);
        const px = nx <= 1 ? nx * w : nx;
        const py = ny <= 1 ? ny * h : ny;
        this.addStickyNote(comment.text, px, py, page);
      } else {
        const fallbackX = 56 + ((page * 37) % 120);
        const fallbackY = 72 + ((page * 53) % 240);
        this.addStickyNote(comment.text, fallbackX, fallbackY, page);
      }
    });
  }

  // ---- tools --------------------------------------------------------------------------------------

  clearButtonStates() {
    [...this.penButtons, ...this.highlighterButtons, this.eraserButton].forEach((btn) => {
      if (btn) {
        btn.classList.remove("active");
        btn.setAttribute("aria-pressed", "false");
      }
    });
  }

  stopMode() {
    this.isAnnotating = false;
    this.tool = null;
    this.toolType = null;
    this.drawing = false;
    this.activePath = null;
    this.applyInteractivity();
    this.penControls.style.display = "none";
    this.highlighterControls.style.display = "none";

    const strip = document.getElementById("control-strip");
    if (strip) strip.style.display = "none";

    this.clearButtonStates();
    this.activeButtonIndex = -1;
    document.body.classList.remove("drawing-active");
    delete document.body.dataset.tool;
  }

  startPen(button, index) {
    this.activeButtonIndex = index;
    const state = this.penStates[index];
    this.penColorInput.value = state.color;
    this.penWidthInput.value = state.width;

    this.activate("pen", {
      color: state.color,
      width: state.width,
      alpha: 1
    }, button);
  }

  startHighlighter(button, index) {
    this.activeButtonIndex = index;
    const state = this.highlighterStates[index];
    this.highlighterColorInput.value = state.color;
    this.highlighterWidthInput.value = state.width;

    this.activate("highlighter", {
      color: hexToRgba(state.color, 0.35),
      width: state.width,
      alpha: 0.35
    }, button);
  }

  startEraser(button) {
    this.activate("eraser", {
      width: this.eraserSize,
      alpha: 1
    }, button);
  }

  activate(type, tool, button) {
    if (!this.isEnabled) {
      this.onStatus("Open a document to use the drawing tools.");
      return;
    }

    if (this.isAnnotating && this.toolType === type && button.classList.contains("active")) {
      this.stopMode();
      this.onStatus("Ready.");
      return;
    }

    this.isAnnotating = true;
    this.toolType = type;
    this.tool = tool;
    this.clearButtonStates();
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
    this.applyInteractivity();
    document.body.classList.add("drawing-active");
    document.body.dataset.tool = type;

    const strip = document.getElementById("control-strip");
    if (strip) strip.style.display = "flex";

    if (type === "pen") {
      this.penControls.style.display = "flex";
      this.highlighterControls.style.display = "none";
      this.onStatus("Pen mode active.");
    } else if (type === "highlighter") {
      this.penControls.style.display = "none";
      this.highlighterControls.style.display = "flex";
      this.onStatus("Highlighter mode active.");
    } else {
      this.penControls.style.display = "none";
      this.highlighterControls.style.display = "none";
      if (strip) strip.style.display = "none";
      this.onStatus("Eraser mode active.");
    }
  }

  eraseAt(point, previous = null) {
    const surface = this.active;
    const radius = this.eraserSize;
    const hit = (path) => strokeTouchedBy(
      path.points.map((raw) => this.fromNormalized(raw, surface)),
      previous || point,
      point,
      Math.max(radius, this.widthToCanvas(path, surface) * 0.7)
    );

    const next = surface.paths.filter((path) => !hit(path));
    if (next.length !== surface.paths.length) {
      surface.paths = next;
      this.redrawSurface(surface);
      this.saveSurface(surface);
    }
  }

  // ---- events -------------------------------------------------------------------------------------

  attachSurface(surface) {
    if (surface.bound) return;
    surface.bound = true;
    const { canvas, host } = surface;

    host.addEventListener("mousedown", (event) => {
      if (!this.isAnnotating && this.isEnabled) {
        this.handleCanvasClick(event, surface);
      }
    });

    host.addEventListener("mousemove", (event) => {
      if (!this.isAnnotating && this.isEnabled) {
        const hit = this.findStickyNoteAtPoint(this.getPoint(event, surface), surface);
        host.style.cursor = hit ? "pointer" : "";
      }
    });

    canvas.addEventListener("mousedown", (event) => {
      if (!this.isAnnotating || !this.tool || event.button !== 0) {
        return;
      }
      this.active = surface;
      this.historyBefore = this.snapshotPage(this.pageOf(surface));

      if (this.toolType === "eraser") {
        const point = this.getPoint(event, surface);
        this.eraseAt(point);
        this.lastErasePoint = point;
        this.drawing = true;
        return;
      }

      this.drawing = true;
      const point = this.getPoint(event, surface);
      this.activePath = {
        color: this.tool.color,
        width: this.tool.width,
        widthNorm: this.tool.width / Math.max(1, canvas.width || 1),
        alpha: this.tool.alpha,
        points: [this.toNormalized(point, surface)]
      };
      surface.paths.push(this.activePath);
      this.redrawSurface(surface);
    });

    canvas.addEventListener("mousemove", (event) => {
      if (this.active !== surface || !this.drawing) return;
      const point = this.getPoint(event, surface);
      if (this.toolType === "eraser") {
        this.eraseAt(point, this.lastErasePoint);
        this.lastErasePoint = point;
        return;
      }
      if (!this.activePath) return;
      this.activePath.points.push(this.toNormalized(point, surface));
      this.redrawSurface(surface);
    });

    const stop = () => {
      if (!this.drawing || this.active !== surface) {
        return;
      }
      this.drawing = false;
      this.activePath = null;
      this.lastErasePoint = null;
      this.saveSurface(surface);
      this.recordChange(this.pageOf(surface), this.historyBefore);
      this.onChange(this.pageOf(surface));
      window.dispatchEvent(new CustomEvent("thinker:milestone", { detail: "markup" }));
    };

    canvas.addEventListener("mouseup", stop);
    canvas.addEventListener("mouseleave", stop);
  }

  bindEvents() {
    this.attachSurface(this.main);

    this.penButtons.forEach((button, index) => {
      button.addEventListener("click", () => this.startPen(button, index));
    });

    this.highlighterButtons.forEach((button, index) => {
      button.addEventListener("click", () => this.startHighlighter(button, index));
    });

    if (this.eraserButton) {
      this.eraserButton.addEventListener("click", () => this.startEraser(this.eraserButton));
    }

    this.penColorInput.addEventListener("input", () => {
      if (this.isAnnotating && this.toolType === "pen" && this.activeButtonIndex !== -1) {
        const state = this.penStates[this.activeButtonIndex];
        state.color = this.penColorInput.value;
        this.tool = { color: state.color, width: state.width, alpha: 1 };
        this.updateButtonColors();
      }
    });

    this.penWidthInput.addEventListener("input", () => {
      if (this.isAnnotating && this.toolType === "pen" && this.activeButtonIndex !== -1) {
        const state = this.penStates[this.activeButtonIndex];
        state.width = parseInt(this.penWidthInput.value, 10);
        this.tool = { color: state.color, width: state.width, alpha: 1 };
      }
    });

    this.highlighterColorInput.addEventListener("input", () => {
      if (this.isAnnotating && this.toolType === "highlighter" && this.activeButtonIndex !== -1) {
        const state = this.highlighterStates[this.activeButtonIndex];
        state.color = this.highlighterColorInput.value;
        this.tool = {
          color: hexToRgba(state.color, 0.35),
          width: state.width,
          alpha: 0.35
        };
        this.updateButtonColors();
      }
    });

    this.highlighterWidthInput.addEventListener("input", () => {
      if (this.isAnnotating && this.toolType === "highlighter" && this.activeButtonIndex !== -1) {
        const state = this.highlighterStates[this.activeButtonIndex];
        state.width = parseInt(this.highlighterWidthInput.value, 10);
        this.tool = {
          color: hexToRgba(state.color, 0.35),
          width: state.width,
          alpha: 0.35
        };
      }
    });
  }
}
