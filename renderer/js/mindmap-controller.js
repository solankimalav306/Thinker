export class MindMapController {
  constructor(options) {
    this.modal = options.modal;
    this.viewer = options.viewer;
    this.closeBtn = options.closeBtn;
    this.exportBtn = options.exportBtn;
    this.listContainer = options.listContainer;
    this.onStatus = options.onStatus || (() => {});
    this.mm = null;
    this.mindmaps = [];
    this.pdfPath = null;

    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.hide());
    if (this.exportBtn) this.exportBtn.addEventListener('click', (e) => this.showExportMenu(e));
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.hide();
      });
    }

    if (window.markmap && window.markmap.Transformer) {
      this.transformer = new window.markmap.Transformer();
    }
  }

  async load(pdfPath) {
    this.pdfPath = pdfPath;
    if (window.electronAPI && window.electronAPI.loadMindmaps) {
      const loaded = await window.electronAPI.loadMindmaps(pdfPath);
      this.mindmaps = Array.isArray(loaded) ? loaded : [];
      this.renderList();
    }
  }

  async save(code, title = "New Mind Map") {
    if (window.electronAPI && window.electronAPI.saveMindmap && this.pdfPath) {
      const mindmap = {
        id: String(Date.now()),
        code,
        title: title || "New Mind Map",
        createdAt: new Date().toISOString()
      };
      const res = await window.electronAPI.saveMindmap(this.pdfPath, mindmap);
      if (res.ok) {
        // If it was an update, it might already be in the list
        const idx = this.mindmaps.findIndex(m => m.id === res.result.id);
        if (idx > -1) this.mindmaps[idx] = res.result;
        else this.mindmaps.push(res.result);
        this.renderList();
      }
    }
  }

  async delete(id) {
    if (window.electronAPI && window.electronAPI.deleteMindmap && this.pdfPath) {
      await window.electronAPI.deleteMindmap(this.pdfPath, id);
      this.mindmaps = this.mindmaps.filter(m => m.id !== id);
      this.renderList();
    }
  }

  renderList() {
    if (!this.listContainer) return;
    this.listContainer.innerHTML = "";

    if (this.mindmaps.length === 0) {
      this.listContainer.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--text-soft); font-size: 0.8rem;">No mind maps yet. Ask the AI to create one!</div>`;
      return;
    }

    // Sort by newest first
    const sorted = [...this.mindmaps].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    sorted.forEach(map => {
      const el = document.createElement("div");
      el.className = "mindmap-item";
      el.style.cssText = `
        background: var(--panel-soft);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
      `;
      
      const date = new Date(map.createdAt).toLocaleDateString();
      el.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
          <div style="flex: 1;">
            <div style="font-weight: 700; font-size: 0.9rem; color: var(--accent); margin-bottom: 4px;">${map.title || "Untitled Map"}</div>
            <div style="font-size: 0.7rem; color: var(--text-soft);">${date}</div>
          </div>
          <button class="btn icon-btn delete-btn" style="padding: 4px; color: var(--text-soft);"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      `;

      el.addEventListener('click', (e) => {
        if (e.target.closest('.delete-btn')) {
          e.stopPropagation();
          if (confirm("Delete this mind map?")) this.delete(map.id);
          return;
        }
        this.show(map.code, false); // Don't save again when viewing
      });

      // Hover effect
      el.onmouseenter = () => { el.style.borderColor = "var(--accent)"; el.style.transform = "translateY(-2px)"; el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)"; };
      el.onmouseleave = () => { el.style.borderColor = "var(--line)"; el.style.transform = "translateY(0)"; el.style.boxShadow = "none"; };

      this.listContainer.appendChild(el);
    });
  }

  showExportMenu(e) {
    const menu = document.createElement('div');
    menu.className = 'mindmap-export-menu';
    menu.style.position = 'absolute';
    menu.style.zIndex = 9999;
    menu.style.background = 'var(--panel-bg)';
    menu.style.border = '1px solid var(--border-color)';
    menu.style.padding = '8px';
    menu.style.borderRadius = '8px';
    menu.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)';

    const opts = [
      { label: '<i class="fa-solid fa-file-code"></i> Export as SVG', action: () => this.exportSvg() },
      { label: '<i class="fa-solid fa-file-image"></i> Export as PNG', action: () => this.exportImage('png') },
      { label: '<i class="fa-solid fa-file-image"></i> Export as JPG', action: () => this.exportImage('jpg') },
      { label: '<i class="fa-solid fa-print"></i> Print / Save as PDF...', action: () => this.exportPdf() }
    ];

    opts.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '8px';
      btn.style.width = '200px';
      btn.style.margin = '4px 0';
      btn.style.justifyContent = 'flex-start';
      btn.innerHTML = o.label;
      btn.addEventListener('click', () => {
        o.action();
        document.body.removeChild(menu);
      });
      menu.appendChild(btn);
    });

    const rect = this.exportBtn.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 12}px`;
    document.body.appendChild(menu);

    const removeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        try { document.body.removeChild(menu); } catch (e) {}
        window.removeEventListener('mousedown', removeMenu);
      }
    };
    window.addEventListener('mousedown', removeMenu);
  }

  async show(code, shouldSave = true) {
    if (!code) return;

    if (this.modal) this.modal.style.display = 'block';

    if (!window.markmap) {
      this.onStatus("Markmap library not loaded.");
      if (this.viewer) this.viewer.innerHTML = '<div style="padding: 20px; color: red;">Markmap engine failed to load. Check your connection.</div>';
      return;
    }

    if (!this.transformer) {
      try {
        console.debug('Attempting to find Markmap Transformer. window.markmap keys:', window.markmap ? Object.keys(window.markmap) : 'null');
        
        // Self-healing: if markmap.lib exists but markmap.Transformer doesn't, bridge them
        if (window.markmap && window.markmap.lib && !window.markmap.Transformer) {
          console.debug('Bridging window.markmap.lib to window.markmap');
          window.markmap.Transformer = window.markmap.lib.Transformer;
        }

        const T = window.markmap?.Transformer || 
                 window.markmap?.lib?.Transformer;
        
        if (T) {
          this.transformer = new T();
          console.debug('Markmap Transformer initialized successfully.');
        } else {
          const keys = window.markmap ? JSON.stringify(Object.keys(window.markmap)) : 'null';
          console.error("Markmap Transformer not found. Global 'markmap' keys:", keys);
          this.onStatus("Mind map engine missing.");
          if (this.viewer) {
            this.viewer.innerHTML = `
              <div style="padding: 20px; color: #ef4444; background: #fee2e2; border-radius: 8px; margin: 20px; border: 1px solid #fecaca;">
                <h4 style="margin-top:0">Mind Map Engine Error</h4>
                <p>The <code>Transformer</code> class was not found in the Markmap library.</p>
                <p style="font-size: 0.8rem; color: #991b1b;">Available components: ${keys}</p>
                <button class="btn" onclick="location.reload()" style="margin-top:10px">Reload Application</button>
              </div>
            `;
          }
          return;
        }
      } catch (e) {
        console.error("Markmap Transformer init failed", e);
        this.onStatus("Mind map engine failed to start.");
        return;
      }
    }

    // Robust code extraction
    let cleanCode = String(code || '').trim();
    if (cleanCode.includes("```")) {
      const blocks = cleanCode.split("```").filter((_, i) => i % 2 === 1);
      // Pick the block that looks most like a markdown list or has headers
      cleanCode = blocks.find(b => b.includes('- ') || b.includes('# ')) || blocks[0] || '';
      // Strip language hints
      cleanCode = cleanCode.replace(/^(markdown|mermaid|mindmap|md)\n/i, '').trim();
    }
    
    // Normalize indentation (replace tabs with 2 spaces)
    cleanCode = cleanCode.replace(/\t/g, '  ');

    console.debug('Rendering mindmap with Markmap:', cleanCode);
    this.onStatus("Generating organic mind map...");
    this.modal.style.display = 'block';
    
    try {
      this.viewer.innerHTML = '';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'markmap-canvas';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.minHeight = '600px';
      svg.style.background = 'transparent';
      this.viewer.appendChild(svg);

      const { root } = this.transformer.transform(cleanCode);
      
      // Inject custom styles for dark UI theme + recursive color coding
      const existingStyle = document.getElementById('markmap-custom-styles');
      if (existingStyle) existingStyle.remove(); // Always refresh styles
      const style = document.createElement('style');
      style.id = 'markmap-custom-styles';
      style.textContent = `
        .markmap-node { cursor: pointer; }
        .markmap-node circle {
          r: 5;
          fill: var(--accent);
          stroke: none;
        }
        .markmap-node text {
          font-family: 'Manrope', 'Inter', sans-serif !important;
          font-size: 13px !important;
          font-weight: 500;
          fill: var(--text) !important;
        }
        .markmap-node[data-depth="0"] text {
          font-size: 18px !important;
          font-weight: 800 !important;
          fill: var(--accent) !important;
          letter-spacing: 0.5px;
        }
        .markmap-node[data-depth="1"] text {
          font-size: 14px !important;
          font-weight: 700 !important;
          fill: var(--text) !important;
        }
        .markmap-link {
          fill: none;
          stroke-opacity: 0.6;
          stroke-width: 2px !important;
        }
        .markmap-node:hover text { fill: var(--accent) !important; }
      `;
      document.head.appendChild(style);

      // Pre-calculate branch colors to ensure stability and recursion
      const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
      const getBranchColor = (node) => {
        if (node.depth === 0) return 'var(--accent)';
        let curr = node;
        while (curr.depth > 1 && curr.parent) curr = curr.parent;
        // Use a stable index from root children
        const branchIndex = root.children ? root.children.indexOf(curr) : 0;
        return palette[branchIndex % palette.length] || '#888';
      };

      if (window.markmap && window.markmap.view && !window.markmap.Markmap) {
        window.markmap.Markmap = window.markmap.view.Markmap || window.markmap.view.View;
      }

      const MarkmapClass = window.markmap.Markmap || window.markmap.View || 
                          (window.markmap.view && (window.markmap.view.Markmap || window.markmap.view.View));
      
      if (!MarkmapClass) {
        throw new Error("Markmap rendering class (Markmap/View) not found. Keys: " + JSON.stringify(Object.keys(window.markmap)));
      }

      this.mm = MarkmapClass.create(svg, {
        autoFit: true,
        padding: [40, 40, 40, 40],
        duration: 600,
        maxWidth: 250,
        initialExpandLevel: -1, // Expand all levels
        color: (node) => getBranchColor(node)
      }, root);

      this.onStatus("Mind map rendered.");

      // Automatically save if this is a new generation
      if (shouldSave) {
        // Extract title from root node
        const title = root.content || "Mind Map";
        await this.save(cleanCode, title);
      }
    } catch (error) {
      console.error("Markmap render failed", error);
      this.viewer.innerHTML = `<div style="color: red; padding: 20px;">Failed to render mind map. ${error.message}</div>`;
      this.onStatus("Mind map rendering failed.");
    }
  }

  hide() {
    this.modal.style.display = 'none';
  }

  exportSvg() {
    const svg = this.viewer.querySelector('svg');
    if (!svg) return;

    const clonedSvg = svg.cloneNode(true);
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clonedSvg.style.background = 'white';
    
    const styles = document.getElementById('markmap-custom-styles')?.textContent || '';
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = styles;
    clonedSvg.insertBefore(styleEl, clonedSvg.firstChild);

    const serializer = new XMLSerializer();
    let svgData = serializer.serializeToString(clonedSvg);
    if (!svgData.startsWith('<?xml')) {
      svgData = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgData;
    }

    if (window.electronAPI?.saveTextFile) {
      window.electronAPI.saveTextFile({
        defaultPath: 'mindmap.svg',
        content: svgData,
        filters: [{ name: 'SVG', extensions: ['svg'] }]
      }).then((result) => { if (result?.ok) this.onStatus('Mind map exported as SVG.'); });
      return;
    }

    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mindmap.svg';
    a.click();
    URL.revokeObjectURL(url);
    this.onStatus('Mind map exported as SVG.');
  }

  async exportImage(format = 'png') {
    const svg = this.viewer.querySelector('svg');
    if (!svg) return;

    const bbox = svg.getBBox();
    const padding = 40;
    const width = bbox.width + padding * 2;
    const height = bbox.height + padding * 2;

    const clonedSvg = svg.cloneNode(true);
    clonedSvg.setAttribute('viewBox', `${bbox.x - padding} ${bbox.y - padding} ${width} ${height}`);
    clonedSvg.setAttribute('width', width);
    clonedSvg.setAttribute('height', height);
    
    const styles = document.getElementById('markmap-custom-styles')?.textContent || '';
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = styles;
    clonedSvg.insertBefore(styleEl, clonedSvg.firstChild);

    const serializer = new XMLSerializer();
    const svgData = serializer.serializeToString(clonedSvg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; 
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);

      canvas.toBlob((blob) => {
        const a = document.createElement('a');
        const ext = format === 'jpg' ? 'jpg' : 'png';
        const url2 = URL.createObjectURL(blob);
        a.href = url2;
        a.download = `mindmap.${ext}`;
        a.click();
        URL.revokeObjectURL(url2);
        URL.revokeObjectURL(url);
        this.onStatus(`Mind map exported as ${ext.toUpperCase()}.`);
      }, format === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
    };
    img.src = url;
  }

  exportPdf() {
    const svg = this.viewer.querySelector('svg');
    if (!svg) return;
    this.exportImage('png').then(() => {
      this.onStatus('Mind map exported as image (Best for PDF insertion).');
    });
  }
}
