function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export class AnnotationController {
  constructor(options) {
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext("2d");
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
    this.getStorageKeyForPage = options.getStorageKeyForPage;
    this.getCurrentPage = options.getCurrentPage;
    this.getPageCount = options.getPageCount;

    this.isAnnotating = false;
    this.toolType = null;
    this.tool = null;
    this.drawing = false;
    this.activePath = null;
    this.paths = [];

    this.penStates = this.penButtons.map((_, i) => ({
      color: ["#222222", "#e74c3c", "#3498db"][i] || "#222222",
      width: 2
    }));

    this.highlighterStates = this.highlighterButtons.map((_, i) => ({
      color: ["#ffff00", "#00ff00"][i] || "#ffff00",
      width: 12
    }));
    
    this.activeButtonIndex = -1;
    this.stickyNotes = []; // { text, x, y, date } where x/y are normalized 0..1

    this.isEnabled = true;
    this.eraserSize = 12;
    
    this.updateButtonColors();

    this.pdfViewer.addEventListener("mousedown", (event) => {
      // Only handle if not currently in an active drawing mode
      if (!this.isAnnotating && this.isEnabled) {
        this.handleCanvasClick(event);
      }
    });

    // Add mousemove to show pointer cursor over stickies
    this.pdfViewer.addEventListener("mousemove", (event) => {
      if (!this.isAnnotating && this.isEnabled) {
        const point = this.getPoint(event);
        const hit = this.findStickyNoteAtPoint(point);
        this.pdfViewer.style.cursor = hit ? "pointer" : "";
      }
    });
  }

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

  getPoint(event) {
    const rect = this.pdfViewer.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
  }

  toNormalized(point) {
    const w = Math.max(1, this.canvas.width || 1);
    const h = Math.max(1, this.canvas.height || 1);
    return {
      x: Math.max(0, Math.min(1, point.x / w)),
      y: Math.max(0, Math.min(1, point.y / h))
    };
  }

  fromNormalized(point) {
    return {
      x: (Number(point?.x) || 0) * Math.max(1, this.canvas.width || 1),
      y: (Number(point?.y) || 0) * Math.max(1, this.canvas.height || 1)
    };
  }

  widthToCanvas(path) {
    if (Number.isFinite(path?.widthNorm) && path.widthNorm > 0) {
      return Math.max(1, path.widthNorm * Math.max(1, this.canvas.width || 1));
    }
    return Math.max(1, Number(path?.width) || 1);
  }

  resizeTo(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.redraw();
  }

  getStorageData(pageNum = this.getCurrentPage()) {
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

  normalizeLoadedPath(path) {
    const points = Array.isArray(path?.points) ? path.points : [];
    const looksNormalized = points.length > 0 && points.every((pt) => Number(pt?.x) <= 1 && Number(pt?.y) <= 1);
    const normalizedPoints = looksNormalized ? points : points.map((pt) => this.toNormalized(pt));
    const width = Number(path?.width) || 2;
    const widthNorm = Number(path?.widthNorm) || (width / Math.max(1, this.canvas.width || 1));

    return {
      color: path?.color || '#222222',
      width,
      widthNorm,
      alpha: Number(path?.alpha) || 1,
      points: normalizedPoints
    };
  }

  normalizeLoadedNote(note) {
    const maybeNorm = Number(note?.x) <= 1 && Number(note?.y) <= 1;
    if (maybeNorm) {
      return {
        text: String(note?.text || ''),
        x: Math.max(0, Math.min(1, Number(note?.x) || 0)),
        y: Math.max(0, Math.min(1, Number(note?.y) || 0)),
        date: Number(note?.date) || Date.now()
      };
    }

    const converted = this.toNormalized({ x: Number(note?.x) || 0, y: Number(note?.y) || 0 });
    return {
      text: String(note?.text || ''),
      x: converted.x,
      y: converted.y,
      date: Number(note?.date) || Date.now()
    };
  }

  loadPageAnnotations(pageNum = this.getCurrentPage()) {
    const data = this.getStorageData(pageNum);
    this.paths = (data.paths || []).map((path) => this.normalizeLoadedPath(path));
    this.stickyNotes = (data.stickyNotes || []).map((note) => this.normalizeLoadedNote(note));
    this.redraw();
  }

  savePageAnnotations(pageNum = this.getCurrentPage()) {
    const key = this.getStorageKeyForPage(pageNum);
    window.electronAPI.setItem(key, JSON.stringify({
      paths: this.paths,
      stickyNotes: this.stickyNotes
    }));
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
    this.loadPageAnnotations(this.getCurrentPage());
  }

  getStickyNotesForPage(pageNum = this.getCurrentPage()) {
    const data = this.getStorageData(pageNum);
    return (data.stickyNotes || []).map((note) => this.normalizeLoadedNote(note));
  }

  redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const path of this.paths) {
      this.ctx.strokeStyle = path.color;
      this.ctx.lineWidth = this.widthToCanvas(path);
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
      this.ctx.globalAlpha = path.alpha || 1;
      this.ctx.beginPath();

      path.points.forEach((rawPoint, index) => {
        const pt = this.fromNormalized(rawPoint);
        if (index === 0) {
          this.ctx.moveTo(pt.x, pt.y);
        } else {
          this.ctx.lineTo(pt.x, pt.y);
        }
      });

      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    }

    // Draw sticky notes
    for (const note of this.stickyNotes) {
      this.drawStickyNoteIcon(note);
    }
  }

  drawStickyNoteIcon(note) {
    const { x, y } = this.fromNormalized(note);
    const size = 24;
    
    // Shadow
    this.ctx.shadowBlur = 4;
    this.ctx.shadowColor = "rgba(0,0,0,0.3)";
    this.ctx.shadowOffsetY = 2;

    // Body
    this.ctx.fillStyle = "#f1c40f";
    this.ctx.beginPath();
    this.ctx.roundRect(x - size/2, y - size/2, size, size, 4);
    this.ctx.fill();

    // Reset shadow
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetY = 0;

    // Icon (simple lines for text)
    this.ctx.strokeStyle = "#927608";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x - 6, y - 4);
    this.ctx.lineTo(x + 6, y - 4);
    this.ctx.moveTo(x - 6, y);
    this.ctx.lineTo(x + 6, y);
    this.ctx.moveTo(x - 6, y + 4);
    this.ctx.lineTo(x + 2, y + 4);
    this.ctx.stroke();
  }

  handleCanvasClick(event) {
    if (!this.isEnabled) return;
    
    const point = this.getPoint(event);
    const hit = this.findStickyNoteAtPoint(point);
    
    if (hit) {
      this.showStickyNotePopover(hit.note, event.clientX, event.clientY);
      // If we hit a sticky, we stop propagation if we're in drawing mode to prevent accidental strokes
      if (this.isAnnotating) {
        this.drawing = false;
        event.stopImmediatePropagation();
      }
      return;
    }

    // Normal annotation logic continues if no sticky hit
    if (this.isAnnotating) {
      // (Mousedown for drawing is handled in bindEvents, this handleCanvasClick 
      // is primarily for sticky hit testing via the shared listener)
    }
  }

  findStickyNoteAtPoint(point) {
    // Increased radius for better hit testing
    const radius = 20;
    if (!this.stickyNotes || this.stickyNotes.length === 0) {
      console.debug("No sticky notes to check");
      return null;
    }

    for (const note of this.stickyNotes) {
      const p = this.fromNormalized(note);
      const dx = point.x - p.x;
      const dy = point.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        return { note };
      }
    }
    return null;
  }

  showStickyNotePopover(note, clientX, clientY) {
    const existing = document.querySelector(".sticky-tooltip");
    if (existing) existing.remove();

    const el = document.createElement("div");
    el.className = "sticky-tooltip";
    el.innerHTML = `
      <div class="sticky-tooltip-header">
        <div class="sticky-tooltip-title">Sticky Note</div>
        <button class="sticky-tooltip-close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="sticky-tooltip-body">${String(note?.text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
    `;

    document.body.appendChild(el);
    el.style.left = `${clientX}px`;
    el.style.top = `${clientY}px`;

    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 16}px`;
    }
    if (rect.bottom > window.innerHeight) {
      const top = clientY - rect.height - 10;
      el.style.top = `${Math.max(10, top)}px`;
    }

    el.querySelector(".sticky-tooltip-close").addEventListener("click", () => el.remove());
    const clickOutside = (e) => {
      if (!el.contains(e.target)) {
        el.remove();
        document.removeEventListener("mousedown", clickOutside);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", clickOutside), 10);
  }

  addStickyNote(text, x, y, pageNum = this.getCurrentPage()) {
    if (pageNum !== this.getCurrentPage()) {
      const data = this.getStorageData(pageNum);
      const normalized = this.toNormalized({ x, y });
      data.stickyNotes = Array.isArray(data.stickyNotes) ? data.stickyNotes : [];
      data.stickyNotes.push({
        text,
        x: normalized.x,
        y: normalized.y,
        date: Date.now()
      });
      window.electronAPI.setItem(this.getStorageKeyForPage(pageNum), JSON.stringify(data));
      return;
    }

    const normalized = this.toNormalized({ x, y });
    this.stickyNotes.push({
      text,
      x: normalized.x,
      y: normalized.y,
      date: Date.now()
    });
    this.savePageAnnotations();
    this.redraw();
    window.dispatchEvent(new CustomEvent("thinker:milestone", { detail: "markup" }));
  }

  addAgentComments(comments = []) {
    comments.forEach((comment) => {
      const page = Number(comment.page) || this.getCurrentPage();
      const nx = Number(comment.x);
      const ny = Number(comment.y);

      if (Number.isFinite(nx) && Number.isFinite(ny)) {
        const px = nx <= 1 ? nx * Math.max(1, this.canvas.width || 1) : nx;
        const py = ny <= 1 ? ny * Math.max(1, this.canvas.height || 1) : ny;
        this.addStickyNote(comment.text, px, py, page);
      } else {
        const fallbackX = 56 + ((page * 37) % 120);
        const fallbackY = 72 + ((page * 53) % 240);
        this.addStickyNote(comment.text, fallbackX, fallbackY, page);
      }
    });

    this.loadPageAnnotations(this.getCurrentPage());
  }

  clearButtonStates() {
    [...this.penButtons, ...this.highlighterButtons, this.eraserButton].forEach((btn) => {
      if (btn) {
        btn.classList.remove("active");
      }
    });
  }

  stopMode() {
    this.isAnnotating = false;
    this.tool = null;
    this.toolType = null;
    this.canvas.style.pointerEvents = "none";
    this.penControls.style.display = "none";
    this.highlighterControls.style.display = "none";
    
    const strip = document.getElementById("control-strip");
    if (strip) strip.style.display = "none";
    
    this.clearButtonStates();
    this.activeButtonIndex = -1;
    document.body.classList.remove("drawing-active");
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
      this.onStatus("Current view does not support annotations.");
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
    this.canvas.style.pointerEvents = "auto";
    document.body.classList.add("drawing-active");
    
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

  eraseAt(point) {
    const radius = this.eraserSize;
    const hit = (path) => path.points.some((rawPoint) => {
      const pt = this.fromNormalized(rawPoint);
      const dx = pt.x - point.x;
      const dy = pt.y - point.y;
      const threshold = Math.max(radius, this.widthToCanvas(path) * 0.7);
      return (dx * dx + dy * dy) <= threshold * threshold;
    });

    const next = this.paths.filter((path) => !hit(path));
    if (next.length !== this.paths.length) {
      this.paths = next;
      this.redraw();
      this.savePageAnnotations();
    }
  }

  bindEvents() {
    this.canvas.addEventListener("mousedown", (event) => {
      if (!this.isAnnotating || !this.tool) {
        return;
      }

      if (this.toolType === "eraser") {
        this.eraseAt(this.getPoint(event));
        this.drawing = true;
        return;
      }

      this.drawing = true;
      const point = this.getPoint(event);
      this.activePath = {
        color: this.tool.color,
        width: this.tool.width,
        widthNorm: this.tool.width / Math.max(1, this.canvas.width || 1),
        alpha: this.tool.alpha,
        points: [this.toNormalized(point)]
      };
      this.paths.push(this.activePath);
      this.redraw();
    });

    this.canvas.addEventListener("mousemove", (event) => {
      if (!this.drawing || !this.activePath) {
        if (this.drawing && this.toolType === "eraser") {
          this.eraseAt(this.getPoint(event));
        }
        return;
      }

      this.activePath.points.push(this.toNormalized(this.getPoint(event)));
      this.redraw();
    });

    const stop = () => {
      if (!this.drawing) {
        return;
      }
      this.drawing = false;
      this.activePath = null;
      this.savePageAnnotations();
      window.dispatchEvent(new CustomEvent("thinker:milestone", { detail: "markup" }));
    };

    this.canvas.addEventListener("mouseup", stop);
    this.canvas.addEventListener("mouseleave", stop);

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
