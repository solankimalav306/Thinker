import { escapeHtml } from "./safe-html.js";

export class DictionaryTooltip {
  constructor(options) {
    this.onAddGlossary = options.onAddGlossary;
    this.tooltipEl = null;
  }

  show(x, y, data) {
    this.hide(); // Remove existing

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'dict-tooltip';
    this.tooltipEl.innerHTML = `
      <div class="dict-header">
        <div class="dict-term">${escapeHtml(data.term)}</div>
        <button class="dict-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="dict-source">Source: ${data.source === 'llm' ? 'Context-aware AI' : 'Dictionary API'}</div>
      <div class="dict-def">${escapeHtml(data.definition)}</div>
      <div class="dict-actions">
        <button class="dict-btn primary add-to-glossary-btn"><i class="fa-solid fa-plus"></i> Add to Glossary</button>
      </div>
    `;

    document.body.appendChild(this.tooltipEl);

    // Position
    this.tooltipEl.style.left = `${x}px`;
    this.tooltipEl.style.top = `${y}px`;

    // Ensure it's in view
    const rect = this.tooltipEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        this.tooltipEl.style.left = `${window.innerWidth - rect.width - 20}px`;
    }
    if (rect.bottom > window.innerHeight) {
        // Try to show it ABOVE the click point if it would go off bottom
        const top = y - rect.height - 10;
        if (top > 0) {
            this.tooltipEl.style.top = `${top}px`;
        } else {
            this.tooltipEl.style.top = `${window.innerHeight - rect.height - 20}px`;
        }
    }

    this.tooltipEl.querySelector('.dict-close').addEventListener('click', () => this.hide());
    this.tooltipEl.querySelector('.add-to-glossary-btn').addEventListener('click', () => {
        this.onAddGlossary(data);
        this.hide();
    });

    // Close on click outside
    const clickOutside = (e) => {
        if (this.tooltipEl && !this.tooltipEl.contains(e.target)) {
            this.hide();
            document.removeEventListener('mousedown', clickOutside);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', clickOutside), 10);
  }

  hide() {
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
  }
}
