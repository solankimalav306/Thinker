function toPdfSource(path) {
  if (/^https?:\/\//i.test(path) || /^file:\/\//i.test(path) || /^\.\//.test(path)) {
    return path;
  }

  return `file:///${path.replace(/\\/g, "/")}`;
}

function fileName(path) {
  return path.split(/[/\\]/).pop() || "Untitled";
}

const VIEW_MODES = new Set(["single", "two", "scroll"]);

export class PdfController {
  constructor(options) {
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.textLayerDiv = options.textLayerDiv;
    this.pdfViewer = options.pdfViewer;
    this.multiView = options.multiView;
    this.pageNumEl = options.pageNumEl;
    this.pageCountEl = options.pageCountEl;
    this.zoomInput = options.zoomInput;
    this.fitModeSelect = options.fitModeSelect;
    this.stageElement = options.stageElement;
    this.prevBtn = options.prevBtn;
    this.nextBtn = options.nextBtn;
    this.outlineList = options.outlineList;
    this.thumbnailList = options.thumbnailList;
    this.onStatus = options.onStatus;
    this.onPathChange = options.onPathChange;
    this.onRendered = options.onRendered;

    this.pdfDoc = null;
    this.currentPath = "";
    this.pageNum = 1;
    this.scale = 1.5;
    this.viewMode = "single";
    this.fitMode = "auto";

    this.pageRendering = false;
    this.pageNumPending = null;
    this.scrollPageNodes = new Map();
    this.scrollCacheKey = "";

    if (this.fitModeSelect) {
      this.fitMode = this.fitModeSelect.value || "auto";
      this.fitModeSelect.addEventListener("change", () => {
        this.fitMode = this.fitModeSelect.value || "auto";
        this.scrollCacheKey = "";
        this.queueRender(this.pageNum);
      });
    }
  }

  getCurrentPath() {
    return this.currentPath;
  }

  getPageNum() {
    return this.pageNum;
  }

  hasDocument() {
    return Boolean(this.pdfDoc);
  }

  getViewState() {
    return {
      pageNum: this.pageNum,
      scale: this.scale,
      viewMode: this.viewMode
    };
  }

  async load(path, viewState = null) {
    this.onStatus("Loading PDF...");

    try {
      const task = pdfjsLib.getDocument(toPdfSource(path));
      this.pdfDoc = await task.promise;
      this.currentPath = path;

      const nextPage = viewState?.pageNum || 1;
      const nextScale = viewState?.scale || 1.35;
      const nextMode = VIEW_MODES.has(viewState?.viewMode) ? viewState.viewMode : this.viewMode;

      this.pageNum = Math.max(1, Math.min(nextPage, this.pdfDoc.numPages));
      this.scale = Math.max(0.25, Math.min(nextScale, 5));
      this.viewMode = nextMode;
      this.scrollCacheKey = "";

      this.onPathChange(fileName(path));
      this.updateControls();
      this.queueRender(this.pageNum);

      this.buildOutline();
      this.buildThumbnails();

      this.onStatus("PDF loaded.");
    } catch (error) {
      console.error("PDF load failed", error);
      this.onStatus("Could not load PDF.");
    }
  }

  setViewMode(mode) {
    if (!VIEW_MODES.has(mode) || mode === this.viewMode) {
      return;
    }

    this.viewMode = mode;
    this.scrollCacheKey = "";
    this.queueRender(this.pageNum);
  }

  jumpToPage(pageNumber) {
    if (!this.pdfDoc) {
      return;
    }

    const target = Math.max(1, Math.min(pageNumber, this.pdfDoc.numPages));
    this.pageNum = target;

    if (this.viewMode === "scroll" && this.scrollPageNodes.has(target)) {
      this.scrollPageNodes.get(target).scrollIntoView({ behavior: "smooth", block: "start" });
      this.updateControls();
      this.highlightThumb(target);
      return;
    }

    this.queueRender(target);
  }

  updateControls() {
    this.pageNumEl.textContent = String(this.pdfDoc ? this.pageNum : 0);
    this.pageCountEl.textContent = String(this.pdfDoc ? this.pdfDoc.numPages : 0);
    this.zoomInput.value = `${Math.round(this.scale * 100)}%`;

    if (!this.pdfDoc) {
      this.prevBtn.disabled = true;
      this.nextBtn.disabled = true;
      return;
    }

    const step = this.viewMode === "two" ? 2 : 1;
    this.prevBtn.disabled = this.pageNum <= 1;
    this.nextBtn.disabled = this.pageNum + step > this.pdfDoc.numPages;
  }

  nextPage() {
    if (!this.pdfDoc) {
      return;
    }

    const step = this.viewMode === "two" ? 2 : 1;
    const next = this.pageNum + step;
    if (next > this.pdfDoc.numPages) {
      return;
    }

    this.jumpToPage(next);
  }

  prevPage() {
    if (!this.pdfDoc) {
      return;
    }

    const step = this.viewMode === "two" ? 2 : 1;
    const prev = this.pageNum - step;
    if (prev < 1) {
      return;
    }

    this.jumpToPage(prev);
  }

  setScale(rawScale) {
    this.scale = Math.max(0.25, Math.min(rawScale, 5));
    if (this.fitModeSelect) {
      this.fitModeSelect.value = "actual";
      this.fitMode = "actual";
    }
    this.scrollCacheKey = "";
    this.updateControls();
    this.queueRender(this.pageNum);
  }

  getFittedScale(page, mode) {
    if (!this.stageElement || mode === "actual") {
      return this.scale;
    }

    const stageWidth = Math.max(320, this.stageElement.clientWidth - 36);
    const baseViewport = page.getViewport({ scale: 1 });

    if (this.viewMode === "two") {
      const target = (stageWidth - 16) / 2;
      const fit = target / baseViewport.width;
      return Math.max(0.2, Math.min(fit, 3));
    }

    const fit = stageWidth / baseViewport.width;
    if (mode === "width" || mode === "auto") {
      return Math.max(0.2, Math.min(fit, 3));
    }

    return this.scale;
  }

  setScaleFromInput(inputValue) {
    const num = parseFloat(inputValue.replace("%", ""));
    if (Number.isFinite(num)) {
      this.setScale(num / 100);
    } else {
      this.updateControls();
    }
  }

  queueRender(num) {
    if (this.pageRendering) {
      this.pageNumPending = num;
      return;
    }

    this.render(num);
  }

  async render(num) {
    if (!this.pdfDoc) {
      return;
    }

    this.pageRendering = true;

    if (this.viewMode === "single") {
      await this.renderSingle(num);
    } else if (this.viewMode === "two") {
      await this.renderTwo(num);
    } else {
      await this.renderScroll(num);
    }

    this.updateControls();
    this.highlightThumb(this.pageNum);

    this.pageRendering = false;
    if (this.pageNumPending !== null) {
      const pending = this.pageNumPending;
      this.pageNumPending = null;
      this.render(pending);
    }
  }

  setSingleModeDisplay(on) {
    this.pdfViewer.style.display = on ? "block" : "none";
    this.multiView.style.display = on ? "none" : "";
  }

  async renderSingle(num) {
    this.setSingleModeDisplay(true);

    const targetPage = Math.max(1, Math.min(num, this.pdfDoc.numPages));
    this.pageNum = targetPage;

    const page = await this.pdfDoc.getPage(targetPage);
    const renderScale = this.getFittedScale(page, this.fitMode);
    const viewport = page.getViewport({ scale: renderScale });

    this.canvas.width = Math.floor(viewport.width);
    this.canvas.height = Math.floor(viewport.height);
    this.pdfViewer.style.width = `${viewport.width}px`;
    this.pdfViewer.style.height = `${viewport.height}px`;

    this.textLayerDiv.innerHTML = "";

    await page.render({ canvasContext: this.ctx, viewport }).promise;

    this.textLayerDiv.style.setProperty("--scale-factor", viewport.scale);
    const textContent = await page.getTextContent();

    pdfjsLib.renderTextLayer({
      textContent,
      container: this.textLayerDiv,
      viewport,
      textDivs: []
    });

    this.onRendered({ annotationSupported: true, mode: "single", pageNum: this.pageNum });
  }

  async renderTwo(num) {
    this.setSingleModeDisplay(false);
    this.multiView.className = "pdf-multi-view multi-view-two";
    this.multiView.innerHTML = "";

    const leftPage = Math.max(1, Math.min(num, this.pdfDoc.numPages));
    this.pageNum = leftPage;

    const pages = [leftPage];
    if (leftPage + 1 <= this.pdfDoc.numPages) {
      pages.push(leftPage + 1);
    }

    let renderScale = this.scale;
    const firstPage = await this.pdfDoc.getPage(leftPage);
    renderScale = this.getFittedScale(firstPage, this.fitMode === "auto" ? "width" : this.fitMode);

    for (const pageNum of pages) {
      const card = await this.renderStandalonePage(pageNum, renderScale);
      this.multiView.appendChild(card);
    }

    this.onRendered({ annotationSupported: false, mode: "two", pageNum: this.pageNum });
  }

  async renderScroll(num) {
    this.setSingleModeDisplay(false);
    this.multiView.className = "pdf-multi-view multi-view-scroll";

    const base = this.fitMode === "actual" ? this.scale : 1;
    const key = `${this.currentPath}|${base.toFixed(2)}|scroll|${this.fitMode}`;
    if (this.scrollCacheKey !== key) {
      this.multiView.innerHTML = "";
      this.scrollPageNodes.clear();

      for (let p = 1; p <= this.pdfDoc.numPages; p += 1) {
        const page = await this.pdfDoc.getPage(p);
        const renderScale = this.getFittedScale(page, this.fitMode === "auto" ? "width" : this.fitMode) * 0.95;
        const card = await this.renderStandalonePage(p, renderScale);
        card.dataset.page = String(p);
        this.multiView.appendChild(card);
        this.scrollPageNodes.set(p, card);
      }

      this.scrollCacheKey = key;

      this.multiView.onscroll = null;
    }

    const target = Math.max(1, Math.min(num, this.pdfDoc.numPages));
    this.pageNum = target;
    const node = this.scrollPageNodes.get(target);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    this.onRendered({ annotationSupported: false, mode: "scroll", pageNum: this.pageNum });
  }

  async renderStandalonePage(pageNum, scale) {
    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const card = document.createElement("div");
    card.className = "pdf-page-card";
    card.style.width = `${viewport.width}px`;
    card.style.height = `${viewport.height}px`;

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    card.appendChild(canvas);

    const cardCtx = canvas.getContext("2d");
    await page.render({ canvasContext: cardCtx, viewport }).promise;

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer pdf-page-text-layer";
    card.appendChild(textLayer);

    textLayer.style.setProperty("--scale-factor", viewport.scale);
    const textContent = await page.getTextContent();

    pdfjsLib.renderTextLayer({
      textContent,
      container: textLayer,
      viewport,
      textDivs: []
    });

    return card;
  }

  async buildThumbnails() {
    if (!this.thumbnailList || !this.pdfDoc) {
      return;
    }

    this.thumbnailList.innerHTML = "";

    for (let p = 1; p <= this.pdfDoc.numPages; p += 1) {
      const thumb = document.createElement("button");
      thumb.className = "thumb-item";
      thumb.type = "button";
      thumb.dataset.page = String(p);

      const canvas = document.createElement("canvas");
      const label = document.createElement("p");
      label.textContent = `Page ${p}`;

      thumb.appendChild(canvas);
      thumb.appendChild(label);
      thumb.addEventListener("click", () => this.jumpToPage(p));
      this.thumbnailList.appendChild(thumb);

      const page = await this.pdfDoc.getPage(p);
      const viewport = page.getViewport({ scale: 0.2 });
      canvas.width = Math.max(80, Math.floor(viewport.width));
      canvas.height = Math.max(110, Math.floor(viewport.height));

      const tctx = canvas.getContext("2d");
      await page.render({ canvasContext: tctx, viewport }).promise;
    }

    this.highlightThumb(this.pageNum);
  }

  highlightThumb(pageNum) {
    if (!this.thumbnailList) {
      return;
    }

    this.thumbnailList.querySelectorAll(".thumb-item").forEach((node) => {
      node.classList.toggle("active", Number(node.dataset.page) === pageNum);
    });
  }

  async resolveDestToPage(dest) {
    if (!dest) {
      return null;
    }

    const resolved = typeof dest === "string" ? await this.pdfDoc.getDestination(dest) : dest;
    if (!resolved || !Array.isArray(resolved) || resolved.length === 0) {
      return null;
    }

    const ref = resolved[0];
    if (typeof ref === "object") {
      const index = await this.pdfDoc.getPageIndex(ref);
      return index + 1;
    }

    if (typeof ref === "number") {
      return ref + 1;
    }

    return null;
  }

  async buildOutline() {
    if (!this.outlineList || !this.pdfDoc) {
      return;
    }

    this.outlineList.innerHTML = "";

    const outline = await this.pdfDoc.getOutline();
    if (!outline || outline.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No outline found";
      empty.style.color = "var(--text-soft)";
      empty.style.fontSize = "0.78rem";
      this.outlineList.appendChild(empty);
      return;
    }

    const walk = async (items, depth = 0) => {
      for (const item of items) {
        const page = await this.resolveDestToPage(item.dest);
        const li = document.createElement("li");

        const btn = document.createElement("button");
        btn.className = "jump-item-btn";
        btn.style.paddingLeft = `${8 + depth * 14}px`;
        btn.textContent = item.title || `Section ${depth + 1}`;
        if (page) {
          btn.addEventListener("click", () => this.jumpToPage(page));
        } else {
          btn.disabled = true;
        }

        li.appendChild(btn);
        this.outlineList.appendChild(li);

        if (Array.isArray(item.items) && item.items.length > 0) {
          await walk(item.items, depth + 1);
        }
      }
    };

    await walk(outline);
  }
}
