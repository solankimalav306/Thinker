export class SnipController {
  constructor(options) {
    this.stage = options.stage || options.pdfViewer;
    this.pdfViewer = options.pdfViewer;
    this.pdfCanvas = options.pdfCanvas;
    this.screenshotBtn = options.screenshotBtn;
    this.selection = options.selection;
    this.onImage = options.onImage;
    this.onStatus = options.onStatus;
    this.onEnter = options.onEnter;
    this.onExit = options.onExit;

    this.isSnipping = false;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.host = null; // the page (single view, or one page card) being snipped
    this.sourceCanvas = null;
  }

  // The page under the pointer: the single-page viewer, or one page card in two-page / continuous view.
  hostAt(event) {
    const card = event.target?.closest?.(".pdf-page-card");
    if (card) return { host: card, canvas: card.querySelector("canvas:not(.annotation-surface)") };
    if (this.pdfViewer.offsetParent !== null && this.pdfViewer.contains(event.target)) {
      return { host: this.pdfViewer, canvas: this.pdfCanvas };
    }
    return null;
  }

  getPoint(event) {
    const rect = this.host.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
  }

  start() {
    this.isSnipping = true;
    this.screenshotBtn.classList.add("active");
    document.body.classList.add("snipping-active");
    this.onEnter();
    this.onStatus("Snip mode active. Drag on PDF.");
  }

  stop() {
    this.isSnipping = false;
    this.isDragging = false;
    this.screenshotBtn.classList.remove("active");
    document.body.classList.remove("snipping-active");
    this.selection.style.display = "none";
    this.selection.style.width = "0";
    this.selection.style.height = "0";
    this.onExit();
  }

  toggle() {
    if (this.isSnipping) {
      this.stop();
      this.onStatus("Ready.");
      return;
    }

    this.start();
  }

  bindEvents() {
    this.screenshotBtn.addEventListener("click", () => this.toggle());

    this.stage.addEventListener("mousedown", (event) => {
      if (!this.isSnipping) {
        return;
      }

      const target = this.hostAt(event);
      if (!target || !target.canvas) {
        return;
      }
      this.host = target.host;
      this.sourceCanvas = target.canvas;
      this.host.appendChild(this.selection);
      event.preventDefault();

      this.isDragging = true;
      const point = this.getPoint(event);
      this.startX = point.x;
      this.startY = point.y;

      this.selection.style.left = `${this.startX}px`;
      this.selection.style.top = `${this.startY}px`;
      this.selection.style.width = "0px";
      this.selection.style.height = "0px";
      this.selection.style.display = "block";
    });

    this.stage.addEventListener("mousemove", (event) => {
      if (!this.isDragging) {
        return;
      }

      const point = this.getPoint(event);
      const currentX = point.x;
      const currentY = point.y;

      this.selection.style.left = `${Math.min(currentX, this.startX)}px`;
      this.selection.style.top = `${Math.min(currentY, this.startY)}px`;
      this.selection.style.width = `${Math.abs(currentX - this.startX)}px`;
      this.selection.style.height = `${Math.abs(currentY - this.startY)}px`;
    });

    this.stage.addEventListener("mouseup", () => {
      if (!this.isDragging) {
        return;
      }

      this.isDragging = false;
      const x = parseFloat(this.selection.style.left || "0");
      const y = parseFloat(this.selection.style.top || "0");
      const width = parseFloat(this.selection.style.width || "0");
      const height = parseFloat(this.selection.style.height || "0");

      this.stop();

      if (width <= 5 || height <= 5) {
        this.onStatus("Snip cancelled.");
        return;
      }

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.drawImage(this.sourceCanvas, x, y, width, height, 0, 0, width, height);
      this.onImage(tempCanvas.toDataURL("image/png"));
      this.onStatus("Screenshot attached to chat.");
    });

    this.stage.addEventListener("mouseleave", () => {
      if (!this.isDragging) {
        return;
      }

      this.stop();
      this.onStatus("Snip cancelled.");
    });
  }
}
