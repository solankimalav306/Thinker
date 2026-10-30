// The Artifacts screen: everything you chose to keep from a chat, apart from the chat itself.
// A card opens the artifact in the same sealed frame the chat uses; citations still open the PDF at that page.
import { timeAgo } from "./chat-groups.js";
import { createArtifactView } from "./artifact-view.js";
import { openShareDialog } from "./remote-share.js";

const KIND_LABELS = { page: "Page", table: "Table", chart: "Chart", slides: "Slides", document: "Document" };
const KIND_ICONS = { page: "fa-file-lines", table: "fa-table", chart: "fa-chart-simple", slides: "fa-display", document: "fa-file-word" };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, icon, onClick, title) {
  const b = el("button", className);
  b.type = "button";
  if (icon) b.append(el("i", `fa-solid ${icon}`));
  if (label) b.append(document.createTextNode(icon ? ` ${label}` : label));
  if (title) { b.title = title; b.setAttribute("aria-label", title); }
  b.addEventListener("click", onClick);
  return b;
}

export function createArtifactsLibrary({ container, api = window.electronAPI, openPdfAt, setStatus, go, onItem = () => {} }) {
  let filter = { search: "", kind: "" };
  let spaces = [];

  const safeName = (title) => title.replace(/[\\/:*?"<>|]+/g, "-");

  async function showList() {
    go?.();
    onItem({ kind: "artifact", id: null });
    container.textContent = "";
    const page = el("div", "lib-page");
    const head = el("div", "lib-head");
    const heading = el("div", "lib-heading");
    heading.append(el("h1", "lib-title", "Artifacts"), el("p", "lib-lead", "Tables, charts, slides and documents you kept from your chats."));
    const search = el("input", "lib-search");
    search.type = "search";
    search.placeholder = "Search by title";
    search.value = filter.search;
    search.setAttribute("aria-label", "Search artifacts");
    head.append(heading, search);

    const kinds = el("div", "lib-kinds");
    kinds.setAttribute("role", "group");
    kinds.setAttribute("aria-label", "Filter by kind");
    for (const [value, label] of [["", "All"], ...Object.entries(KIND_LABELS)]) {
      const chip = button(label, `ta-chip${filter.kind === value ? " active" : ""}`, "", () => { filter.kind = value; showList(); });
      chip.setAttribute("aria-pressed", String(filter.kind === value));
      kinds.append(chip);
    }

    const grid = el("div", "lib-grid");
    page.append(head, kinds, grid);
    container.append(page);

    spaces = await api.listWorkspaces().catch(() => []);
    const names = new Map(spaces.map((s) => [s.id, s.name]));
    const draw = async () => {
      const items = await api.listArtifacts({ search: filter.search, kind: filter.kind });
      grid.textContent = "";
      if (!items.length) {
        const empty = el("div", "lib-empty");
        empty.append(
          el("h3", "", filter.search || filter.kind ? "Nothing matches" : "No artifacts yet"),
          el("p", "", filter.search || filter.kind
            ? "Try a different search or kind."
            : "Ask a Thinkspace chat for a table, chart, timeline or flashcards, then press the bookmark on the card to keep it here.")
        );
        grid.append(empty);
        return;
      }
      for (const item of items) {
        const card = el("button", "lib-card");
        card.type = "button";
        const icon = el("span", "lib-card-icon");
        icon.append(el("i", `fa-solid ${KIND_ICONS[item.kind] || KIND_ICONS.page}`));
        const meta = [KIND_LABELS[item.kind] || "Page", timeAgo(item.updatedAt)];
        if (item.workspaceId && names.get(item.workspaceId)) meta.push(names.get(item.workspaceId));
        card.append(icon, el("strong", "lib-card-title", item.title), el("span", "lib-card-meta", meta.join(" · ")));
        card.addEventListener("click", () => open(item.id));
        grid.append(card);
      }
    };
    let timer = null;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => { filter.search = search.value.trim(); draw(); }, 150);
    });
    await draw();
  }

  async function open(id) {
    go?.();
    const item = await api.getArtifact(id);
    if (!item) { setStatus("That artifact no longer exists."); showList(); return; }
    spaces = await api.listWorkspaces().catch(() => spaces);
    onItem({ kind: "artifact", id: item.id, title: item.title });
    const space = item.workspaceId ? await api.getWorkspace(item.workspaceId).catch(() => null) : null;
    container.textContent = "";
    const page = el("div", "lib-page");

    const bar = el("div", "lib-bar");
    bar.append(button("All artifacts", "btn", "fa-arrow-left", () => showList()));
    const name = el("input", "lib-rename");
    name.value = item.title;
    name.maxLength = 120;
    name.setAttribute("aria-label", "Artifact title");
    const rename = async () => {
      const next = name.value.trim();
      if (!next || next === item.title) { name.value = item.title; return; }
      const saved = await api.updateArtifact(item.id, { title: next });
      item.title = saved.title;
      onItem({ kind: "artifact", id: item.id, title: saved.title });
      name.value = saved.title;
      setStatus("Renamed.");
    };
    name.addEventListener("change", rename);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });

    const where = el("select", "sc-select");
    where.setAttribute("aria-label", "Thinkspace");
    where.title = "Which Thinkspace this belongs to (optional)";
    where.append(new Option("No Thinkspace", ""));
    spaces.forEach((s) => where.append(new Option(s.name, s.id)));
    where.value = item.workspaceId || "";
    where.addEventListener("change", async () => {
      await api.updateArtifact(item.id, { workspaceId: where.value });
      setStatus("Updated.");
    });

    let armed = false;
    const del = button("Delete", "btn danger", "fa-trash", async () => {
      if (!armed) {
        armed = true;
        del.lastChild.textContent = " Press again to delete";
        setTimeout(() => { armed = false; del.lastChild.textContent = " Delete"; }, 3500);
        return;
      }
      await api.deleteArtifact(item.id);
      onItem({ kind: "artifact", id: item.id, gone: true });
      setStatus("Deleted.");
      showList();
    }, "Delete this artifact");
    bar.append(name, where, button("Share", "btn", "fa-share-nodes", () => openShareDialog({ kind: "artifact", id: item.id, title: item.title, api, setStatus }), "Share this on your network"), del);

    const docs = (space?.documents || []).map((d) => ({ ...d, title: d.title.replace(/\.pdf$/i, "") }));
    const view = createArtifactView({
      title: item.title,
      html: item.html,
      sources: item.sources,
      kind: item.kind,
      onCite: ({ doc, page: n }) => {
        const d = docs.find((x) => x.title.toLowerCase() === doc.toLowerCase());
        if (d?.path) openPdfAt(d.path, n);
        else setStatus("Add that document back to the Thinkspace to jump to the page.");
      },
      onSave: (file) => api.saveTextFile({ defaultPath: `${safeName(file.title)}.html`, content: file.content, filters: [{ name: "HTML page", extensions: ["html"] }] })
    });
    page.append(bar, view);
    container.append(page);
  }

  return { showList, open };
}
