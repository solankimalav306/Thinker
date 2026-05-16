export class StickyNotesController {
  constructor(options) {
    this.list = options.list;
    this.annotation = options.annotation; // reference to AnnotationController
    this.pdf = options.pdf; // reference to PdfController
    this.onStatus = options.onStatus || (() => {});
  }

  async refresh() {
    if (!this.annotation) return;
    const byPage = this.annotation.collectDocumentAnnotations();
    const flat = [];
    Object.keys(byPage || {}).forEach((pageKey) => {
      const page = Number(pageKey);
      const data = byPage[page] || {};
      const sticky = Array.isArray(data.stickyNotes) ? data.stickyNotes : [];
      sticky.forEach((note, idx) => {
        flat.push({
          id: `${page}-${idx}-${note.date || 0}`,
          page,
          text: note.text,
          x: note.x,
          y: note.y,
          date: note.date || Date.now()
        });
      });
    });

    this.stickyList = flat.sort((a, b) => b.date - a.date);
    this.render();
  }

  render() {
    if (!this.list) return;
    this.list.innerHTML = "";
    
    if (!this.stickyList || this.stickyList.length === 0) {
      this.list.innerHTML = `
        <div class="notes-empty-state">
          <i class="fa-solid fa-note-sticky"></i>
          <p>No sticky notes on this PDF.<br>Use the toolbar to add your own!</p>
        </div>`;
      return;
    }

    this.stickyList.forEach((note) => {
      const el = document.createElement('div');
      el.className = 'sticky-sidebar-item';
      
      el.innerHTML = `
        <div class="sticky-sidebar-icon">
          <i class="fa-solid fa-note-sticky"></i>
        </div>
        <div class="sticky-sidebar-content">
          <div class="sticky-sidebar-page">Page ${note.page}</div>
          <div class="sticky-sidebar-text">${this.escapeHtml(note.text)}</div>
        </div>
        <button class="sticky-sidebar-remove" title="Remove note">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      `;

      el.addEventListener('click', () => {
        if (this.pdf && typeof this.pdf.jumpToPage === 'function') {
          this.pdf.jumpToPage(note.page);
        }
      });

      el.querySelector(".sticky-sidebar-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("Delete this sticky note?")) {
          this.remove(note);
        }
      });

      this.list.appendChild(el);
    });
  }

  escapeHtml(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async remove(note) {
    const page = Number(note.page) || 1;
    const keyData = this.annotation.getStorageData(page);
    const sticky = Array.isArray(keyData.stickyNotes) ? keyData.stickyNotes : [];
    const idx = sticky.findIndex(s => (s.date || 0) === (note.date || 0) && String(s.text || '') === String(note.text || ''));
    
    if (idx !== -1) {
      sticky.splice(idx, 1);
      keyData.stickyNotes = sticky;
      window.electronAPI.setItem(this.annotation.getStorageKeyForPage(page), JSON.stringify(keyData));
      this.annotation.loadPageAnnotations(page);
      await this.refresh();
      this.onStatus('Sticky note removed.');
    } else {
      this.onStatus('Could not find sticky note to remove.');
    }
  }
}


function escapeHtmlShort(v, max) {
  const s = String(v || '');
  const truncated = s.length > max ? s.slice(0, max - 1) + '…' : s;
  return (truncated
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;'));
}

function escapeHtmlFull(v) {
  return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
