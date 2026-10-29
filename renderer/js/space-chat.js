// Ask a whole Thinkspace: one chat that reads every PDF in it together.
// Answers cite [Document title, page N]; those become buttons that open that document at that page.
import { getApiProfiles, getActiveApiProfileId } from "./state.js";
import { friendlyAgentError, timeAgo, splitCitations } from "./chat-groups.js";
import { ensureIndexed } from "./doc-index.js";
import { splitArtifacts } from "./artifact-html.js";
import { createArtifactView } from "./artifact-view.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, icon, onClick, title) {
  const b = el("button", className);
  b.type = "button";
  if (icon) { b.append(el("i", `fa-solid ${icon}`)); if (label) b.append(document.createTextNode(` ${label}`)); } else b.textContent = label;
  if (title) { b.title = title; b.setAttribute("aria-label", title); }
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Answers use a little markdown: **bold** and "* " bullets. Built as text nodes, never as HTML.
function appendFormatted(parent, text) {
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const bullet = /^\s*[*-]\s+/.exec(line);
    const body = bullet ? "• " + line.slice(bullet[0].length) : line;
    body.split(/(\*\*[^*]+\*\*)/).forEach((piece) => {
      if (/^\*\*[^*]+\*\*$/.test(piece)) parent.append(el("strong", "", piece.slice(2, -2)));
      else if (piece) parent.append(document.createTextNode(piece));
    });
    if (i < lines.length - 1) parent.append(document.createTextNode("\n"));
  });
}

export function createSpaceChat(root, { api = window.electronAPI, space, openPdfAt, setStatus }) {
  // a document is called by its name without ".pdf", in the question and in the citations
  const docs = space.documents.filter((d) => d.path).map((d) => ({ ...d, title: d.title.replace(/\.pdf$/i, "") }));
  let conversationId = null;
  let entries = [];
  let busy = false;
  let requestId = null;
  let mode = "auto";

  root.textContent = "";
  root.classList.add("sc-root");

  const head = el("div", "sc-head");
  const title = el("div", "sc-title");
  title.append(el("strong", "", "Ask this Thinkspace"), el("small", "", docs.length ? `Reads ${docs.length} document${docs.length === 1 ? "" : "s"} together` : "Add PDFs to start"));
  const controls = el("div", "sc-controls");
  const convoSelect = el("select", "sc-select");
  convoSelect.setAttribute("aria-label", "Chat");
  const modeSelect = el("select", "sc-select");
  modeSelect.setAttribute("aria-label", "Where answers come from");
  modeSelect.append(new Option("Documents + AI", "auto"), new Option("Documents only", "document"));
  modeSelect.title = "Documents only answers strictly from these PDFs and says so when they do not contain it";
  modeSelect.addEventListener("change", () => { mode = modeSelect.value; });
  const newChat = button("New", "btn", "fa-plus", () => startNew(), "Start a new chat");
  controls.append(convoSelect, newChat, modeSelect);
  head.append(title, controls);

  const messages = el("div", "sc-messages");
  messages.setAttribute("aria-live", "polite");
  const progress = el("div", "sc-progress");
  progress.hidden = true;
  const form = el("form", "sc-form");
  const input = el("textarea", "sc-input");
  input.rows = 2;
  input.placeholder = docs.length ? "Ask something across your documents, for example: where do these disagree?" : "Add PDFs to this Thinkspace first";
  input.setAttribute("aria-label", "Ask this Thinkspace");
  input.disabled = !docs.length;
  const send = button("", "btn primary sc-send", "fa-arrow-up", null, "Send");
  send.type = "submit";
  send.disabled = !docs.length;
  form.append(input, send);
  root.append(head, messages, progress, form);

  const profile = () => {
    const all = getApiProfiles();
    return all.find((p) => p.id === getActiveApiProfileId()) || all[0] || null;
  };

  // ---- conversations -------------------------------------------------------------------------------
  async function refreshList(selectId) {
    const list = await api.listWorkspaceConversations(space.id);
    convoSelect.textContent = "";
    convoSelect.append(new Option(list.length ? "Earlier chats…" : "No chats yet", ""));
    list.forEach((c) => convoSelect.append(new Option(`${c.title} · ${timeAgo(c.updatedAt)}`, c.id)));
    convoSelect.value = selectId && list.some((c) => c.id === selectId) ? selectId : "";
    return list;
  }

  convoSelect.addEventListener("change", () => { if (convoSelect.value) openConversation(convoSelect.value); });

  async function openConversation(id) {
    conversationId = id;
    const rows = await api.getConversationMessages(id);
    entries = rows.map((r) => ({ role: r.role === "assistant" ? "assistant" : "user", text: r.text, ts: r.ts, sources: Array.isArray(r.sources) ? r.sources : [] }));
    renderAll();
    convoSelect.value = id;
  }

  async function startNew() {
    if (busy) return;
    conversationId = null;
    entries = [];
    convoSelect.value = "";
    renderAll();
    input.focus();
  }

  // ---- drawing -------------------------------------------------------------------------------------
  function renderAll() {
    messages.textContent = "";
    if (!entries.length) {
      const box = el("div", "sc-welcome");
      box.append(el("h3", "", docs.length ? "Ask across all your documents" : "No documents yet"));
      box.append(el("p", "", docs.length
        ? "I read the PDFs in this Thinkspace together. Ask which one says something, where they disagree, or for a comparison. Answers name the document and page, and you can click them to jump there."
        : "Add PDFs to this Thinkspace, then ask questions that span them."));
      if (docs.length) {
        const ideas = el("div", "sc-ideas");
        ["Summarise each document in one sentence.", "Make a comparison table of the rules in each document.", "Where do these documents disagree?"].forEach((q) => {
          ideas.append(button(q, "ta-chip", "", () => { input.value = q; form.requestSubmit(); }));
        });
        box.append(ideas);
      }
      messages.append(box);
      return;
    }
    entries.forEach(renderEntry);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderEntry(entry) {
    if (entry.role === "assistant" && /<artifact/i.test(entry.text)) {
      // a reply may mix plain text with one or more artifacts, shown in order
      const wrap = el("div", "sc-artifact-reply");
      for (const part of splitArtifacts(entry.text)) {
        if (part.type === "artifact") {
          wrap.append(createArtifactView({
            title: part.title, html: part.html, complete: part.complete, sources: entry.sources || [],
            onCite: ({ doc, page }) => { const d = docs.find((x) => x.title.toLowerCase() === doc.toLowerCase()); if (d) openPdfAt(d.path, page); },
            onSave: (file) => api.saveTextFile({ defaultPath: `${file.title.replace(/[\\/:*?"<>|]+/g, "-")}.html`, content: file.content, filters: [{ name: "HTML page", extensions: ["html"] }] })
          }));
        } else {
          const text = el("div", "sc-msg assistant");
          renderText(text, part.text);
          wrap.append(text);
        }
      }
      messages.append(wrap);
      return wrap;
    }
    const bubble = el("div", `sc-msg ${entry.role}`);
    if (entry.role === "assistant") renderText(bubble, entry.text);
    else bubble.textContent = entry.text;
    messages.append(bubble);
    return bubble;
  }

  function renderText(bubble, text) {
    for (const part of splitCitations(text, docs)) {
      if (part.cite) {
        const chip = button(part.cite.label, "sc-cite", "", () => openPdfAt(part.cite.doc.path, part.cite.page), `Open ${part.cite.doc.title} at page ${part.cite.page}`);
        bubble.append(chip);
      } else appendFormatted(bubble, part.text);
    }
  }

  // ---- asking --------------------------------------------------------------------------------------
  function setBusy(on) {
    busy = on;
    input.disabled = on || !docs.length;
    send.innerHTML = on ? '<i class="fa-solid fa-stop"></i>' : '<i class="fa-solid fa-arrow-up"></i>';
    send.title = on ? "Stop" : "Send";
    newChat.disabled = on;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) { if (requestId) api.cancelAgent(requestId); return; }
    const question = input.value.trim();
    if (question) ask(question);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });

  async function ask(question) {
    const p = profile();
    if (!p) { setStatus("Connect an AI model first (Settings)."); addNote("Connect an AI model first. Open Settings and add a Gemini key, or point Thinker at a local model.", true); return; }
    input.value = "";
    if (!entries.length) messages.textContent = "";
    const userEntry = { role: "user", text: question, ts: Date.now() };
    entries.push(userEntry);
    renderEntry(userEntry);
    const waiting = el("div", "sc-msg status", "Getting your documents ready…");
    messages.append(waiting);
    messages.scrollTop = messages.scrollHeight;
    setBusy(true);
    requestId = crypto.randomUUID();

    try {
      if (!conversationId) {
        const created = await api.createWorkspaceConversation(space.id, { mode });
        conversationId = created.id;
      }
      await api.appendConversationMessage(conversationId, userEntry);

      // every document must be searchable; ones never opened in the reader are read and indexed now
      const ready = [];
      for (let i = 0; i < docs.length; i += 1) {
        progress.hidden = false;
        progress.textContent = `Reading ${docs[i].title} (${i + 1} of ${docs.length})…`;
        try {
          ready.push({ pdfId: await ensureIndexed(docs[i].path, { api, onProgress: (done, total) => { progress.textContent = `Reading ${docs[i].title} (${i + 1} of ${docs.length}): page ${done} of ${total}…`; } }), title: docs[i].title });
        } catch (error) {
          setStatus(`Could not read ${docs[i].title}: ${error.message}`);
        }
      }
      progress.hidden = true;
      if (!ready.length) throw new Error("None of the documents could be read.");
      waiting.textContent = "Thinking…";

      const storagePath = await api.getUserDataPath();
      const instructions = (await api.resolveInstructions(null, conversationId)) || [];
      const key = await sha256(`thinkspace:${space.id}`);
      const result = await api.invokeAgent({
        requestId, query: question, pdfId: key, storagePath,
        apiKey: p.key || "", apiFormat: p.format || "gemini", apiUrl: p.url || "", model: p.model, profile: p,
        conversationId, mode, instructions, context: "", messages: entries.slice(-11, -1), parts: [], artifacts: true, docs: ready.map((d) => ({ pdfId: d.pdfId, title: d.title }))
      });
      waiting.remove();
      if (result.cancelled) { setStatus("Stopped."); return; }
      if (!result.ok) throw new Error(result.error || "The request failed");
      if (result.result?.error) throw new Error(result.result.error);
      const answer = result.result?.response_text || "";
      if (!answer.trim()) throw new Error("The AI did not send an answer.");
      const reply = { role: "assistant", text: answer, ts: Date.now(), sources: (result.result?.sources || []).map((s) => ({ doc: s.doc, page: s.page })) };
      entries.push(reply);
      renderEntry(reply);
      await api.appendConversationMessage(conversationId, reply);
      await refreshList(conversationId);
      messages.scrollTop = messages.scrollHeight;
    } catch (error) {
      waiting.remove();
      progress.hidden = true;
      addNote(friendlyAgentError(error.message), true);
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  function addNote(text, isError) {
    const note = el("div", `sc-msg assistant${isError ? " error" : ""}`, text);
    messages.append(note);
    messages.scrollTop = messages.scrollHeight;
  }

  (async () => {
    const list = await refreshList();
    if (list.length) await openConversation(list[0].id);
    else renderAll();
  })();

  return { focus: () => input.focus(), docCount: docs.length };
}
