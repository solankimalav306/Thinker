function toPdfSource(path) {
  // Already a URL — pass through untouched
  if (/^https?:\/\//i.test(path) || /^file:\/\//i.test(path) || /^\.\//.test(path)) {
    return path;
  }

  // Encode each segment individually so special filename chars (#, ?, %, &, spaces…)
  // don't get misinterpreted as URL fragment/query separators by PDF.js.
  const segments = path.replace(/\\/g, '/').split('/');
  const encoded = segments.map((seg, idx) => {
    // Windows drive letter "C:" — preserve colon, don't encode it
    if (idx === 0 && /^[A-Za-z]:$/.test(seg)) return seg;
    return encodeURIComponent(seg);
  });
  return 'file:///' + encoded.join('/');
}

function fileName(path) {
  return path.split(/[/\\]/).pop() || "Untitled";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


// Turns whatever PDF.js threw into something the interface can explain in plain words.
export function classifyLoadError(error) {
  const name = error?.name || "";
  const message = String(error?.message || error || "");
  if (name === "PasswordException") {
    return { kind: error.code === 2 ? "wrong-password" : "password" };
  }
  if (name === "MissingPDFException" || /not found|ENOENT|404|ERR_FILE_NOT_FOUND|Missing PDF/i.test(message)) {
    return { kind: "missing" };
  }
  if (name === "InvalidPDFException") {
    return { kind: /zero bytes|\bempty\b/i.test(message) ? "empty" : "invalid" };
  }
  return { kind: "unknown" };
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
    this.onViewChange = options.onViewChange;
    this.onLoadError = options.onLoadError;
    this.onPageRendered = options.onPageRendered;
    this.storagePath = options.storagePath;
    this.persistentHighlights = new Map(); // pageNum -> string[]
    this.highlightStoragePrefix = ''; // set on load
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

  getPageCount() {
    return this.pdfDoc ? this.pdfDoc.numPages : 0;
  }

  getPersistentHighlightsByPage() {
    const out = {};
    for (const [page, texts] of this.persistentHighlights.entries()) {
      out[page] = Array.isArray(texts) ? [...texts] : [];
    }
    return out;
  }

  setPersistentHighlightsByPage(highlightsByPage = {}) {
    this.persistentHighlights = new Map();
    Object.keys(highlightsByPage || {}).forEach((key) => {
      const page = Number(key);
      const texts = highlightsByPage[key];
      if (Number.isFinite(page) && Array.isArray(texts) && texts.length > 0) {
        this.persistentHighlights.set(page, texts);
        this._saveHighlightsForPage(page); // persist to storage
      }
    });
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

  
  _highlightKey(pageNum) {
    return `pdf-highlights:${this.currentPath}:page-${pageNum}`;
  }

  _saveHighlightsForPage(pageNum) {
    if (!this.currentPath || !window.electronAPI) return;
    const texts = this.persistentHighlights.get(pageNum) || [];
    window.electronAPI.setItem(this._highlightKey(pageNum), JSON.stringify(texts));
  }

  _loadHighlightsFromStorage() {
    if (!this.currentPath || !window.electronAPI || !this.pdfDoc) return;
    this.persistentHighlights = new Map();
    for (let p = 1; p <= this.pdfDoc.numPages; p++) {
      const raw = window.electronAPI.getItem(this._highlightKey(p));
      if (raw) {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 0) {
            this.persistentHighlights.set(p, arr);
          }
        } catch {}
      }
    }
  }

  // Resolves true when the document opened. On failure it reports a classified error through
  // onLoadError (the interface shows it) and resolves false.
  async load(path, viewState = null, options = {}) {
    this.onStatus("Loading PDF...");

    try {
      const task = pdfjsLib.getDocument({ url: toPdfSource(path), password: options.password });
      this.pdfDoc = await task.promise;
      this.currentPath = path;

      const nextPage = viewState?.pageNum || 1;
      const nextScale = viewState?.scale || 1.35;
      const nextMode = VIEW_MODES.has(viewState?.viewMode) ? viewState.viewMode : this.viewMode;

      this.pageNum = Math.max(1, Math.min(nextPage, this.pdfDoc.numPages));
      this.scale = Math.max(0.25, Math.min(nextScale, 5));
      this.viewMode = nextMode;
      this.scrollCacheKey = "";

      // Load persisted highlights from storage
      this._loadHighlightsFromStorage();

      this.onPathChange(fileName(path));
      this.updateControls();
      this.queueRender(this.pageNum);

      this.buildOutline();
      this.buildThumbnails();
      this.startIndexing();
      this.observeStage();
      this.onStatus("PDF loaded.");
      return true;
    } catch (error) {
      console.warn("PDF load failed:", path, error);
      this.pdfDoc = null;
      this.currentPath = path;
      this.updateControls();
      const { kind } = classifyLoadError(error);
      this.onStatus(kind === "password" || kind === "wrong-password" ? "This PDF is locked." : "This file could not be opened.");
      this.onLoadError?.({ kind, path, error });
      return false;
    }
  }

  
  async startIndexing() {
    if (!this.pdfDoc) return;

    const pagesText = [];

    for (let i = 1; i <= this.pdfDoc.numPages; i++) {
      const page = await this.pdfDoc.getPage(i);
      const content = await page.getTextContent();

      const text = content.items.map(item => item.str).join(" ");

      pagesText.push({
        page: i,
        text
      });
    }

    // send to backend
    const pdfId = await window.electronAPI.getPdfId(this.currentPath);
    await window.electronAPI.indexPDF({
      path: this.currentPath,
      pages: pagesText,
      pdfId: pdfId,
      storagePath: this.storagePath
    });
  }
  
  // Re-fits the page when the available space changes (window resized, panels opened, or the
  // reader becoming visible after the document loaded).
  observeStage() {
    if (this.stageObserver || !this.stageElement || typeof ResizeObserver === "undefined") return;
    let timer = null;
    this.stageObserver = new ResizeObserver(() => {
      const width = this.stageElement.clientWidth;
      if (!this.pdfDoc || width === 0 || this.fitMode === "actual") return;
      if (Math.abs(width - (this.renderedStageWidth || 0)) < 8) return;
      clearTimeout(timer);
      timer = setTimeout(() => this.queueRender(this.pageNum), 120);
    });
    this.stageObserver.observe(this.stageElement);
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
    // In the fit modes the page is sized to the window, so show the zoom that is really in use.
    const shownScale = this.fitMode !== "actual" && this.lastFit ? this.lastFit : this.scale;
    this.zoomInput.value = `${Math.round(shownScale * 100)}%`;

    if (!this.pdfDoc) {
      this.prevBtn.disabled = true;
      this.nextBtn.disabled = true;
      return;
    }

    const step = this.viewMode === "two" ? 2 : 1;
    this.prevBtn.disabled = this.pageNum <= 1;
    this.nextBtn.disabled = this.pageNum + step > this.pdfDoc.numPages;
    this.onViewChange?.(this.currentPath, this.getViewState());
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

  async findAndHighlight(action) {
    if (!this.pdfDoc) return;

    const text = typeof action === "string" ? action : String(action?.text || "").trim();
    if (!text) return;

    const requestedPage = Number(action?.page);
    const numPages = this.pdfDoc.numPages;
    const targetPages = new Set();

    const lowerTarget = text.toLowerCase();

    // Helper to add highlight to a page's persistentHighlights
    const addToPage = (p) => {
      if (!this.persistentHighlights.has(p)) this.persistentHighlights.set(p, []);
      const arr = this.persistentHighlights.get(p);
      if (!arr.some(e => String(e || '').toLowerCase() === lowerTarget)) {
        arr.push(text);
        this._saveHighlightsForPage(p); // persist to storage immediately
      }
      targetPages.add(p);
    };

    // If a requested page is provided and within range, first try that page
    if (Number.isFinite(requestedPage) && requestedPage >= 1 && requestedPage <= numPages) {
      const page = await this.pdfDoc.getPage(requestedPage);
      const content = await page.getTextContent();
      const pageText = content.items.map(i => String(i.str || '')).join(' ').toLowerCase();
      if (pageText.includes(lowerTarget)) {
        addToPage(requestedPage);
      } else {
        // fallback: search all pages
        for (let p = 1; p <= numPages; p += 1) {
          const pg = await this.pdfDoc.getPage(p);
          const c = await pg.getTextContent();
          const t = c.items.map(i => String(i.str || '')).join(' ').toLowerCase();
          if (t.includes(lowerTarget)) addToPage(p);
        }
      }
    } else {
      // No valid page requested: search across all pages
      for (let p = 1; p <= numPages; p += 1) {
        const pg = await this.pdfDoc.getPage(p);
        const c = await pg.getTextContent();
        const t = c.items.map(i => String(i.str || '')).join(' ').toLowerCase();
        if (t.includes(lowerTarget)) addToPage(p);
      }
    }

    // If no page matched, as a last resort add to current page
    if (targetPages.size === 0) {
      addToPage(this.pageNum);
    }

    // Re-apply highlights for visible pages depending on view mode
    try {
      if (this.viewMode === 'single') {
        if (this.textLayerDiv) this.applyHighlightsToLayer(this.textLayerDiv, this.pageNum);
      } else {
        // For two or scroll mode, find any rendered page cards and refresh their text layers
        if (this.multiView) {
          const cards = Array.from(this.multiView.querySelectorAll('.pdf-page-card'));
          for (const card of cards) {
            const pageNum = Number(card.dataset.page);
            const textLayer = card.querySelector('.pdf-page-text-layer');
            if (textLayer) this.applyHighlightsToLayer(textLayer, pageNum);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to reapply highlights after searching pages', e);
    }
  }

  applyHighlightsToLayer(textLayer, pageNum) {
    const texts = this.persistentHighlights.get(pageNum);
    if (!texts || texts.length === 0) return;

    const spans = Array.from(textLayer.querySelectorAll("span"));
    if (spans.length === 0) return;

    spans.forEach((span) => {
      if (span.dataset.rawText === undefined) {
        span.dataset.rawText = span.textContent || "";
      }
      span.textContent = span.dataset.rawText;
    });

    // We'll try a windowed span concatenation approach to find exact phrase matches.
    const maxWindow = 6; // combine up to 6 spans for cross-span matches

    const lowerSpans = spans.map(s => (s.dataset.rawText || "").toLowerCase());

    const markRange = (startIdx, startOff, endIdx, endOff) => {
      for (let i = startIdx; i <= endIdx; i += 1) {
        const span = spans[i];
        const text = span.dataset.rawText || "";
        const localStart = i === startIdx ? startOff : 0;
        const localEnd = i === endIdx ? endOff : text.length;
        const before = escapeHtml(text.slice(0, localStart));
        const middle = escapeHtml(text.slice(localStart, localEnd));
        const after = escapeHtml(text.slice(localEnd));
        span.innerHTML = `${before}<span class="ai-highlight active">${middle}</span>${after}`;
      }
    };

    texts.forEach((needle) => {
      const target = String(needle || "").trim().toLowerCase();
      if (!target || target.length < 2) return;

      // Try each start span index
      for (let i = 0; i < lowerSpans.length; i += 1) {
        let accum = "";
        for (let w = 0; w < maxWindow && (i + w) < lowerSpans.length; w += 1) {
          const j = i + w;
          const part = lowerSpans[j];
          const sep = accum.length === 0 ? '' : ' ';
          const combined = accum + sep + part;
          accum = combined;

          const found = combined.indexOf(target);
          if (found !== -1) {
            // Validate word boundaries for better precision when needle is simple word/phrase
            let ok = true;
            // If target contains non-word chars (spaces/punctuation), relax boundary checks
            if (/^[\w\s]+$/.test(target)) {
              const before = combined.charAt(found - 1) || '';
              const after = combined.charAt(found + target.length) || '';
              const isBeforeWord = /\w/.test(before);
              const isAfterWord = /\w/.test(after);
              if (isBeforeWord || isAfterWord) ok = false;
            }
            if (!ok) {
              // continue searching within this window by skipping this start
              continue;
            }
            // Determine offsets within spans
            // Walk to compute character indices in each span
            let remaining = found;
            let startIdx = i;
            let startOff = 0;
            for (let k = i; k <= j; k += 1) {
              const len = (lowerSpans[k] || '').length + (k === i ? 0 : 1); // account for single-space join
              if (remaining < len) {
                startIdx = k;
                startOff = (k === i) ? remaining : Math.max(0, remaining - 1);
                break;
              }
              remaining -= len;
            }

            const endPos = found + target.length;
            remaining = endPos;
            let endIdx = i;
            let endOff = 0;
            for (let k = i; k <= j; k += 1) {
              const len = (lowerSpans[k] || '').length + (k === i ? 0 : 1);
              if (remaining <= len) {
                endIdx = k;
                endOff = (k === i) ? remaining : Math.max(0, remaining - 1);
                break;
              }
              remaining -= len;
            }

            markRange(startIdx, startOff, endIdx, endOff);
            // after marking, move i forward to avoid nested matches
            i = j;
            break;
          }
        }
      }
    });
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

    this.renderedStageWidth = this.stageElement.clientWidth;
    const stageWidth = Math.max(320, this.stageElement.clientWidth - 36);
    const baseViewport = page.getViewport({ scale: 1 });

    if (this.viewMode === "two") {
      const target = (stageWidth - 16) / 2;
      const fit = target / baseViewport.width;
      return Math.max(0.2, Math.min(fit, 3));
    }

    const fit = stageWidth / baseViewport.width;
    if (mode === "width" || mode === "auto") {
      this.lastFit = Math.max(0.2, Math.min(fit, 3));
      return this.lastFit;
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

    await pdfjsLib.renderTextLayer({
      textContent,
      container: this.textLayerDiv,
      viewport,
      textDivs: []
    }).promise;

    this.applyHighlightsToLayer(this.textLayerDiv, this.pageNum);

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
    card.dataset.page = String(pageNum);
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

    await pdfjsLib.renderTextLayer({
      textContent,
      container: textLayer,
      viewport,
      textDivs: []
    }).promise;

    this.applyHighlightsToLayer(textLayer, pageNum);

    if (typeof this.onPageRendered === "function") {
      try {
        this.onPageRendered({ card, pageNum, viewport, mode: this.viewMode });
      } catch (e) {
        console.warn("onPageRendered failed", e);
      }
    }

    return card;
  }

  async collectHighlightBoxesByPage() {
    if (!this.pdfDoc) return {};
    const out = {};
    const pages = Array.from(this.persistentHighlights.keys());
    for (const pageNum of pages) {
      const texts = this.persistentHighlights.get(pageNum);
      if (!texts || texts.length === 0) continue;
      const boxes = await this.computeHighlightBoxesForPage(pageNum);
      if (boxes.length > 0) out[pageNum] = boxes;
    }
    return out;
  }

  async computeHighlightBoxesForPage(pageNum) {
    if (!this.pdfDoc) return [];
    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });

    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-10000px";
    container.style.top = "0";
    container.style.width = `${viewport.width}px`;
    container.style.height = `${viewport.height}px`;
    container.style.pointerEvents = "none";
    container.style.opacity = "0";

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;
    container.appendChild(textLayer);
    document.body.appendChild(container);

    const textContent = await page.getTextContent();
    await pdfjsLib.renderTextLayer({
      textContent,
      container: textLayer,
      viewport,
      textDivs: []
    }).promise;

    this.applyHighlightsToLayer(textLayer, pageNum);

    const layerRect = textLayer.getBoundingClientRect();
    const boxes = [];
    textLayer.querySelectorAll(".ai-highlight").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const nx = (r.left - layerRect.left) / viewport.width;
      const ny = (r.top - layerRect.top) / viewport.height;
      const nw = r.width / viewport.width;
      const nh = r.height / viewport.height;
      if (nw > 0 && nh > 0) boxes.push({ x: nx, y: ny, w: nw, h: nh });
    });

    container.remove();
    return boxes;
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
