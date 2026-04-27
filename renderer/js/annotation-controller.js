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
    this.getStorageKey = options.getStorageKey;

    this.isAnnotating = false;
    this.toolType = null;
    this.tool = null;
    this.drawing = false;
    this.currentPath = null;
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

    this.isEnabled = true;
    this.eraserSize = 12;
    
    this.updateButtonColors();
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

  resizeTo(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.redraw();
  }

  getStorageData() {
    const raw = localStorage.getItem(this.getStorageKey());
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  loadPageAnnotations() {
    this.paths = this.getStorageData();
    this.redraw();
  }

  savePageAnnotations() {
    localStorage.setItem(this.getStorageKey(), JSON.stringify(this.paths));
  }

  redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const path of this.paths) {
      this.ctx.strokeStyle = path.color;
      this.ctx.lineWidth = path.width;
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
      this.ctx.globalAlpha = path.alpha || 1;
      this.ctx.beginPath();

      path.points.forEach((pt, index) => {
        if (index === 0) {
          this.ctx.moveTo(pt.x, pt.y);
        } else {
          this.ctx.lineTo(pt.x, pt.y);
        }
      });

      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    }
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
    const hit = (path) => path.points.some((pt) => {
      const dx = pt.x - point.x;
      const dy = pt.y - point.y;
      const threshold = Math.max(radius, path.width * 0.7);
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
      this.currentPath = {
        color: this.tool.color,
        width: this.tool.width,
        alpha: this.tool.alpha,
        points: [point]
      };
      this.paths.push(this.currentPath);
      this.redraw();
    });

    this.canvas.addEventListener("mousemove", (event) => {
      if (!this.drawing || !this.currentPath) {
        if (this.drawing && this.toolType === "eraser") {
          this.eraseAt(this.getPoint(event));
        }
        return;
      }

      this.currentPath.points.push(this.getPoint(event));
      this.redraw();
    });

    const stop = () => {
      if (!this.drawing) {
        return;
      }
      this.drawing = false;
      this.currentPath = null;
      this.savePageAnnotations();
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
