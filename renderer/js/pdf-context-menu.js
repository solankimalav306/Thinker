export class PdfContextMenu {
  constructor(options) {
    this.container = options.container;
    this.onDefine = options.onDefine;
    this.onAddToGlossary = options.onAddToGlossary;
    this.onAddToNotes = options.onAddToNotes;
    
    this.menuEl = this.createMenuElement();
    document.body.appendChild(this.menuEl);
    
    this.initListeners();
  }
  
  createMenuElement() {
    const div = document.createElement('div');
    div.id = 'pdf-custom-context-menu';
    div.className = 'custom-context-menu';
    div.style.display = 'none';
    div.innerHTML = `
      <div class="menu-item" data-action="define"><i class="fa-solid fa-book"></i> Define</div>
      <div class="menu-item" data-action="glossary"><i class="fa-solid fa-plus"></i> Add to Glossary</div>
      <div class="menu-item" data-action="note"><i class="fa-solid fa-note-sticky"></i> Add to Notes</div>
    `;
    return div;
  }
  
  initListeners() {
    this.container.addEventListener('contextmenu', (e) => {
      // Check if we are over a text layer
      const isTextLayer = e.target.closest('.textLayer');
      if (!isTextLayer) return;

      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      
      if (selectedText) {
        e.preventDefault();
        this.show(e.pageX, e.pageY, selectedText);
      }
    });
    
    document.addEventListener('mousedown', (e) => {
      if (!this.menuEl.contains(e.target)) {
        this.hide();
      }
    });
    
    this.menuEl.addEventListener('click', (e) => {
      const item = e.target.closest('.menu-item');
      if (!item) return;
      
      const action = item.dataset.action;
      const text = this.menuEl.dataset.text;
      const context = this.menuEl.dataset.context;
      const x = parseFloat(this.menuEl.style.left);
      const y = parseFloat(this.menuEl.style.top);
      
      if (action === 'define') this.onDefine(text, context, x, y);
      if (action === 'glossary') this.onAddToGlossary(text, context, x, y);
      if (action === 'note') this.onAddToNotes(text, context, x, y);
      
      this.hide();
    });
  }
  
  show(x, y, text) {
    // Get context: surrounding paragraph/text
    const selection = window.getSelection();
    let context = "";
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // In PDF.js, text is often in many small divs. 
      // A simple way to get "context" is to look at the parent container's text
      const parent = range.commonAncestorContainer.parentElement;
      if (parent) {
          // Try to get a bit more than just the immediate parent if it's too short
          let container = parent;
          if (container.textContent.length < 50 && container.parentElement && container.parentElement.classList.contains('textLayer')) {
              context = container.parentElement.textContent.substring(0, 500); // Grab a chunk
          } else {
              context = container.textContent;
          }
      }
    }

    this.menuEl.style.left = `${x}px`;
    this.menuEl.style.top = `${y}px`;
    this.menuEl.style.display = 'block';
    this.menuEl.dataset.text = text;
    this.menuEl.dataset.context = context;

    // Ensure menu is within viewport
    const rect = this.menuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        this.menuEl.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
        this.menuEl.style.top = `${window.innerHeight - rect.height - 10}px`;
    }
  }
  
  hide() {
    this.menuEl.style.display = 'none';
  }
}
