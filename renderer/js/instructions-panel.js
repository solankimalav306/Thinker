// Dialog for custom AI instructions. Layers: global, this document, this chat. They are sent
// with every request, after the app's own rules (which they can add to but never replace).

export const PRESETS = [
  {
    title: "Study tutor",
    body: "Explain ideas step by step in plain language. After each explanation, check understanding with one short question. Point out common mistakes and give a small worked example when it helps."
  },
  {
    title: "Legal reader",
    body: "Read as a careful legal analyst. Quote the exact clause and its page for every claim, flag ambiguous or one-sided wording, and list obligations, deadlines and exceptions separately. Do not give legal advice; say what the text says."
  },
  {
    title: "Researcher",
    body: "Be precise and critical. Separate what the document claims from what it demonstrates, note the method and its limits, and give numbers exactly as written. Say so plainly when the document does not support a claim."
  },
  {
    title: "Summarizer",
    body: "Keep answers short: lead with the answer, then at most three supporting bullets with page references. No preamble and no repetition of the question."
  }
];

const SCOPES = [
  { id: "global", label: "Everywhere" },
  { id: "document", label: "This document" },
  { id: "conversation", label: "This chat" }
];

const estimateTokens = (text) => Math.ceil(String(text || "").length / 4);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export async function openInstructionsPanel({ pdfPath, conversationId, onChange }) {
  const api = window.electronAPI;
  const docId = pdfPath ? await api.getDocumentId(pdfPath) : null;
  const conversations = pdfPath ? await api.listConversations(pdfPath) : [];
  let conversation = conversations.find((c) => c.id === conversationId) || null;
  let scope = "global";

  const overlay = el("div", "modal-overlay instructions-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Custom AI instructions");
  const modal = el("div", "instructions-modal");
  overlay.appendChild(modal);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    onChange?.();
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  async function draw() {
    modal.textContent = "";

    const head = el("div", "instructions-head");
    head.appendChild(el("h3", null, "Custom AI instructions"));
    const closeBtn = el("button", "btn icon-btn");
    closeBtn.type = "button";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener("click", close);
    head.appendChild(closeBtn);
    modal.appendChild(head);

    modal.appendChild(el("p", "instructions-note",
      "These are added to every question, after Thinker's own rules. They can change tone and format, but cannot turn off page citations or Document-only mode."));

    const tabs = el("div", "instructions-tabs");
    SCOPES.forEach(({ id, label }) => {
      const tab = el("button", "chip-tab" + (id === scope ? " active" : ""), label);
      tab.type = "button";
      tab.addEventListener("click", () => {
        scope = id;
        draw();
      });
      tabs.appendChild(tab);
    });
    modal.appendChild(tabs);

    const body = el("div", "instructions-body");
    modal.appendChild(body);

    if (scope === "conversation") {
      await drawConversation(body);
    } else if (scope === "document" && !docId) {
      body.appendChild(el("p", "prefs-empty", "Open a document to give it its own instructions."));
    } else {
      await drawList(body);
    }

    const total = await api.resolveInstructions(pdfPath, conversation?.id || null);
    const tokens = total.reduce((sum, layer) => sum + estimateTokens(layer.body), 0);
    modal.appendChild(el("p", "instructions-foot",
      total.length === 0 ? "No instructions are active." : `${total.length} active, about ${tokens} extra tokens on every message.`));
  }

  async function drawConversation(body) {
    if (!conversation) {
      body.appendChild(el("p", "prefs-empty", "Send a first message to create this chat, then give it its own instructions."));
      return;
    }
    const area = el("textarea", "instructions-text");
    area.rows = 6;
    area.maxLength = 2000;
    area.placeholder = "For example: answer as a short checklist.";
    area.value = conversation.instructions || "";
    area.setAttribute("aria-label", "Instructions for this chat");
    area.addEventListener("change", async () => {
      conversation = await api.updateConversation(conversation.id, { instructions: area.value.trim() });
      draw();
    });
    body.appendChild(area);
  }

  async function drawList(body) {
    const scopeId = scope === "document" ? docId : "";
    const items = await api.listInstructions(scope, scopeId);

    const presets = el("div", "instructions-presets");
    presets.appendChild(el("span", "instructions-presets-label", "Add a preset:"));
    PRESETS.forEach((preset) => {
      const btn = el("button", "message-action-btn", preset.title);
      btn.type = "button";
      btn.addEventListener("click", async () => {
        await api.saveInstruction({ scope, scopeId, title: preset.title, body: preset.body, enabled: true });
        draw();
      });
      presets.appendChild(btn);
    });
    body.appendChild(presets);

    if (items.length === 0) {
      body.appendChild(el("p", "prefs-empty", "Nothing here yet. Add a preset above or write your own."));
    }

    items.forEach((item) => {
      const card = el("div", "instruction-card");
      const top = el("div", "instruction-card-top");

      const title = el("input", "prefs-input");
      title.type = "text";
      title.value = item.title;
      title.maxLength = 60;
      title.setAttribute("aria-label", "Instruction name");

      const toggle = el("label", "toggle-switch");
      const check = el("input");
      check.type = "checkbox";
      check.checked = item.enabled;
      check.setAttribute("aria-label", "Enabled");
      toggle.append(check, el("span", "toggle-slider"));

      const remove = el("button", "btn icon-btn");
      remove.type = "button";
      remove.title = "Delete instruction";
      remove.setAttribute("aria-label", "Delete instruction");
      remove.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      remove.addEventListener("click", async () => {
        await api.deleteInstruction(item.id);
        draw();
      });
      top.append(title, toggle, remove);

      const text = el("textarea", "instructions-text");
      text.rows = 4;
      text.maxLength = 2000;
      text.value = item.body;
      text.setAttribute("aria-label", "Instruction text");

      const save = async () => {
        await api.saveInstruction({ ...item, title: title.value.trim() || "Instruction", body: text.value.trim(), enabled: check.checked });
        draw();
      };
      [title, text, check].forEach((control) => control.addEventListener("change", save));
      card.append(top, text);
      body.appendChild(card);
    });

    const add = el("button", "btn", "Add instruction");
    add.type = "button";
    add.addEventListener("click", async () => {
      await api.saveInstruction({ scope, scopeId, title: "My instruction", body: "", enabled: true });
      draw();
    });
    body.appendChild(add);
  }

  document.body.appendChild(overlay);
  await draw();
}
