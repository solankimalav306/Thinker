import { escapeHtml, renderMarkdown } from "./safe-html.js";

export class NotesController {

  constructor(options) {
    this.notesList = options.notesList;
    this.onStatus = options.onStatus;
    this.notes = [];
    this.pdfPath = null;
  }

  async load(pdfPath) {
    this.pdfPath = pdfPath;
    if (window.electronAPI && window.electronAPI.loadNotes) {
      const loaded = await window.electronAPI.loadNotes(pdfPath);
      this.notes = Array.isArray(loaded) ? loaded : [];
      this.render();
    }
  }

  async save() {
    if (window.electronAPI && window.electronAPI.saveNotes && this.pdfPath) {
      await window.electronAPI.saveNotes(this.pdfPath, this.notes);
    }
  }


  async addNote(content, source = "Agent") {
    const note = {
      id: Date.now(),
      content,
      source,
      date: new Date().toISOString()
    };
    this.notes.push(note);
    await this.save();
    this.render();
    return note;
  }


  async removeNote(id) {
    this.notes = this.notes.filter(n => n.id !== id);
    await this.save();
    this.render();
  }

  render() {
    if (!this.notesList) return;
    this.notesList.innerHTML = "";

    if (this.notes.length === 0) {
      this.notesList.innerHTML = `
        <div class="notes-empty-state">
          <i class="fa-solid fa-book-open"></i>
          <p>No research notes yet.<br>Ask the AI assistant to summarize or take notes!</p>
        </div>`;
      return;
    }

    this.notes.forEach(note => {
      const el = document.createElement("div");
      el.className = "note-item";
      
      const date = new Date(note.date);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      
      // Using marked if available for rendering markdown in notes
      const contentHtml = renderMarkdown(note.content);

      el.innerHTML = `
        <div class="note-header">
          <div class="note-source-badge">${escapeHtml(note.source || 'Agent')}</div>
          <div class="note-date">${dateStr} · ${timeStr}</div>
          <button class="btn icon-btn note-remove" title="Remove note" style="margin-left:auto; opacity:0.6; padding:2px 4px; height:auto;">
            <i class="fa-solid fa-trash-can" style="font-size:0.75rem;"></i>
          </button>
        </div>
        <div class="note-content">${contentHtml}</div>
      `;

      el.querySelector(".note-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("Remove this research note?")) {
          this.removeNote(note.id);
        }
      });
      this.notesList.appendChild(el);
    });
  }


  getNotesMarkdown() {
    return this.notes.map(n => `## Note (${new Date(n.date).toLocaleString()})\n\n${n.content}`).join("\n\n---\n\n");
  }

  getNotesLatex() {
    let latex = "\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\title{Research Notes}\n\\begin{document}\n\\maketitle\n\n";
    this.notes.forEach(note => {
      latex += `\\section*{Note (${new Date(note.date).toLocaleString()})}\n`;
      // Very basic markdown to latex conversion
      let content = note.content
        .replace(/#/g, "\\#")
        .replace(/_/g, "\\_")
        .replace(/&/g, "\\&")
        .replace(/\n\n/g, "\\par\n")
        .replace(/\*\*(.*?)\*\*/g, "\\textbf{$1}")
        .replace(/\*(.*?)\*/g, "\\textit{$1}");
      latex += content + "\n\n";
    });
    latex += "\\end{document}";
    return latex;
  }

  printNotes() {
    const printWindow = window.open('', '_blank');
    const md = this.getNotesMarkdown();
    const html = renderMarkdown(md);
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Research Notes</title>
          <style>
            body { font-family: 'Figtree', 'Segoe UI', sans-serif; padding: 40px; color: #333; line-height: 1.6; }
            h2 { color: #2563eb; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-top: 30px; }
            hr { border: 0; border-top: 1px solid #eee; margin: 40px 0; }
          </style>
        </head>
        <body>
          <h1>Research Notes</h1>
          ${html}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  }
}
