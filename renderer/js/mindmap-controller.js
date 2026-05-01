export class MindMapController {
  constructor(options) {
    this.modal = options.modal;
    this.viewer = options.viewer;
    this.closeBtn = options.closeBtn;
    this.exportBtn = options.exportBtn;
    this.onStatus = options.onStatus;

    if (window.mermaid) {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
          primaryColor: '#2563eb',
          primaryTextColor: '#fff',
          primaryBorderColor: '#1e40af',
          lineColor: '#64748b',
          secondaryColor: '#f1f5f9',
          tertiaryColor: '#fff'
        }
      });
    }

    this.closeBtn.addEventListener('click', () => this.hide());
    this.exportBtn.addEventListener('click', (e) => this.showExportMenu(e));
    
    // Close on outside click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.hide();
    });
  }

  showExportMenu(e) {
    // Create a small popup menu with export options
    const menu = document.createElement('div');
    menu.className = 'mindmap-export-menu';
    menu.style.position = 'absolute';
    menu.style.zIndex = 9999;
    menu.style.background = 'var(--panel-bg)';
    menu.style.border = '1px solid var(--border-color)';
    menu.style.padding = '6px';
    menu.style.borderRadius = '6px';
    menu.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';

    const opts = [
      { label: 'Export SVG', action: () => this.exportSvg() },
      { label: 'Export PNG', action: () => this.exportImage('png') },
      { label: 'Export JPG', action: () => this.exportImage('jpg') },
      { label: 'Print / Save as PDF...', action: () => this.exportPdf() }
    ];

    opts.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.style.display = 'block';
      btn.style.width = '160px';
      btn.style.margin = '6px 0';
      btn.textContent = o.label;
      btn.addEventListener('click', () => {
        o.action();
        document.body.removeChild(menu);
      });
      menu.appendChild(btn);
    });

    // Position near the export button
    const rect = this.exportBtn.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 8}px`;
    document.body.appendChild(menu);

    const removeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        try { document.body.removeChild(menu); } catch (e) {}
        window.removeEventListener('click', removeMenu);
      }
    };
    window.addEventListener('click', removeMenu);
  }

  async show(code) {
    if (!window.mermaid) {
      this.onStatus("Mermaid.js not loaded.");
      return;
    }

    // Clean up code (LLM might return markdown blocks)
    let cleanCode = code.trim();
    if (cleanCode.includes("```mermaid")) {
      cleanCode = cleanCode.split("```mermaid")[1].split("```")[0].trim();
    } else if (cleanCode.includes("```")) {
      cleanCode = cleanCode.split("```")[1].split("```")[0].trim();
    }

    this.onStatus("Rendering mind map...");
    this.modal.style.display = 'block';
    this.viewer.innerHTML = `<pre class="mermaid">${cleanCode}</pre>`;
    
    try {
      await window.mermaid.run({
        nodes: [this.viewer]
      });
      this.onStatus("Mind map rendered.");
    } catch (error) {
      console.error("Mermaid render failed", error);
      this.viewer.innerHTML = `<div style="color: red; padding: 20px;">Failed to render mind map. Check console for details.</div>`;
      this.onStatus("Mind map rendering failed.");
    }
  }

  hide() {
    this.modal.style.display = 'none';
  }

  exportSvg() {
    const svg = this.viewer.querySelector('svg');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mindmap.svg';
    a.click();
    URL.revokeObjectURL(url);
    this.onStatus("Mind map exported as SVG.");
  }

  async exportImage(format = 'png') {
    const svg = this.viewer.querySelector('svg');
    if (!svg) return;

    const serializer = new XMLSerializer();
    const svgData = serializer.serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--panel-bg') || '#fff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img, 0, 0);

      canvas.toBlob((blob) => {
        const a = document.createElement('a');
        const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
        const ext = format === 'jpg' ? 'jpg' : 'png';
        const fileName = `mindmap.${ext}`;
        const url2 = URL.createObjectURL(blob);
        a.href = url2;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url2);
        URL.revokeObjectURL(url);
        this.onStatus(`Mind map exported as ${ext.toUpperCase()}.`);
      }, format === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
    };
    img.onerror = (e) => {
      console.error('Image load failed', e);
      URL.revokeObjectURL(url);
      this.onStatus('Failed to create image from mind map.');
    };
    img.src = url;
  }

  exportPdf() {
    // Fallback approach: open printed view with the SVG rendered as an image,
    // user can use the print dialog to save as PDF.
    const svg = this.viewer.querySelector('svg');
    if (!svg) return;
    const serializer = new XMLSerializer();
    const svgData = serializer.serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const win = window.open('', '_blank');
    if (!win) {
      this.onStatus('Unable to open print window (popup blocked).');
      return;
    }
    win.document.write(`<html><head><title>Mind Map — Print</title></head><body style="margin:0; padding:10px; background:#fff;"></body></html>`);
    const img = win.document.createElement('img');
    img.onload = () => {
      setTimeout(() => { try { win.print(); } catch (e) { console.error(e); } }, 300);
    };
    img.src = url;
    win.document.body.appendChild(img);
    this.onStatus('Opened print dialog for PDF export.');
  }
}
