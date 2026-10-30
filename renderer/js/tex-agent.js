// The ThinkerTex agent panel: ask for LaTeX, it writes it, compiles it on a scratch copy to check,
// repairs its own mistakes (up to three tries), and shows what it wants to change as a diff to Apply or Reject.
// Nothing touches your files until you press Apply.
import { trackAiUsage, createUsageLine } from "./ai-usage.js";
import { getApiProfiles, getActiveApiProfileId } from "./state.js";
import { friendlyAgentError } from "./chat-groups.js";
import {
  SYSTEM_PROMPT, MAX_ATTEMPTS, QUICK_ACTIONS, buildPrompt, parseAgentReply, resolveChanges, minimalEdit, lineDiff, diffStats
} from "./tex-agent-core.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(label, className, icon, onClick, title) {
  const b = el("button", className);
  b.type = "button";
  if (icon) { b.append(el("i", `fa-solid ${icon}`)); if (label) b.append(document.createTextNode(` ${label}`)); } else b.textContent = label;
  if (title) { b.title = title; b.setAttribute("aria-label", title); }
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export function createTexAgent(root, deps) {
  const { getContext, applyEdits, setFileText, tryChange, setStatus } = deps;
  const history = [];
  let busy = false;
  let cancelled = false;
  let useSources = false;

  root.textContent = "";
  root.classList.add("ta-root");

  const head = el("div", "ta-head");
  const title = el("div", "ta-title");
  title.append(el("strong", "", "Ask ThinkerTex"), el("small", "", ""));
  const sourcesLabel = el("label", "ta-sources");
  const sourcesBox = el("input");
  sourcesBox.type = "checkbox";
  sourcesBox.addEventListener("change", () => { useSources = sourcesBox.checked; });
  sourcesLabel.append(sourcesBox, document.createTextNode(" Use my Thinkspace PDFs"));
  sourcesLabel.title = "Let the AI read short passages from the PDFs in this project's Thinkspace";
  sourcesLabel.hidden = true;
  head.append(title, sourcesLabel);

  const messages = el("div", "ta-messages");
  messages.setAttribute("aria-live", "polite");
  const chips = el("div", "ta-chips");
  const form = el("form", "ta-form");
  const input = el("textarea", "ta-input");
  input.rows = 2;
  input.placeholder = "Ask for a section, a table, a fix, or a rewrite of what you selected…";
  input.setAttribute("aria-label", "Ask ThinkerTex");
  const send = btn("", "btn primary ta-send", "fa-arrow-up", null, "Send");
  send.type = "submit";
  form.append(input, send);
  const usageLine = createUsageLine("ta-tokens");
  root.append(head, messages, chips, form, usageLine);

  const profile = () => {
    const all = getApiProfiles();
    return all.find((p) => p.id === getActiveApiProfileId()) || all[0] || null;
  };

  function refreshHeader() {
    const p = profile();
    title.querySelector("small").textContent = p ? `${p.label || "Your model"} · ${p.model}` : "No model connected";
    const ctx = getContext();
    sourcesLabel.hidden = !ctx.spaceId;
  }

  function addMessage(role, text) {
    const bubble = el("div", `ta-msg ${role}`);
    bubble.textContent = text;
    messages.append(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function welcome() {
    messages.textContent = "";
    const box = el("div", "ta-welcome");
    box.append(el("h3", "", "What shall we write?"),
      el("p", "", "I can write sections, tables and equations, rewrite what you select, and fix compile errors. I try my changes on a copy first, so you only see ones that compile. Nothing changes in your files until you press Apply."));
    messages.append(box);
  }

  QUICK_ACTIONS.forEach((action) => {
    const chip = btn(action.label, "ta-chip", "", () => run(action.request, action.id === "fix" ? "fix" : "write"));
    chips.append(chip);
  });

  function setBusy(on) {
    busy = on;
    input.disabled = on;
    send.innerHTML = on ? '<i class="fa-solid fa-stop"></i>' : '<i class="fa-solid fa-arrow-up"></i>';
    send.title = on ? "Stop" : "Send";
    chips.querySelectorAll("button").forEach((b) => { b.disabled = on; });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) { cancelled = true; return; }
    const request = input.value.trim();
    if (!request) return;
    input.value = "";
    run(request, "write");
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });

  // ---- one request, from words to a checked proposal -------------------------------------------------
  async function ask(prompt) {
    const p = profile();
    if (!p) throw new Error("Connect an AI model first. Open Settings and add a Gemini key, or point Thinker at a local model.");
    const result = await window.electronAPI.askLLM({
      profile: p, model: p.model, apiKey: p.key || "", parts: [{ text: prompt }],
      system: SYSTEM_PROMPT, maxTokens: 8000, timeoutMs: 150000
    });
    if (!result?.ok) throw new Error(friendlyAgentError(result?.error));
    trackAiUsage({ source: "ThinkerTex", profile: p, usage: result.usage });
    return result.text || "";
  }

  async function gatherSources(request, ctx) {
    if (!useSources || !ctx.spaceId) return [];
    try {
      const space = await window.electronAPI.getWorkspace(ctx.spaceId);
      const storagePath = await window.electronAPI.getUserDataPath();
      const found = [];
      for (const doc of space.documents.slice(0, 8)) {
        if (!doc.path) continue;
        const pdfId = await window.electronAPI.getPdfId(doc.path);
        const res = await window.electronAPI.queryPDF({ query: request, pdfId, storagePath, k: 2 });
        for (const chunk of res?.result?.chunks || []) found.push({ title: doc.title, page: chunk.page, text: String(chunk.text).slice(0, 700) });
      }
      return found.slice(0, 6);
    } catch {
      return [];
    }
  }

  function bibKeysFrom(ctx) {
    return ctx.files.filter((f) => /\.bib$/i.test(f.path)).map((f) => f.path);
  }

  async function bibKeys(ctx) {
    const keys = [];
    for (const path of bibKeysFrom(ctx)) {
      try {
        const text = await ctx.readFile(path);
        for (const m of String(text).matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)) keys.push(m[1]);
      } catch { /* an unreadable .bib adds no keys */ }
    }
    return keys;
  }

  async function run(request, mode) {
    if (busy) return;
    const ctx = getContext();
    refreshHeader();
    if (!messages.querySelector(".ta-msg")) messages.textContent = "";
    addMessage("user", mode === "fix" ? "Fix the compile errors." : request);
    const status = addMessage("status", "Thinking…");
    setBusy(true);
    cancelled = false;

    try {
      const originals = {};
      const original = async (path) => {
        if (!(path in originals)) originals[path] = ctx.files.some((f) => f.path === path) ? await ctx.readFile(path) : null;
        return originals[path];
      };
      await original(ctx.path);
      const candidate = {}; // full new text of each file the agent has changed so far
      const read = async (path) => (path in candidate ? candidate[path] : original(path));
      const sources = await gatherSources(request, ctx);
      const keys = await bibKeys(ctx);
      let problems = ctx.problems;
      let lastMessage = "";
      let verified = null; // null = not checked, true = compiles, false = still failing
      let note = "";
      let applyError = ""; // why the last reply could not be applied, if it could not

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (cancelled) throw new Error("Stopped.");
        status.textContent = attempt === 0 ? "Writing…" : `Fixing what did not compile (try ${attempt + 1} of ${MAX_ATTEMPTS})…`;
        const currentText = await read(ctx.path);
        const prompt = buildPrompt({
          request, project: ctx.project, files: ctx.files, current: { path: ctx.path, text: currentText, focusLine: ctx.selection ? 1 : 1 },
          selection: ctx.selection, problems, log: ctx.log, bibKeys: keys, sources, history: history.slice(-6),
          attempt, previous: attempt > 0, mode: attempt === 0 ? mode : "write", note
        });
        const reply = parseAgentReply(await ask(prompt));
        if (cancelled) throw new Error("Stopped.");
        lastMessage = reply.message || lastMessage;
        if (!reply.changes.length) {
          if (attempt === 0) { finishWithoutChanges(status, reply.message); remember(request, reply.message); return; }
          break;
        }

        let resolved;
        try {
          resolved = await resolveChanges(reply.changes, read);
        } catch (error) {
          applyError = error.message;
          note = `Your last reply could not be applied: ${error.message} Copy the text to replace exactly from the file shown.`;
          continue;
        }
        Object.assign(candidate, resolved);
        note = "";
        applyError = "";

        status.textContent = "Compiling to check it…";
        const result = await tryChange({ ...candidate });
        if (result.notReady) { verified = null; break; }
        if (result.ok) { verified = true; break; }
        verified = false;
        problems = result.problems;
      }

      const paths = Object.keys(candidate);
      if (!paths.length) {
        status.remove();
        // never repeat the model's claim that it made a change when nothing was applied
        addMessage("agent error", applyError
          ? `I could not make a change that applies cleanly (${applyError}) Try rephrasing, or select the exact text you want changed.`
          : "I could not make a change. Try rephrasing, or select the exact text you want changed.");
        remember(request, "(no change was applied)");
        return;
      }
      status.remove();
      await showProposal({ message: lastMessage, candidate, original, verified, problems, ctx });
      remember(request, lastMessage);
    } catch (error) {
      status.remove();
      addMessage("agent error", error.message);
    } finally {
      setBusy(false);
    }
  }

  function remember(request, message) {
    history.push({ role: "user", text: request }, { role: "agent", text: message || "(no message)" });
    while (history.length > 12) history.shift();
  }

  function finishWithoutChanges(status, message) {
    status.remove();
    addMessage("agent", message || "I did not find anything to change.");
  }

  async function showProposal({ message, candidate, original, verified, problems, ctx }) {
    const card = el("div", "ta-proposal");
    if (message) card.append(el("p", "ta-note", message));

    const files = [];
    for (const path of Object.keys(candidate)) {
      const before = (await original(path)) ?? "";
      const rows = lineDiff(before, candidate[path]);
      const stats = diffStats(rows);
      files.push({ path, before, after: candidate[path] });
      const box = el("div", "ta-file");
      const bar = el("div", "ta-file-head");
      bar.append(el("strong", "", path), el("span", "ta-stat", `+${stats.added} −${stats.removed}`));
      if (before === "") bar.append(el("span", "ta-new", "new file"));
      box.append(bar);
      const diff = el("div", "ta-diff");
      rows.slice(0, 220).forEach((row) => {
        const line = el("div", `ta-line ${row.type}`);
        line.append(el("span", "ta-sign", row.type === "add" ? "+" : row.type === "del" ? "−" : row.type === "gap" ? "" : " "), el("span", "ta-text", row.text));
        diff.append(line);
      });
      if (rows.length > 220) diff.append(el("div", "ta-line gap", `… ${rows.length - 220} more lines`));
      box.append(diff);
      card.append(box);
    }

    const state = el("div", "ta-verdict " + (verified === true ? "ok" : verified === false ? "bad" : "unknown"));
    if (verified === true) state.textContent = "✓ I compiled this on a copy and it works.";
    else if (verified === false) state.textContent = `✗ It still has ${problems.filter((p) => p.severity === "error").length} error(s) after ${MAX_ATTEMPTS} tries: ${problems.find((p) => p.severity === "error")?.message || "see the log"}. You can apply it and fix the rest by hand, or ask me again.`;
    else state.textContent = "I could not compile it to check (ThinkerTex is not set up yet). Review the changes before applying.";
    card.append(state);

    const actions = el("div", "ta-actions");
    const apply = btn("Apply", "btn primary", "fa-check", async () => {
      apply.disabled = true;
      reject.disabled = true;
      try {
        for (const f of files) {
          if (f.before === "" && !ctx.files.some((x) => x.path === f.path)) await setFileText(f.path, f.after);
          else if (f.path === ctx.path) {
            const edit = minimalEdit(f.before, f.after);
            await applyEdits(f.path, [{ from: edit.from, to: edit.to, insert: edit.insert }]);
          } else await setFileText(f.path, f.after);
        }
        actions.replaceChildren(el("span", "ta-done", "Applied. Press Ctrl+Z in the editor to undo."));
        setStatus("Changes applied.");
      } catch (error) {
        actions.replaceChildren(el("span", "ta-done bad", "Could not apply: " + error.message));
      }
    });
    const reject = btn("Reject", "btn", "fa-xmark", () => { actions.replaceChildren(el("span", "ta-done", "Rejected. Nothing was changed.")); });
    actions.append(apply, reject);
    card.append(actions);

    const bubble = el("div", "ta-msg agent wide");
    bubble.append(card);
    messages.append(bubble);
    messages.scrollTop = messages.scrollHeight;
  }

  welcome();
  refreshHeader();

  return {
    focus() { refreshHeader(); input.focus(); },
    fixErrors() { run("Fix the compiler errors.", "fix"); }
  };
}
