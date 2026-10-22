import { escapeHtml } from "./safe-html.js";

export class HistoryController {
  constructor(options) {
    this.list = options.list;
    this.onRevert = options.onRevert;
    this.onStatus = options.onStatus || (() => {});
    this.getPdfPath = options.getPdfPath;
    this.entries = [];
  }

  getStorageKey(pdfPath) {
    return `pdf-history:${pdfPath}`;
  }

  load(pdfPath) {
    if (!pdfPath) {
      this.entries = [];
      this.render();
      return;
    }
    const raw = window.electronAPI.getItem(this.getStorageKey(pdfPath));
    try {
      const parsed = JSON.parse(raw || "[]");
      this.entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.entries = [];
    }
    this.render();
  }

  save(pdfPath) {
    if (!pdfPath) return;
    window.electronAPI.setItem(this.getStorageKey(pdfPath), JSON.stringify(this.entries));
  }

  addSnapshot(pdfPath, snapshot) {
    if (!pdfPath || !snapshot) return;
    const entry = {
      id: snapshot.id || String(Date.now()),
      timestamp: snapshot.timestamp || Date.now(),
      label: snapshot.label || "Annotated Save",
      options: snapshot.options || {},
      annotationsByPage: snapshot.annotationsByPage || {},
      highlightTextsByPage: snapshot.highlightTextsByPage || {},
      highlightBoxesByPage: snapshot.highlightBoxesByPage || {}
    };
    this.entries.unshift(entry);
    // keep last 20
    this.entries = this.entries.slice(0, 20);
    this.save(pdfPath);
    this.render();
  }

  removeEntry(pdfPath, id) {
    this.entries = this.entries.filter(e => e.id !== id);
    this.save(pdfPath);
    this.render();
  }

  render() {
    if (!this.list) return;
    this.list.innerHTML = '';

    if (!this.entries || this.entries.length === 0) {
      this.list.innerHTML = `
        <div class="history-empty">
          <i class="fa-solid fa-clock-rotate-left"></i>
          <p>No history yet.<br>A snapshot is kept each time you save your marks.</p>
        </div>`;
      return;
    }

    this.entries.forEach((entry, idx) => {
      const isLatest = idx === 0;
      const date = new Date(entry.timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });

      // Count what's in this snapshot
      const pages = Object.keys(entry.annotationsByPage || {});
      const strokeCount = pages.reduce((sum, p) => {
        const d = entry.annotationsByPage[p];
        return sum + (Array.isArray(d?.paths) ? d.paths.length : 0);
      }, 0);
      const stickyCount = pages.reduce((sum, p) => {
        const d = entry.annotationsByPage[p];
        return sum + (Array.isArray(d?.stickyNotes) ? d.stickyNotes.length : 0);
      }, 0);
      const hlPages = Object.keys(entry.highlightTextsByPage || {}).length;

      // Build badges
      let badgesHtml = '';
      if (strokeCount > 0) badgesHtml += `<span class="history-badge"><i class="fa-solid fa-pen"></i> ${strokeCount}</span>`;
      if (hlPages > 0)     badgesHtml += `<span class="history-badge"><i class="fa-solid fa-highlighter"></i> ${hlPages}p</span>`;
      if (stickyCount > 0) badgesHtml += `<span class="history-badge"><i class="fa-solid fa-note-sticky"></i> ${stickyCount}</span>`;

      const el = document.createElement('div');
      el.className = 'history-entry';
      el.innerHTML = `
        <div class="history-entry-dot" title="${isLatest ? 'Latest' : ''}">
          <i class="fa-solid ${isLatest ? 'fa-circle-dot' : 'fa-circle'}"></i>
        </div>
        <div class="history-entry-body">
          <div class="history-entry-title">${escapeHtml(entry.label || 'Saved marks')}</div>
          <div class="history-entry-meta">
            <span class="history-entry-time">${dateStr} · ${timeStr}</span>
            <div class="history-entry-badges">
              ${badgesHtml}
              <button class="btn history-revert-btn" title="Revert to this state">
                <i class="fa-solid fa-rotate-left"></i> Revert
              </button>
            </div>
          </div>
        </div>`;

      // Revert button
      el.querySelector('.history-revert-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onRevert) this.onRevert(entry);
      });

      // Delete on body right-click
      const body = el.querySelector('.history-entry-body');
      body.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm(`Delete history entry "${entry.label}"?`)) {
          this.removeEntry(this.getPdfPath(), entry.id);
        }
      });

      this.list.appendChild(el);
    });
  }
}
