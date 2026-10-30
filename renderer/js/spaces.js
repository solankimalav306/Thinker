// Thinkspaces: the list, the Home row and the page for one Thinkspace.
// A Thinkspace groups PDFs and ThinkerTex projects. Removing things from it never deletes files.
import { timeAgo } from "./chat-groups.js";
import { createSpaceChat } from "./space-chat.js";

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#64748b"];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, icon, onClick, title) {
  const b = el("button", className);
  b.type = "button";
  if (icon) {
    const i = el("i", `fa-solid ${icon}`);
    b.append(i, document.createTextNode(` ${label}`));
  } else {
    b.textContent = label;
  }
  if (title) { b.title = title; b.setAttribute("aria-label", title); }
  b.addEventListener("click", onClick);
  return b;
}

function countLabel(space) {
  const docs = space.documentCount ?? space.documents?.length ?? 0;
  const projects = space.projectCount ?? space.projects?.length ?? 0;
  const parts = [`${docs} document${docs === 1 ? "" : "s"}`];
  if (projects) parts.push(`${projects} project${projects === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function createSpaces({ container, homeRow, api = window.electronAPI, openPdf, openPdfAt, openProject, newProject, setStatus, go }) {
  let currentId = null;
  let armedDelete = false;

  async function refreshHome() {
    if (!homeRow) return;
    const spaces = await api.listWorkspaces();
    homeRow.textContent = "";
    const head = el("div", "card-head");
    head.append(el("h3", "", "Your Thinkspaces"));
    const actions = el("div", "home-row-actions");
    actions.append(button("New", "btn", "fa-plus", () => createAndOpen(), "Create a new Thinkspace"));
    if (spaces.length) actions.append(button("See all", "btn", "", () => showList(), "See all Thinkspaces"));
    head.append(actions);
    homeRow.append(head);

    if (!spaces.length) {
      const empty = el("p", "space-empty-line", "A Thinkspace keeps related PDFs and writing together, so you can work across them. Make one for a paper, a course or a case.");
      homeRow.append(empty);
      return;
    }
    const grid = el("div", "space-grid compact");
    spaces.slice(0, 3).forEach((space) => grid.append(card(space)));
    homeRow.append(grid);
  }

  function card(space) {
    const c = el("button", "space-card");
    c.type = "button";
    c.style.setProperty("--space-color", space.color || COLORS[Math.abs(hash(space.id)) % COLORS.length]);
    const dot = el("span", "space-dot");
    const text = el("span", "space-card-text");
    text.append(el("strong", "", space.name), el("span", "", countLabel(space)));
    if (space.lastOpenedAt || space.updatedAt) text.append(el("small", "", timeAgo(space.lastOpenedAt || space.updatedAt)));
    c.append(dot, text);
    c.addEventListener("click", () => showDetail(space.id));
    return c;
  }

  function hash(text) {
    let h = 0;
    for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return h;
  }

  async function createAndOpen() {
    const space = await api.createWorkspace({ name: "Untitled Thinkspace" });
    setStatus("Thinkspace created. Give it a name.");
    await showDetail(space.id, { rename: true });
  }

  // ---- the list --------------------------------------------------------------------------------
  async function showList() {
    currentId = null;
    go();
    const spaces = await api.listWorkspaces();
    container.textContent = "";
    const page = el("div", "space-page");
    const head = el("header", "space-head");
    const title = el("div");
    title.append(el("p", "home-eyebrow", "Projects"), el("h1", "space-title", "Thinkspaces"),
      el("p", "space-sub", "A Thinkspace keeps related PDFs and writing projects together, so you can work across them."));
    head.append(title, button("New Thinkspace", "btn primary lg", "fa-plus", () => createAndOpen()));
    page.append(head);

    if (!spaces.length) {
      const empty = el("div", "space-empty");
      empty.append(el("i", "fa-solid fa-layer-group"), el("h3", "", "No Thinkspaces yet"),
        el("p", "", "Make one for a paper you are writing, a course, or a case. Add the PDFs you read for it and the LaTeX you write."));
      empty.append(button("Create your first Thinkspace", "btn primary", "fa-plus", () => createAndOpen()));
      page.append(empty);
    } else {
      const grid = el("div", "space-grid");
      spaces.forEach((space) => grid.append(card(space)));
      page.append(grid);
    }
    container.append(page);
  }

  // ---- one Thinkspace --------------------------------------------------------------------------
  async function showDetail(id, options = {}) {
    currentId = id;
    armedDelete = false;
    go();
    const space = await api.getWorkspace(id);
    if (!space) {
      setStatus("That Thinkspace is gone.");
      return showList();
    }
    api.markWorkspaceOpened(id);
    container.textContent = "";
    const page = el("div", "space-page");
    page.style.setProperty("--space-color", space.color || COLORS[Math.abs(hash(space.id)) % COLORS.length]);

    const back = button("All Thinkspaces", "btn space-back", "fa-chevron-left", () => showList());
    page.append(back);

    // name and description, edited in place
    const head = el("header", "space-head");
    const titleBox = el("div", "space-titlebox");
    const name = el("input", "space-name-input");
    name.type = "text";
    name.value = space.name;
    name.maxLength = 80;
    name.setAttribute("aria-label", "Thinkspace name");
    const saveName = async () => {
      const value = name.value.trim() || "Untitled Thinkspace";
      if (value !== space.name) {
        await api.updateWorkspace(id, { name: value });
        space.name = value;
        setStatus("Thinkspace renamed.");
      }
      name.value = value;
    };
    name.addEventListener("blur", saveName);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); if (e.key === "Escape") { name.value = space.name; name.blur(); } });
    const desc = el("textarea", "space-desc-input");
    desc.rows = 2;
    desc.maxLength = 500;
    desc.placeholder = "What is this Thinkspace for? (optional)";
    desc.value = space.description || "";
    desc.setAttribute("aria-label", "Thinkspace description");
    desc.addEventListener("blur", async () => {
      if (desc.value.trim() !== (space.description || "")) {
        await api.updateWorkspace(id, { description: desc.value.trim() });
        space.description = desc.value.trim();
      }
    });
    titleBox.append(name, desc);
    head.append(el("span", "space-dot big"), titleBox);
    page.append(head);

    // two columns on a wide window: documents and projects on the left, the Thinkspace chat on the right
    const layout = el("div", "space-layout");
    const main = el("div", "space-main");
    const side = el("aside", "space-chat-card");
    layout.append(main, side);

    // actions
    const actions = el("div", "space-actions");
    actions.append(
      button("Add PDFs", "btn primary", "fa-file-circle-plus", async () => {
        const files = await api.pickPdfs();
        if (files.length) await addFiles(files);
      }),
      button("New LaTeX project", "btn", "fa-pen-nib", () => newProject?.(id), "Start a ThinkerTex project in this Thinkspace"),
      button("Link a project", "btn", "fa-link", () => linkProjectMenu(space, actions), "Link a ThinkerTex project that already exists")
    );
    main.append(actions);

    // documents
    const docsCard = el("section", "space-section");
    const docsHead = el("div", "card-head");
    docsHead.append(el("h3", "", `Documents (${space.documents.length})`));
    docsCard.append(docsHead);
    const docList = el("ul", "space-list");
    docList.setAttribute("aria-label", "Documents in this Thinkspace");
    if (!space.documents.length) {
      const li = el("li", "space-list-empty", "No documents yet. Add PDFs, or drop them anywhere on this page.");
      docList.append(li);
    }
    space.documents.forEach((doc, index) => docList.append(docRow(space, doc, index)));
    docsCard.append(docList);
    main.append(docsCard);

    // projects
    const projCard = el("section", "space-section");
    const projHead = el("div", "card-head");
    projHead.append(el("h3", "", `ThinkerTex projects (${space.projects.length})`));
    projCard.append(projHead);
    const projList = el("ul", "space-list");
    projList.setAttribute("aria-label", "ThinkerTex projects in this Thinkspace");
    if (!space.projects.length) projList.append(el("li", "space-list-empty", "No LaTeX projects here yet. A project can also live on its own, outside any Thinkspace."));
    space.projects.forEach((project) => projList.append(projectRow(space, project)));
    projCard.append(projList);
    main.append(projCard);

    // danger zone
    const danger = el("div", "space-danger");
    const del = el("button", "btn danger-link");
    del.type = "button";
    del.textContent = "Delete this Thinkspace";
    del.addEventListener("click", async () => {
      if (!armedDelete) {
        armedDelete = true;
        del.textContent = "Click again to delete (your PDFs and files are not deleted)";
        del.classList.add("armed");
        setTimeout(() => { armedDelete = false; del.textContent = "Delete this Thinkspace"; del.classList.remove("armed"); }, 5000);
        return;
      }
      await api.deleteWorkspace(id);
      setStatus("Thinkspace deleted. Your PDFs and files were not touched.");
      showList();
    });
    danger.append(del);
    main.append(danger);
    page.append(layout);
    createSpaceChat(side, { api, space, openPdfAt: openPdfAt || ((path) => openPdf(path)), setStatus });

    // drop PDFs onto the page
    page.addEventListener("dragover", (e) => {
      if (Array.from(e.dataTransfer?.types || []).includes("Files")) { e.preventDefault(); page.classList.add("dropping"); }
    });
    page.addEventListener("dragleave", (e) => { if (!page.contains(e.relatedTarget)) page.classList.remove("dropping"); });
    page.addEventListener("drop", async (e) => {
      page.classList.remove("dropping");
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation(); // the window-level drop would open them instead
      const paths = files.map((f) => api.getPathForFile(f)).filter(Boolean);
      await addFiles(paths);
    });

    container.append(page);
    if (options.rename) { name.focus(); name.select(); }
  }

  async function addFiles(paths) {
    const result = await api.addWorkspaceDocuments(currentId, paths);
    const bits = [];
    if (result.added.length) bits.push(`Added ${result.added.length} PDF${result.added.length === 1 ? "" : "s"}.`);
    const dup = result.skipped.filter((s) => s.reason === "already-there").length;
    const bad = result.skipped.filter((s) => s.reason === "not-pdf").length;
    const gone = result.skipped.filter((s) => s.reason === "missing").length;
    if (dup) bits.push(`${dup} already there.`);
    if (bad) bits.push(`${bad} ${bad === 1 ? "is" : "are"} not a PDF.`);
    if (gone) bits.push(`${gone} could not be found.`);
    setStatus(bits.join(" ") || "Nothing to add.");
    await showDetail(currentId);
  }

  function docRow(space, doc, index) {
    const li = el("li", "space-row");
    li.draggable = true;
    li.dataset.id = doc.id;
    const icon = el("span", "space-row-icon");
    icon.append(el("i", "fa-solid fa-file-pdf"));
    const text = el("span", "space-row-text");
    text.append(el("strong", "", doc.title), el("small", "", doc.path || "File not found"));
    const open = button("Open", "btn", "fa-book-open", () => openPdf(doc.path), `Open ${doc.title}`);
    open.disabled = !doc.path;
    const up = button("", "btn icon-btn", "fa-arrow-up", () => move(space, index, -1), `Move ${doc.title} up`);
    const down = button("", "btn icon-btn", "fa-arrow-down", () => move(space, index, 1), `Move ${doc.title} down`);
    up.disabled = index === 0;
    down.disabled = index === space.documents.length - 1;
    const remove = button("", "btn icon-btn", "fa-xmark", async () => {
      await api.removeWorkspaceDocument(space.id, doc.id);
      setStatus(`${doc.title} removed from this Thinkspace. The file was not deleted.`);
      showDetail(space.id);
    }, `Remove ${doc.title} from this Thinkspace`);
    li.append(icon, text, open, up, down, remove);
    return li;
  }

  async function move(space, index, delta) {
    const order = space.documents.map((d) => d.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    await api.reorderWorkspaceDocuments(space.id, order);
    showDetail(space.id);
  }

  function projectRow(space, project) {
    const li = el("li", "space-row");
    const icon = el("span", "space-row-icon tex");
    icon.append(el("i", "fa-solid fa-pen-nib"));
    const text = el("span", "space-row-text");
    text.append(el("strong", "", project.name), el("small", "", project.rootPath));
    const open = button("Open", "btn", "fa-pen-to-square", () => openProject?.(project.id), `Open ${project.name} in ThinkerTex`);
    const unlink = button("", "btn icon-btn", "fa-link-slash", async () => {
      await api.unlinkProject(space.id, project.id);
      setStatus(`${project.name} unlinked. The project and its files are untouched.`);
      showDetail(space.id);
    }, `Unlink ${project.name} from this Thinkspace`);
    li.append(icon, text, open, unlink);
    return li;
  }

  async function linkProjectMenu(space, anchor) {
    anchor.querySelector(".space-menu")?.remove();
    const all = await api.listProjects();
    const linked = new Set(space.projects.map((p) => p.id));
    const choices = all.filter((p) => !linked.has(p.id));
    const menu = el("div", "space-menu");
    if (!choices.length) {
      menu.append(el("p", "space-menu-empty", all.length ? "All your projects are already linked." : "You have no ThinkerTex projects yet."));
    }
    choices.forEach((project) => {
      const item = button(project.name, "space-menu-item", "fa-pen-nib", async () => {
        await api.linkProject(space.id, project.id);
        setStatus(`${project.name} linked.`);
        showDetail(space.id);
      });
      menu.append(item);
    });
    anchor.append(menu);
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", close); } };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  }

  return { refreshHome, showList, showDetail, getCurrent: () => currentId };
}
