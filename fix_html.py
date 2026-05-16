#!/usr/bin/env python3
"""Replace save modal and add new elements in index.html"""

with open('renderer/index.html', 'rb') as f:
    data = f.read()

# Find boundaries of the save-modal div
idx = data.find(b'save-modal')
open_div_idx = data.rfind(b'<div', 0, idx)
print(f'Opening div at: {open_div_idx}')

# Count nested divs to find closing
i = open_div_idx
depth = 0
end_idx = None
while i < len(data):
    if data[i:i+4] == b'<div':
        depth += 1
        i += 4
    elif data[i:i+6] == b'</div>':
        depth -= 1
        if depth == 0:
            end_idx = i + 6
            break
        i += 6
    else:
        i += 1

if end_idx is None:
    print("ERROR: Could not find end of modal")
    exit(1)

print(f'Old modal from {open_div_idx} to {end_idx}, length {end_idx - open_div_idx}')

new_modal = (
    '  <div id="save-modal" class="modal-overlay" style="display:none;">\r\n'
    '    <div class="save-modal-card">\r\n'
    '      <div class="save-modal-header">\r\n'
    '        <div class="save-modal-title">\r\n'
    '          <i class="fa-solid fa-file-pdf" style="color: var(--accent); font-size: 1.5rem;"></i>\r\n'
    '          <div>\r\n'
    '            <div style="font-size: 1rem; font-weight: 700;">Export Annotated PDF</div>\r\n'
    '            <div style="font-size: 0.75rem; color: var(--text-soft);">Choose what to include in your exported document</div>\r\n'
    '          </div>\r\n'
    '        </div>\r\n'
    '        <button class="btn icon-btn" id="save-modal-close"><i class="fa-solid fa-xmark"></i></button>\r\n'
    '      </div>\r\n'
    '      <div class="save-modal-body">\r\n'
    '        <div class="save-modal-options">\r\n'
    '          <div class="save-option-group">\r\n'
    '            <div class="save-option-group-label"><i class="fa-solid fa-pen"></i> Annotations</div>\r\n'
    '            <div class="save-option-row">\r\n'
    '              <div class="save-option-info">\r\n'
    '                <span class="save-option-name">Pen &amp; Highlighter strokes</span>\r\n'
    '                <span class="save-option-desc">Your manual drawings on the PDF</span>\r\n'
    '              </div>\r\n'
    '              <label class="toggle-switch">\r\n'
    '                <input type="checkbox" id="save-opt-pen" checked>\r\n'
    '                <span class="toggle-slider"></span>\r\n'
    '              </label>\r\n'
    '            </div>\r\n'
    '            <div class="save-option-row">\r\n'
    '              <div class="save-option-info">\r\n'
    '                <span class="save-option-name">AI Highlights</span>\r\n'
    '                <span class="save-option-desc">Text highlighted by the AI assistant</span>\r\n'
    '              </div>\r\n'
    '              <label class="toggle-switch">\r\n'
    '                <input type="checkbox" id="save-opt-highlights" checked>\r\n'
    '                <span class="toggle-slider"></span>\r\n'
    '              </label>\r\n'
    '            </div>\r\n'
    '          </div>\r\n'
    '          <div class="save-option-group">\r\n'
    '            <div class="save-option-group-label"><i class="fa-solid fa-note-sticky"></i> Notes</div>\r\n'
    '            <div class="save-option-row">\r\n'
    '              <div class="save-option-info">\r\n'
    '                <span class="save-option-name">Sticky Notes</span>\r\n'
    '                <span class="save-option-desc">Notes placed on specific pages</span>\r\n'
    '              </div>\r\n'
    '              <label class="toggle-switch">\r\n'
    '                <input type="checkbox" id="save-opt-sticky" checked>\r\n'
    '                <span class="toggle-slider"></span>\r\n'
    '              </label>\r\n'
    '            </div>\r\n'
    '            <div class="save-option-row">\r\n'
    '              <div class="save-option-info">\r\n'
    '                <span class="save-option-name">Research Notes</span>\r\n'
    '                <span class="save-option-desc">Append notes as extra pages at end</span>\r\n'
    '              </div>\r\n'
    '              <label class="toggle-switch">\r\n'
    '                <input type="checkbox" id="save-opt-notes" checked>\r\n'
    '                <span class="toggle-slider"></span>\r\n'
    '              </label>\r\n'
    '            </div>\r\n'
    '          </div>\r\n'
    '        </div>\r\n'
    '        <div class="save-modal-preview">\r\n'
    '          <div class="save-preview-card">\r\n'
    '            <div class="save-preview-page">\r\n'
    '              <div class="save-preview-line"></div>\r\n'
    '              <div class="save-preview-line" style="width: 80%;"></div>\r\n'
    '              <div class="save-preview-highlight-bar"></div>\r\n'
    '              <div class="save-preview-line" style="width: 60%;"></div>\r\n'
    '              <div class="save-preview-pen-stroke"></div>\r\n'
    '              <div class="save-preview-sticky-icon">\r\n'
    '                <i class="fa-solid fa-note-sticky"></i>\r\n'
    '              </div>\r\n'
    '            </div>\r\n'
    '            <div class="save-preview-label">Document Preview</div>\r\n'
    '          </div>\r\n'
    '          <div class="save-preview-stats" id="save-preview-stats">\r\n'
    '            <div class="save-stat-row"><i class="fa-solid fa-pen"></i><span>Ink Strokes</span><span id="stat-strokes">&#x2014;</span></div>\r\n'
    '            <div class="save-stat-row"><i class="fa-solid fa-highlighter" style="color: #f1c40f;"></i><span>AI Highlights</span><span id="stat-highlights">&#x2014;</span></div>\r\n'
    '            <div class="save-stat-row"><i class="fa-solid fa-note-sticky" style="color: #f1c40f;"></i><span>Sticky Notes</span><span id="stat-stickies">&#x2014;</span></div>\r\n'
    '            <div class="save-stat-row"><i class="fa-solid fa-book-open" style="color: var(--accent);"></i><span>Research Notes</span><span id="stat-notes">&#x2014;</span></div>\r\n'
    '          </div>\r\n'
    '        </div>\r\n'
    '      </div>\r\n'
    '      <div class="save-modal-footer">\r\n'
    '        <button class="btn" id="save-modal-cancel">Cancel</button>\r\n'
    '        <button class="btn primary" id="save-modal-confirm"><i class="fa-solid fa-file-arrow-down"></i> Export PDF</button>\r\n'
    '      </div>\r\n'
    '    </div>\r\n'
    '  </div>\r\n'
    '\r\n'
    '  <!-- User Sticky Note Dialog -->\r\n'
    '  <div id="user-sticky-dialog" class="modal-overlay" style="display:none;">\r\n'
    '    <div class="modal-card" style="width:360px;">\r\n'
    '      <div class="modal-header">\r\n'
    '        <div style="display:flex; align-items:center; gap:8px;">\r\n'
    '          <i class="fa-solid fa-note-sticky" style="color: #f1c40f; font-size: 1.2rem;"></i>\r\n'
    '          <h3 style="margin:0; font-size: 1rem;">Add Sticky Note</h3>\r\n'
    '        </div>\r\n'
    '        <button class="btn icon-btn" id="user-sticky-close"><i class="fa-solid fa-xmark"></i></button>\r\n'
    '      </div>\r\n'
    '      <div style="padding: 12px 0 4px;">\r\n'
    '        <p style="font-size: 0.8rem; color: var(--text-soft); margin: 0 0 10px;">After confirming, click anywhere on the current PDF page to place the note.</p>\r\n'
    '        <textarea id="user-sticky-text" placeholder="Type your note here..." rows="4" style="width: 100%; resize: vertical; border: 1px solid var(--line); background: var(--panel-soft); color: var(--text); border-radius: 8px; padding: 10px; font-family: inherit; font-size: 0.9rem; box-sizing: border-box;"></textarea>\r\n'
    '      </div>\r\n'
    '      <div class="modal-actions">\r\n'
    '        <button class="btn" id="user-sticky-cancel">Cancel</button>\r\n'
    '        <button class="btn primary" id="user-sticky-confirm"><i class="fa-solid fa-map-pin"></i> Place on Page</button>\r\n'
    '      </div>\r\n'
    '    </div>\r\n'
    '  </div>'
).encode('utf-8')

new_data = data[:open_div_idx] + new_modal + data[end_idx:]

with open('renderer/index.html', 'wb') as f:
    f.write(new_data)

print(f'SUCCESS: File written. New length: {len(new_data)}')
