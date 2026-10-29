// The ThinkerTex visual editor: edit a LaTeX document like a normal document.
// It edits the same text as the code view. Anything it does not understand is shown as a source
// block, and anything the person does not touch is written back exactly as it was (see tex-blocks.js).
import {
  parseDocument, serializeDocument, parseInline, serializeInline,
  updateBlock, setRawSource, insertBlock, deleteBlock, moveBlock, newBlock, describeBlock
} from "./tex-blocks.js";

const BS = String.fromCharCode(92);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(icon, title, onClick, label = "") {
  const b = el("button", "ve-btn");
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.append(el("i", `fa-solid ${icon}`));
  if (label) b.append(document.createTextNode(` ${label}`));
  b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the text selection while clicking
  b.addEventListener("click", onClick);
  return b;
}

// ---- KaTeX is loaded once, only when the visual view is first used ------------------------------
let katexReady = null;
function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexReady) return katexReady;
  katexReady = new Promise((resolve) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/katex/katex.min.css";
    document.head.append(css);
    const script = document.createElement("script");
    script.src = "vendor/katex/katex.min.js";
    script.onload = () => resolve(window.katex);
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  return katexReady;
}

function renderMath(target, source, displayMode) {
  const katex = window.katex;
  if (!katex) { target.textContent = source; return; }
  // KaTeX does not know \label or the align family; show the maths and drop what it cannot draw.
  const cleaned = source.replace(/\\label\{[^}]*\}/g, "").replace(/\\nonumber/g, "").replace(/&/g, displayMode ? "&" : " ");
  try {
    target.innerHTML = katex.renderToString(cleaned.replace(/\\begin\{(align|eqnarray|gather|multline)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, (_m, _n, inner) => `\\begin{aligned}${inner}\\end{aligned}`), { displayMode, throwOnError: false, trust: false });
  } catch {
    target.textContent = source;
  }
}

// ---- DOM <-> inline nodes -------------------------------------------------------------------------
function inlineToDom(nodes, parent) {
  for (const node of nodes) {
    if (node.t === "text") {
      parent.append(document.createTextNode(node.text));
    } else if (node.t === "mark") {
      const tag = { bold: "b", italic: "i", code: "code", underline: "u" }[node.kind] || "span";
      const wrapper = document.createElement(tag);
      wrapper.dataset.command = node.command || "";
      inlineToDom(node.children, wrapper);
      parent.append(wrapper);
    } else if (node.t === "math") {
      const chip = el("span", "ve-imath");
      chip.contentEditable = "false";
      chip.dataset.src = node.src;
      chip.dataset.delim = node.delim;
      renderMath(chip, node.src, false);
      parent.append(chip);
    } else if (node.t === "raw") {
      parent.append(rawChip(node.src));
    }
  }
}

function rawChip(src) {
  const chip = el("span", "ve-chip");
  chip.contentEditable = "false";
  chip.dataset.raw = src;
  const cite = /^\\(cite[a-z]*)(?:\[[^\]]*\])*\{([^}]*)\}$/.exec(src);
  const ref = /^\\(ref|eqref|autoref|pageref)\{([^}]*)\}$/.exec(src);
  const label = /^\\label\{([^}]*)\}$/.exec(src);
  if (cite) { chip.textContent = `[${cite[2]}]`; chip.classList.add("cite"); chip.title = "Citation: " + src; }
  else if (ref) { chip.textContent = `↗ ${ref[2]}`; chip.classList.add("ref"); chip.title = "Reference: " + src; }
  else if (label) { chip.textContent = `⚑ ${label[1]}`; chip.classList.add("ref"); chip.title = "Label: " + src; }
  else if (src === BS + BS) { chip.textContent = "↵"; chip.title = "Line break"; }
  else if (/^\\footnote/.test(src)) { chip.textContent = "¹"; chip.title = src; }
  else { chip.textContent = src.length > 28 ? src.slice(0, 26) + "…" : src; chip.title = src; }
  return chip;
}

function domToInline(root) {
  const out = [];
  const pushText = (text) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.t === "text") last.text += text;
    else out.push({ t: "text", text });
  };
  const walk = (node, into) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const text = child.nodeValue.replace(/ /g, " ").replace(/​/g, "");
        if (into === out) pushText(text);
        else if (text) {
          const last = into[into.length - 1];
          if (last && last.t === "text") last.text += text; else into.push({ t: "text", text });
        }
      } else if (child.nodeType === 1) {
        const tag = child.tagName;
        if (child.classList.contains("ve-imath")) into.push({ t: "math", src: child.dataset.src || "", delim: child.dataset.delim || "dollar" });
        else if (child.classList.contains("ve-chip")) into.push({ t: "raw", src: child.dataset.raw || "" });
        else if (tag === "BR") { const last = into[into.length - 1]; if (last && last.t === "text") last.text += " "; else into.push({ t: "text", text: " " }); }
        else if (["B", "STRONG", "I", "EM", "CODE", "U"].includes(tag)) {
          const kind = { B: "bold", STRONG: "bold", I: "italic", EM: "italic", CODE: "code", U: "underline" }[tag];
          const children = [];
          walk(child, children);
          if (children.length) into.push({ t: "mark", kind, children, command: child.dataset.command || undefined });
        } else walk(child, into);
      }
    }
  };
  walk(root, out);
  return out;
}

function sourceOfElement(element) {
  return serializeInline(domToInline(element));
}

export function createVisualEditor(root, options = {}) {
  const { onChange, onSave, onCompile, getCitationKeys, setStatus } = options;
  let model = null;
  let lastText = "";
  const history = { stack: [], index: -1 };
  let applying = false;

  root.textContent = "";
  root.classList.add("ve-root");
  const toolbar = el("div", "ve-toolbar");
  const page = el("div", "ve-page");
  const message = el("div", "ve-message");
  message.hidden = true;
  root.append(toolbar, message, page);

  // ---------------------------------------------------------------------------- state and history
  function commit(next, { push = true, keepFocus = false } = {}) {
    model = next;
    const text = serializeDocument(model);
    if (text === lastText) return;
    lastText = text;
    if (push) pushHistory(text);
    applying = true;
    try { onChange?.(text); } finally { applying = false; }
    if (!keepFocus) render();
  }

  function pushHistory(text) {
    history.stack = history.stack.slice(0, history.index + 1);
    if (history.stack[history.stack.length - 1] !== text) history.stack.push(text);
    if (history.stack.length > 200) history.stack.shift();
    history.index = history.stack.length - 1;
  }

  let typingTimer = null;
  const pushHistoryLater = () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => pushHistory(lastText), 500);
  };

  function undo(delta) {
    clearTimeout(typingTimer);
    pushHistory(lastText);
    const target = history.index + delta;
    if (target < 0 || target >= history.stack.length) return;
    history.index = target;
    const text = history.stack[target];
    const parsed = parseDocument(text);
    if (!parsed.ok) return;
    model = parsed;
    lastText = text;
    applying = true;
    try { onChange?.(text); } finally { applying = false; }
    render();
  }

  // ---------------------------------------------------------------------------- public API
  async function setText(text) {
    await loadKatex();
    if (applying) return;
    if (text === lastText && model) return;
    const parsed = parseDocument(text);
    if (!parsed.ok) {
      model = null;
      message.hidden = false;
      message.textContent = parsed.reason;
      page.textContent = "";
      return;
    }
    message.hidden = true;
    model = parsed;
    lastText = text;
    if (!history.stack.length) pushHistory(text);
    render();
  }

  // ---------------------------------------------------------------------------- rendering
  function render() {
    const scroll = root.scrollTop;
    page.textContent = "";
    if (!model) return;

    page.append(preambleBox());

    if (!model.blocks.length) {
      const empty = el("p", "ve-empty", "This document is empty. Start typing, or use Insert above.");
      page.append(empty);
      const first = el("div", "ve-p ve-editable");
      first.contentEditable = "true";
      first.dataset.placeholder = "Start writing…";
      first.addEventListener("input", () => {
        const text = sourceOfElement(first);
        if (text.trim()) commit(insertBlock(model, -1, newBlock("paragraph", { text })), { keepFocus: false });
      });
      page.append(first);
    }

    model.blocks.forEach((block, index) => page.append(blockView(block, index)));
    page.append(addBar());
    root.scrollTop = scroll;
  }

  function preambleBox() {
    const box = el("details", "ve-preamble");
    box.append(el("summary", "", "Document settings (packages, title, author)"));
    const area = el("textarea", "ve-source");
    area.value = model.preamble;
    area.rows = Math.min(16, Math.max(5, model.preamble.split("\n").length));
    area.spellcheck = false;
    area.setAttribute("aria-label", "Preamble source");
    area.addEventListener("input", () => commit({ ...model, preamble: area.value }, { keepFocus: true }));
    box.append(area);
    return box;
  }

  function blockView(block, index) {
    const wrap = el("div", `ve-block ve-${block.kind}`);
    wrap.dataset.index = String(index);
    const gutter = el("div", "ve-gutter");
    gutter.append(
      iconButton("fa-arrow-up", "Move up", () => commit(moveBlock(model, index, -1))),
      iconButton("fa-arrow-down", "Move down", () => commit(moveBlock(model, index, 1))),
      iconButton("fa-trash", "Delete this block", () => commit(deleteBlock(model, index)))
    );
    wrap.append(gutter);

    const body = el("div", "ve-body");
    if (block.kind === "heading") body.append(headingView(block, index));
    else if (block.kind === "paragraph") body.append(paragraphView(block, index));
    else if (block.kind === "list") body.append(listView(block, index));
    else if (block.kind === "math") body.append(mathView(block, index));
    else body.append(rawView(block, index));
    wrap.append(body);
    return wrap;
  }

  function editable(tagName, className, source, onInput) {
    const node = el(tagName, `${className} ve-editable`);
    node.contentEditable = "true";
    node.spellcheck = true;
    try { inlineToDom(parseInline(source), node); } catch { node.textContent = source; }
    node.addEventListener("input", () => { onInput(sourceOfElement(node)); pushHistoryLater(); });
    node.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
    node.addEventListener("click", (e) => chipClick(e, node));
    return node;
  }

  function headingView(block, index) {
    const node = editable("div", `ve-heading-text ve-h${block.level}`, block.text, (text) => {
      model = updateBlock(model, index, { text });
      emit();
    });
    node.setAttribute("role", "heading");
    node.setAttribute("aria-level", String(block.level + 1));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(insertBlock(model, index, newBlock("paragraph")), { keepFocus: false }); focusBlock(index + 1); }
    });
    return node;
  }

  function paragraphView(block, index) {
    const node = editable("div", "ve-p", block.text, (text) => {
      model = updateBlock(model, index, { text });
      emit();
    });
    node.dataset.placeholder = "Write here…";
    node.addEventListener("keydown", (e) => paragraphKeys(e, node, index));
    return node;
  }

  function paragraphKeys(e, node, index) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      splitParagraph(node, index);
    } else if (e.key === "Backspace" && caretAtStart(node) && index > 0 && model.blocks[index - 1].kind === "paragraph") {
      e.preventDefault();
      const joinAt = model.blocks[index - 1].text.length;
      const joined = model.blocks[index - 1].text + (model.blocks[index - 1].text && node.textContent ? " " : "") + sourceOfElement(node);
      let next = updateBlock(model, index - 1, { text: joined });
      next = deleteBlock(next, index);
      commit(next);
      focusBlock(index - 1, joinAt);
    }
  }

  function caretAtStart(node) {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !node.contains(sel.anchorNode)) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    return range.toString().length === 0;
  }

  function splitParagraph(node, index) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const caret = sel.getRangeAt(0);
    if (!node.contains(caret.endContainer)) return;
    const tail = document.createRange();
    tail.selectNodeContents(node);
    tail.setStart(caret.endContainer, caret.endOffset);
    const holder = el("div");
    holder.append(tail.cloneContents());
    const tailSource = serializeInline(domToInline(holder));
    tail.deleteContents();
    const headSource = sourceOfElement(node);
    let next = updateBlock(model, index, { text: headSource });
    next = insertBlock(next, index, newBlock("paragraph", { text: tailSource }));
    commit(next);
    focusBlock(index + 1, 0);
  }

  function listView(block, index) {
    const list = el(block.ordered ? "ol" : "ul", "ve-list");
    block.items.forEach((item, itemIndex) => {
      const li = editable("li", "ve-li", item, (text) => {
        const items = model.blocks[index].items.slice();
        items[itemIndex] = text;
        model = updateBlock(model, index, { items });
        emit();
      });
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const items = model.blocks[index].items.slice();
          items.splice(itemIndex + 1, 0, "");
          commit(updateBlock(model, index, { items }));
          focusListItem(index, itemIndex + 1);
        } else if (e.key === "Backspace" && !li.textContent && model.blocks[index].items.length > 1) {
          e.preventDefault();
          const items = model.blocks[index].items.slice();
          items.splice(itemIndex, 1);
          commit(updateBlock(model, index, { items }));
          focusListItem(index, Math.max(0, itemIndex - 1), true);
        }
      });
      list.append(li);
    });
    return list;
  }

  function mathView(block, index) {
    const view = el("div", "ve-math");
    const shown = el("div", "ve-math-shown");
    shown.title = "Click to edit the equation";
    renderMath(shown, block.math, true);
    shown.addEventListener("click", () => {
      const area = el("textarea", "ve-source");
      area.value = block.math;
      area.rows = Math.max(2, block.math.split("\n").length + 1);
      area.spellcheck = false;
      area.setAttribute("aria-label", "Equation source");
      view.textContent = "";
      view.append(area, el("small", "ve-hint", "LaTeX maths. Click outside to see it drawn."));
      area.focus();
      area.addEventListener("input", () => { model = updateBlock(model, index, { math: area.value }); emit(); });
      area.addEventListener("blur", () => render());
    });
    view.append(shown);
    return view;
  }

  function rawView(block, index) {
    const card = el("div", "ve-raw");
    const head = el("div", "ve-raw-head");
    head.append(el("span", "ve-raw-label", describeBlock(block)), el("small", "", "shown as source"));
    const area = el("textarea", "ve-source");
    area.value = block.src;
    area.rows = Math.min(18, Math.max(2, block.src.split("\n").length));
    area.spellcheck = false;
    area.setAttribute("aria-label", `${describeBlock(block)} source`);
    let timer = null;
    area.addEventListener("input", () => {
      clearTimeout(timer);
      // keep it as raw while typing (so nothing jumps), and re-read what it is when the person leaves it
      model = { ...model, blocks: model.blocks.map((b, i) => (i === index ? { ...b, src: area.value, dirty: false } : b)) };
      emit();
    });
    area.addEventListener("blur", () => {
      const classified = setRawSource(model, index, area.value);
      if (classified.blocks[index].kind !== "raw") commit(classified);
    });
    card.append(head, area);
    return card;
  }

  function addBar() {
    const bar = el("div", "ve-addbar");
    bar.append(
      iconButton("fa-plus", "Add a paragraph at the end", () => { commit(insertBlock(model, model.blocks.length - 1, newBlock("paragraph"))); focusBlock(model.blocks.length - 1); }, "Paragraph"),
      iconButton("fa-heading", "Add a section at the end", () => commit(insertBlock(model, model.blocks.length - 1, newBlock("heading"))), "Section")
    );
    return bar;
  }

  // ---------------------------------------------------------------------------- chips and focus
  function chipClick(event, node) {
    const chip = event.target.closest(".ve-chip, .ve-imath");
    if (!chip || !node.contains(chip)) return;
    const isMath = chip.classList.contains("ve-imath");
    const current = isMath ? chip.dataset.src : chip.dataset.raw;
    popover(chip, isMath ? "Inline maths" : "Command", current, (value) => {
      if (isMath) { chip.dataset.src = value; renderMath(chip, value, false); }
      else chip.replaceWith(rawChip(value));
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }, () => { chip.remove(); node.dispatchEvent(new Event("input", { bubbles: true })); });
  }

  function popover(anchor, title, value, onSave2, onRemove) {
    page.querySelector(".ve-pop")?.remove();
    const pop = el("form", "ve-pop");
    const input = el("input");
    input.type = "text";
    input.value = value;
    input.spellcheck = false;
    input.setAttribute("aria-label", title);
    pop.append(el("small", "", title), input, iconButton("fa-check", "Save", () => pop.requestSubmit()), iconButton("fa-trash", "Remove", () => { pop.remove(); onRemove?.(); }));
    pop.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value; pop.remove(); onSave2(v); });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") pop.remove(); });
    const rect = anchor.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    pop.style.left = `${Math.max(8, rect.left - host.left)}px`;
    pop.style.top = `${rect.bottom - host.top + root.scrollTop + 6}px`;
    root.append(pop);
    input.focus();
    input.select();
    setTimeout(() => {
      const away = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("mousedown", away); } };
      document.addEventListener("mousedown", away);
    }, 0);
  }

  function focusBlock(index, offset = null) {
    requestAnimationFrame(() => {
      const target = page.querySelector(`.ve-block[data-index="${index}"] .ve-editable`);
      if (!target) return;
      target.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      if (offset === null) range.collapse(false);
      else {
        // put the caret `offset` characters in
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        let remaining = offset;
        let node = walker.nextNode();
        while (node && remaining > node.nodeValue.length) { remaining -= node.nodeValue.length; node = walker.nextNode(); }
        if (node) { range.setStart(node, Math.min(remaining, node.nodeValue.length)); range.collapse(true); } else range.collapse(true);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    });
  }

  function focusListItem(blockIndex, itemIndex, atEnd = false) {
    requestAnimationFrame(() => {
      const items = page.querySelectorAll(`.ve-block[data-index="${blockIndex}"] .ve-li`);
      const target = items[itemIndex];
      if (!target) return;
      target.focus();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(atEnd ? false : true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
  }

  // typing updates the text without redrawing the page (a redraw would move the cursor)
  function emit() {
    const text = serializeDocument(model);
    if (text === lastText) return;
    lastText = text;
    applying = true;
    try { onChange?.(text); } finally { applying = false; }
  }

  // ---------------------------------------------------------------------------- toolbar
  function activeBlockIndex() {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    const block = node && (node.nodeType === 1 ? node : node.parentElement)?.closest?.(".ve-block");
    return block && page.contains(block) ? Number(block.dataset.index) : -1;
  }

  function activeEditable() {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    return node && (node.nodeType === 1 ? node : node.parentElement)?.closest?.(".ve-editable");
  }

  function inlineCommand(kind) {
    const target = activeEditable();
    if (!target) { setStatus?.("Click inside the text first."); return; }
    if (kind === "bold") document.execCommand("bold");
    else if (kind === "italic") document.execCommand("italic");
    else if (kind === "underline") document.execCommand("underline");
    else if (kind === "code") wrapSelection("code");
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function wrapSelection(tag) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const wrapper = document.createElement(tag);
    wrapper.append(range.extractContents());
    range.insertNode(wrapper);
  }

  function insertInlineMath() {
    const target = activeEditable();
    if (!target) { setStatus?.("Click inside the text first."); return; }
    const sel = window.getSelection();
    const selected = sel.toString();
    const chip = el("span", "ve-imath");
    chip.contentEditable = "false";
    chip.dataset.src = selected || "x^2";
    chip.dataset.delim = "dollar";
    renderMath(chip, chip.dataset.src, false);
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(chip);
      range.setStartAfter(chip);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    target.dispatchEvent(new Event("input", { bubbles: true }));
    chipClick({ target: chip }, target);
  }

  function insertChip(source) {
    const target = activeEditable();
    if (!target) { setStatus?.("Click inside the text first."); return; }
    const sel = window.getSelection();
    const chip = rawChip(source);
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(chip);
      range.setStartAfter(chip);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function setBlockKind(kind, level) {
    const index = activeBlockIndex();
    if (index < 0) { setStatus?.("Click inside a paragraph or heading first."); return; }
    const block = model.blocks[index];
    const text = block.kind === "list" ? block.items.join(" ") : block.text ?? "";
    if (!["paragraph", "heading", "list"].includes(block.kind)) { setStatus?.("This block is shown as source and cannot change type."); return; }
    let next;
    if (kind === "heading") next = { ...block, kind: "heading", level, text, tail: block.tail || "", starred: false, short: "" };
    else if (kind === "paragraph") next = { kind: "paragraph", text };
    else next = { kind: "list", ordered: level === "ordered", items: block.kind === "list" ? block.items : [text], label: level === "ordered" ? "enumerate" : "itemize" };
    commit({ ...model, blocks: model.blocks.map((b, i) => (i === index ? { ...next, sep: b.sep, src: b.src, dirty: true } : b)) });
    focusBlock(index);
  }

  function insertNew(kind, extra) {
    const at = Math.max(activeBlockIndex(), -1 + (model.blocks.length ? 0 : 0));
    const index = at >= 0 ? at : model.blocks.length - 1;
    commit(insertBlock(model, index, newBlock(kind, extra)));
    if (kind === "paragraph" || kind === "heading") focusBlock(index + 1);
  }

  function citationMenu(anchor) {
    const keys = getCitationKeys?.() || [];
    popover(anchor, keys.length ? `Citation key (known: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", …" : ""})` : "Citation key", keys[0] || "", (value) => insertChip(`${BS}cite{${value.trim()}}`));
  }

  function buildToolbar() {
    toolbar.textContent = "";
    const group = (...children) => { const g = el("div", "ve-group"); g.append(...children); return g; };
    const heading = el("select", "ve-select");
    heading.setAttribute("aria-label", "Text style");
    [["paragraph", "Paragraph"], ["1", "Section"], ["2", "Subsection"], ["3", "Subsubsection"]].forEach(([v, l]) => heading.append(new Option(l, v)));
    heading.addEventListener("change", () => {
      if (heading.value === "paragraph") setBlockKind("paragraph");
      else setBlockKind("heading", Number(heading.value));
      heading.value = "paragraph";
    });
    heading.value = "paragraph";
    toolbar.append(
      group(heading),
      group(iconButton("fa-bold", "Bold (Ctrl+B)", () => inlineCommand("bold")), iconButton("fa-italic", "Italic (Ctrl+I)", () => inlineCommand("italic")), iconButton("fa-underline", "Underline", () => inlineCommand("underline")), iconButton("fa-code", "Code", () => inlineCommand("code")), iconButton("fa-square-root-variable", "Inline maths", insertInlineMath)),
      group(iconButton("fa-list-ul", "Bulleted list", () => setBlockKind("list", "bullet")), iconButton("fa-list-ol", "Numbered list", () => setBlockKind("list", "ordered"))),
      group(
        iconButton("fa-superscript", "Equation", () => insertNew("equation"), "Equation"),
        iconButton("fa-table", "Table", () => insertNew("table"), "Table"),
        iconButton("fa-image", "Figure", () => insertNew("figure"), "Figure"),
        iconButton("fa-quote-right", "Citation", (e) => citationMenu(e.currentTarget), "Cite"),
        iconButton("fa-link", "Reference to a label", (e) => popover(e.currentTarget, "Label to refer to", "", (v) => insertChip(`${BS}ref{${v.trim()}}`)), "Ref")
      ),
      group(iconButton("fa-rotate-left", "Undo (Ctrl+Z)", () => undo(-1)), iconButton("fa-rotate-right", "Redo (Ctrl+Y)", () => undo(1)))
    );
  }
  buildToolbar();

  root.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === "s") { e.preventDefault(); onSave?.(); }
    else if (e.key === "Enter") { e.preventDefault(); onCompile?.(); }
    else if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(-1); }
    else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); undo(1); }
    else if (key === "b") { e.preventDefault(); inlineCommand("bold"); }
    else if (key === "i") { e.preventDefault(); inlineCommand("italic"); }
  });

  return {
    setText,
    scrollToHeading(title) {
      const target = [...page.querySelectorAll(".ve-heading-text")].find((h) => h.textContent.trim().startsWith(title.slice(0, 20)));
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.focus();
    },
    focus: () => page.querySelector(".ve-editable")?.focus()
  };
}
