/**
 * FindController – in-PDF text search with highlight & navigation.
 *
 * Works by scanning all visible .textLayer spans and wrapping matches
 * in <mark> elements with the .find-highlight / .find-current classes.
 */
export class FindController {
  constructor({ pdfController, findBar, findInput, findCount, findPrev, findNext, findClose, findCase }) {
    this.pdf        = pdfController;   // PdfController instance
    this.findBar    = findBar;
    this.findInput  = findInput;
    this.findCount  = findCount;
    this.findPrev   = findPrev;
    this.findNext   = findNext;
    this.findClose  = findClose;
    this.findCase   = findCase;

    this._matches   = [];   // Array of { node, start, end } objects
    this._current   = -1;
    this._markEls   = [];   // <mark> DOM elements currently in the page

    this._bindEvents();
  }

  // ── Public API ──────────────────────────────────────────────────────

  open() {
    this.findBar.style.display = 'flex';
    this.findInput.focus();
    this.findInput.select();
    this._run();
  }

  close() {
    this.findBar.style.display = 'none';
    this._clearMarks();
    this.findInput.classList.remove('find-no-match');
    this._matches = [];
    this._current = -1;
    this._updateCount();
  }

  // ── Private ─────────────────────────────────────────────────────────

  _bindEvents() {
    this.findClose.addEventListener('click', () => this.close());

    this.findInput.addEventListener('input', () => this._run());
    this.findCase.addEventListener('change', () => this._run());

    this.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.shiftKey ? this._step(-1) : this._step(1);
      }
      if (e.key === 'Escape') this.close();
    });

    this.findNext.addEventListener('click', () => this._step(1));
    this.findPrev.addEventListener('click', () => this._step(-1));
  }

  _run() {
    const query = this.findInput.value;
    this._clearMarks();
    this._matches = [];
    this._current = -1;

    if (!query) {
      this.findInput.classList.remove('find-no-match');
      this._updateCount();
      return;
    }

    const caseSensitive = this.findCase.checked;
    const flags = caseSensitive ? 'g' : 'gi';
    let safeQuery;
    try {
      safeQuery = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch {
      return;
    }

    // Collect all text nodes inside every visible text layer
    const textLayers = document.querySelectorAll('.textLayer');
    textLayers.forEach(layer => {
      this._highlightInLayer(layer, safeQuery);
    });

    // Visual feedback
    if (this._markEls.length === 0) {
      this.findInput.classList.add('find-no-match');
    } else {
      this.findInput.classList.remove('find-no-match');
      this._current = 0;
      this._scrollToMark(0);
    }

    this._updateCount();
  }

  _highlightInLayer(layer, regex) {
    // Walk all text nodes
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    // Process each text node
    textNodes.forEach(textNode => {
      const text = textNode.nodeValue;
      regex.lastIndex = 0;
      let match;
      const fragments = [];
      let lastIndex = 0;

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const mark = document.createElement('mark');
        mark.className = 'find-highlight';
        mark.textContent = match[0];
        fragments.push(mark);
        this._markEls.push(mark);
        lastIndex = regex.lastIndex;
      }

      if (fragments.length > 0) {
        if (lastIndex < text.length) {
          fragments.push(document.createTextNode(text.slice(lastIndex)));
        }
        const parent = textNode.parentNode;
        const ref = textNode.nextSibling;
        parent.removeChild(textNode);
        fragments.forEach(f => parent.insertBefore(f, ref));
      }
    });
  }

  _clearMarks() {
    // Un-wrap each <mark> back to plain text
    this._markEls.forEach(mark => {
      if (!mark.parentNode) return;
      const text = document.createTextNode(mark.textContent);
      mark.parentNode.replaceChild(text, mark);
    });
    this._markEls = [];

    // Normalise text nodes so the DOM stays clean
    document.querySelectorAll('.textLayer').forEach(layer => {
      try { layer.normalize(); } catch { /* ignore */ }
    });
  }

  _step(dir) {
    if (this._markEls.length === 0) return;
    // Remove current class from old
    if (this._current >= 0 && this._markEls[this._current]) {
      this._markEls[this._current].classList.remove('find-current');
    }
    this._current = (this._current + dir + this._markEls.length) % this._markEls.length;
    this._scrollToMark(this._current);
    this._updateCount();
  }

  _scrollToMark(index) {
    const mark = this._markEls[index];
    if (!mark) return;
    mark.classList.add('find-current');
    mark.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }

  _updateCount() {
    if (this._markEls.length === 0) {
      this.findCount.textContent = this.findInput.value ? '0 / 0' : '';
    } else {
      this.findCount.textContent = `${this._current + 1} / ${this._markEls.length}`;
    }
  }
}
