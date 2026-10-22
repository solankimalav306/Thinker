import { applyTheme, applyAccent, getAccent, setAccent, resetAccent, ACCENT_PRESETS, DEFAULT_ACCENT } from "./theme.js";
import { escapeHtml } from "./safe-html.js";
import {
  getRecents,
  pushRecent,
  getApiProfiles,
  upsertApiProfile,
  removeApiProfile,
  getActiveApiProfileId,
  setActiveApiProfileId,
  getChatModel,
  setChatModel,
  getThemePalette,
  setThemePalette,
  getTheme,
  setTheme,
  getGlossary,
  addToGlossary,
  removeFromGlossary,
  getReadingState,
  saveReadingState,
  removeRecent
} from "./state.js";
import { renderDocState, clearDocState } from "./doc-state.js";
import { runTour } from "./tour-engine.js";
import { buildTours } from "./tours.js";
import { createOnboarding, TASKS, progress, nextTask } from "./onboarding.js";
import { renderHelp, openGuide } from "./help.js";
import { loadSettings, getSetting, setSetting, onSettingChange } from "./settings-registry.js";
import { registerAllSettings } from "./settings-definitions.js";
import { renderPreferences } from "./preferences-panel.js";
import { openInstructionsPanel } from "./instructions-panel.js";
import { PdfController } from "./pdf-controller.js";
import { AnnotationController } from "./annotation-controller.js";
import { SnipController } from "./snip-controller.js";
import { ChatController } from "./chat-controller.js";
import { PdfContextMenu } from "./pdf-context-menu.js";
import { DictionaryTooltip } from "./dictionary-tooltip.js";
import { NotesController } from "./notes-controller.js";
import { MindMapController } from "./mindmap-controller.js";
import { StickyNotesController } from "./sticky-notes-controller.js";
import { HistoryController } from "./history-controller.js";
import { FindController } from "./find-controller.js";
import { refreshTokenDashboard } from "./token-usage.js";

const elements = {
  appShell: document.querySelector(".app-shell"),
  activeFileLabel: document.getElementById("active-file-label"),
  statusText: document.getElementById("status-text"),
  statusToast: document.getElementById("status-toast"),
  controlStrip: document.getElementById("control-strip"),
  welcomeScreen: document.getElementById("welcome-screen"),
  settingsScreen: document.getElementById("settings-screen"),
  recentList: document.getElementById("recent-list"),
  pdfTabs: document.getElementById("pdf-tabs"),
  readerLayout: document.getElementById("reader-layout"),
  pdfStage: document.getElementById("pdf-stage"),
  multiView: document.getElementById("pdf-multi-view"),
  readerSidebar: document.getElementById("reader-sidebar"),
  outlineBlock: document.getElementById("outline-block"),
  thumbsBlock: document.getElementById("thumbs-block"),
  outlineList: document.getElementById("outline-list"),
  thumbnailList: document.getElementById("thumbnail-list"),
  welcomeOpenBtn: document.getElementById("welcome-open-btn"),
  welcomeSettingsBtn: document.getElementById("welcome-settings-btn"),
  navHome: document.getElementById("nav-home"),
  navReader: document.getElementById("nav-reader"),
  navSettings: document.getElementById("nav-settings"),
  navOutline: document.getElementById("nav-outline"),
  navThumbs: document.getElementById("nav-thumbs"),
  navChat: document.getElementById("nav-chat"),
  chatPanel: document.getElementById("chat-panel"),
  aiCapabilitiesBtn: document.getElementById("ai-capabilities-btn"),
  aiCapabilitiesModal: document.getElementById("ai-capabilities-modal"),
  closeAiCapabilities: document.getElementById("close-ai-capabilities"),
  chatResizer: document.getElementById("chat-resizer"),
  sidebarResizer: document.getElementById("sidebar-resizer"),
  navGlossary: document.getElementById("nav-glossary"),
  glossaryBlock: document.getElementById("glossary-block"),
  glossaryList: document.getElementById("glossary-list"),
  glossarySearch: document.getElementById("glossary-search"),
  glossaryExportBtn: document.getElementById("glossary-export-btn"),
  navNotes: document.getElementById("nav-notes"),
  navHistory: document.getElementById("nav-history"),
  notesBlock: document.getElementById("notes-block"),
  historyBlock: document.getElementById("history-block"),
  historyList: document.getElementById("history-list"),
  historyRefreshBtn: document.getElementById("history-refresh-btn"),
  notesList: document.getElementById("notes-list"),
  stickyNotesList: document.getElementById("sticky-notes-list"),
  navMindmaps: document.getElementById("nav-mindmaps"),
  mindmapsBlock: document.getElementById("mindmaps-block"),
  mindmapsList: document.getElementById("mindmaps-list"),
  mindmapNewBtn: document.getElementById("mindmap-new-btn"),
  exportMd: document.getElementById("export-md"),
  exportPdf: document.getElementById("export-pdf"),
  exportLatex: document.getElementById("export-latex"),
  mindmapModal: document.getElementById("mindmap-modal"),
  mindmapViewer: document.getElementById("mindmap-viewer"),
  closeMindmap: document.getElementById("close-mindmap"),
  exportMindmapSvg: document.getElementById("export-mindmap-svg"),
  chatCloseBtn: document.getElementById("chat-close-btn"),
  prevBtn: document.getElementById("prev-page"),
  nextBtn: document.getElementById("next-page"),
  zoomInBtn: document.getElementById("zoom-in"),
  zoomOutBtn: document.getElementById("zoom-out"),
  zoomInput: document.getElementById("zoom-percent"),
  fitModeSelect: document.getElementById("fit-mode"),
  pageNumEl: document.getElementById("page-num"),
  pageCountEl: document.getElementById("page-count"),
  pdfViewer: document.getElementById("pdf-viewer"),
  canvas: document.getElementById("pdf-render"),
  textLayer: document.getElementById("text-layer"),
  annotationCanvas: document.getElementById("annotation-canvas"),
  snipSelection: document.getElementById("snip-selection"),
  screenshotBtn: document.getElementById("screenshot-btn"),
  saveAnnotationsBtn: document.getElementById("save-annotations-btn"),
  saveModal: document.getElementById("save-modal"),
  saveModalClose: document.getElementById("save-modal-close"),
  saveModalCancel: document.getElementById("save-modal-cancel"),
  saveModalConfirm: document.getElementById("save-modal-confirm"),
  saveOptPen: document.getElementById("save-opt-pen"),
  saveOptSticky: document.getElementById("save-opt-sticky"),
  saveOptHighlights: document.getElementById("save-opt-highlights"),
  saveOptNotes: document.getElementById("save-opt-notes"),
  saveOptFlatten: document.getElementById("save-opt-flatten"),
  statStrokes: document.getElementById("stat-strokes"),
  statHighlights: document.getElementById("stat-highlights"),
  statStickies: document.getElementById("stat-stickies"),
  statNotes: document.getElementById("stat-notes"),
  userStickyBtn: document.getElementById("sticky-note-btn"),
  userStickyDialog: document.getElementById("user-sticky-dialog"),
  userStickyText: document.getElementById("user-sticky-text"),
  userStickyConfirm: document.getElementById("user-sticky-confirm"),
  userStickyCancel: document.getElementById("user-sticky-cancel"),
  userStickyClose: document.getElementById("user-sticky-close"),
  tabResearchNotes: document.getElementById("tab-research-notes"),
  tabStickyNotes: document.getElementById("tab-sticky-notes"),
  panelResearch: document.getElementById("panel-research"),
  panelSticky: document.getElementById("panel-sticky"),
  addUserStickyBtn: document.getElementById("add-user-sticky-btn"),
  eraserBtn: document.getElementById("eraser-btn"),
  modeSingleBtn: document.getElementById("mode-single"),
  modeTwoBtn: document.getElementById("mode-two"),
  modeScrollBtn: document.getElementById("mode-scroll"),
  penControls: document.getElementById("pen-controls"),
  highlighterControls: document.getElementById("highlighter-controls"),
  penColorInput: document.getElementById("pen-color"),
  penWidthInput: document.getElementById("pen-width"),
  highlighterColorInput: document.getElementById("highlighter-color"),
  highlighterWidthInput: document.getElementById("highlighter-width"),
  penButtons: [
    document.getElementById("pen-1"),
    document.getElementById("pen-2"),
    document.getElementById("pen-3")
  ],
  highlighterButtons: [
    document.getElementById("highlighter-1"),
    document.getElementById("highlighter-2")
  ],
  chatHistory: document.getElementById("chat-history"),
  chatInput: document.getElementById("chat-input"),
  chatSend: document.getElementById("chat-send"),
  selectedTextBox: document.getElementById("selected-text-box"),
  imagePreviewContainer: document.getElementById("image-preview-container"),
  settingsApiLabel: document.getElementById("settings-api-label"),
  settingsApiKey: document.getElementById("settings-api-key"),
  settingsApiAdd: document.getElementById("settings-api-add"),
  settingsActiveApi: document.getElementById("settings-active-api"),
  settingsApiList: document.getElementById("settings-api-list"),
  chatProfileSelect: document.getElementById("chat-profile-select"),
  settingsApiFormat: document.getElementById("settings-api-format"),
  settingsApiUrl: document.getElementById("settings-api-url"),
  settingsChatModel: document.getElementById("settings-chat-model"),
  settingsThemeMode: document.getElementById("settings-theme-mode"),
  settingsCustomColor: document.getElementById("settings-custom-color"),
  resetColorBtn: document.getElementById("reset-color-btn"),
  homeGreeting: document.getElementById("home-greeting"),
  homeEyebrow: document.getElementById("home-eyebrow"),
  usageSummary: document.getElementById("usage-summary"),
  tokenUsagePanel: document.getElementById("token-usage-panel"),
  docState: document.getElementById("doc-state"),
  tourOffer: document.getElementById("tour-offer"),
  navHelp: document.getElementById("nav-help"),
  helpScreen: document.getElementById("help-screen"),
  helpContent: document.getElementById("help-content"),
  gettingStarted: document.getElementById("getting-started"),
  gsList: document.getElementById("gs-list"),
  gsSub: document.getElementById("gs-sub"),
  gsFill: document.getElementById("gs-fill"),
  pdfContainer: document.querySelector(".pdf-container"),
  accentSwatches: document.getElementById("accent-swatches"),
  titleTyping: document.getElementById("title-typing"),
  tokenUsageEmpty: document.getElementById("token-usage-empty"),
  tokenUsageStats: document.getElementById("token-usage-stats"),
  statPromptTokens: document.getElementById("stat-prompt-tokens"),
  statResponseTokens: document.getElementById("stat-response-tokens"),
  statTotalTokens: document.getElementById("stat-total-tokens"),
  statTotalRequests: document.getElementById("stat-total-requests"),
  statLastTokens: document.getElementById("stat-last-tokens"),
  barPrompt: document.getElementById("bar-prompt"),
  barResponse: document.getElementById("bar-response"),
  tokenBreakdownChart: document.getElementById("token-breakdown-chart"),
  tokenUsageGraph: document.getElementById("token-usage-graph"),
  tokenUsageProfileFilter: document.getElementById("token-usage-profile-filter"),
  tokenTracker: document.getElementById("token-tracker"),
  chatModeSelect: document.getElementById("chat-mode-select"),
  summarizeCacheBtn: document.getElementById("summarize-cache-btn"),
};

let openTabs = [];
let activeTabPath = null;
let currentView = "home";
let sidebarVisible = true;
let sidebarPanel = "outline";
let notesPanelTab = "research"; // "research" or "sticky"
let isPlacingSticky = false;
let stickyPlacementPoint = null;
// Docked beside the document on wide windows; on narrow ones it is a drawer, closed until asked for.
let chatVisible = window.innerWidth >= 1360;
let apiProfiles = [];
const tabViewState = new Map();
const tabActionHandlers = {
  onActivate: null,
  onHome: null,
  onSettings: null,
  onClose: null,
  onAdd: null
};

function setStatus(text) {
  if (elements.statusText) {
    elements.statusText.textContent = text;
  }
  if (elements.statusToast) {
    elements.statusToast.classList.add("show");
    clearTimeout(elements.statusToast.hideTimeout);
    elements.statusToast.hideTimeout = setTimeout(() => {
      elements.statusToast.classList.remove("show");
    }, 4000);
  }
}

function setActiveNav(button) {
  [elements.navHome, elements.navReader, elements.navSettings].forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
}

function syncLayoutToggles() {
  const hasPdf = Boolean(activeTabPath);
  const isReader = currentView === "reader" && hasPdf;
  const showSidebar = isReader && sidebarVisible;
  const showChat = isReader && chatVisible;

  elements.welcomeScreen.classList.toggle("visible", currentView === "home");
  elements.settingsScreen.classList.toggle("visible", currentView === "settings");
  elements.helpScreen.classList.toggle("visible", currentView === "help");
  elements.readerLayout.classList.toggle("visible", isReader);
  elements.readerLayout.classList.toggle("sidebar-hidden", !showSidebar);
  elements.readerSidebar.classList.toggle("hidden", !showSidebar);
  elements.outlineBlock.classList.toggle("visible", showSidebar && sidebarPanel === "outline");
  elements.thumbsBlock.classList.toggle("visible", showSidebar && sidebarPanel === "thumbs");
  elements.appShell.classList.toggle("home-mode", currentView !== "reader");
  elements.appShell.classList.toggle("chat-hidden", !showChat);

  elements.navHome.classList.toggle("active", currentView === "home");
  elements.navReader.classList.toggle("active", currentView === "reader");
  elements.navSettings.classList.toggle("active", currentView === "settings");
  elements.navHelp.classList.toggle("active", currentView === "help");
  elements.navOutline.classList.toggle("active", showSidebar && sidebarPanel === "outline");
  elements.navThumbs.classList.toggle("active", showSidebar && sidebarPanel === "thumbs");
  elements.navGlossary.classList.toggle("active", showSidebar && sidebarPanel === "glossary");
  elements.navNotes?.classList.toggle("active", showSidebar && sidebarPanel === "notes");
  elements.navHistory?.classList.toggle("active", showSidebar && sidebarPanel === "history");
  elements.navMindmaps?.classList.toggle("active", showSidebar && sidebarPanel === "mindmaps");
  elements.navChat?.classList.toggle("active", showChat);

  elements.glossaryBlock?.classList.toggle("visible", showSidebar && sidebarPanel === "glossary");
  elements.notesBlock?.classList.toggle("visible", showSidebar && sidebarPanel === "notes");
  elements.historyBlock?.classList.toggle("visible", showSidebar && sidebarPanel === "history");
  elements.mindmapsBlock?.classList.toggle("visible", showSidebar && sidebarPanel === "mindmaps");

  // Notes internal tabs
  if (sidebarPanel === "notes") {
    elements.tabResearchNotes?.classList.toggle("active", notesPanelTab === "research");
    elements.tabStickyNotes?.classList.toggle("active", notesPanelTab === "sticky");
    elements.panelResearch?.classList.toggle("active", notesPanelTab === "research");
    elements.panelSticky?.classList.toggle("active", notesPanelTab === "sticky");
  }
}

const HOME_LINES = [
  "What are we reading today?",
  "Your reading desk",
  "Pick up a good PDF",
  "Curious about something?"
];

function setHomeGreeting() {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  if (elements.homeGreeting) elements.homeGreeting.textContent = `${part}.`;
  if (elements.homeEyebrow) elements.homeEyebrow.textContent = HOME_LINES[new Date().getDate() % HOME_LINES.length];
}

function showWelcome() {
  currentView = "home";
  setHomeGreeting();
  syncLayoutToggles();
  renderTabs();
  refreshTokenDashboard(elements, elements.tokenUsageProfileFilter?.value || "all");
}

function showHelp() {
  currentView = "help";
  syncLayoutToggles();
  renderTabs();
}

function showSettings() {
  currentView = "settings";
  syncLayoutToggles();
  renderTabs();
}

function showReader() {
  currentView = "reader";
  syncLayoutToggles();
  renderTabs();
}

function setActiveModeButton(mode) {
  const map = {
    single: elements.modeSingleBtn,
    two: elements.modeTwoBtn,
    scroll: elements.modeScrollBtn
  };

  [elements.modeSingleBtn, elements.modeTwoBtn, elements.modeScrollBtn].forEach((btn) => {
    btn.classList.remove("active");
  });

  if (map[mode]) {
    map[mode].classList.add("active");
  }
}

function tabFileName(path) {
  return path.split(/[/\\]/).pop() || "Untitled";
}

function renderTabs(
  onActivate = tabActionHandlers.onActivate,
  onHome = tabActionHandlers.onHome,
  onSettings = tabActionHandlers.onSettings,
  onClose = tabActionHandlers.onClose,
  onAdd = tabActionHandlers.onAdd
) {
  elements.pdfTabs.innerHTML = "";

  const homeTab = document.createElement("button");
  homeTab.type = "button";
  homeTab.className = `pdf-tab pdf-tab-home ${currentView === "home" ? "active" : ""}`;
  homeTab.innerHTML = '<span class="tab-title"><i class="fa-solid fa-house"></i> Home</span>';
  homeTab.addEventListener("click", onHome);
  elements.pdfTabs.appendChild(homeTab);

  openTabs.forEach((path) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `pdf-tab ${currentView === "reader" && path === activeTabPath ? "active" : ""}`;
    tab.draggable = true;

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tabFileName(path);
    title.title = path;
    tab.appendChild(title);

    const close = document.createElement("button");
    close.className = "tab-close";
    close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    close.title = "Close tab";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      onClose(path);
    });
    tab.appendChild(close);

    tab.addEventListener("click", () => onActivate(path));

    // Drag & Drop events for tab reordering and drag-out
    tab.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", path);
      e.dataTransfer.effectAllowed = "move";
      tab.classList.add("dragging");
    });

    tab.addEventListener("dragend", (e) => {
      tab.classList.remove("dragging");
      document.querySelectorAll(".pdf-tab").forEach(t => t.classList.remove("drag-over"));
      
      const isOutside = (
        e.screenX < window.screenX ||
        e.screenX > window.screenX + window.outerWidth ||
        e.screenY < window.screenY ||
        e.screenY > window.screenY + window.outerHeight
      );
      
      if (isOutside) {
        window.electronAPI.createWindow(path);
        closeTab(path);
        if (openTabs.length === 0) {
          window.close();
        }
      }
    });

    tab.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      tab.classList.add("drag-over");
    });

    tab.addEventListener("dragleave", () => {
      tab.classList.remove("drag-over");
    });

    tab.addEventListener("drop", (e) => {
      e.preventDefault();
      tab.classList.remove("drag-over");
      const draggedPath = e.dataTransfer.getData("text/plain");
      if (draggedPath && draggedPath !== path) {
        const fromIndex = openTabs.indexOf(draggedPath);
        const toIndex = openTabs.indexOf(path);
        if (fromIndex > -1 && toIndex > -1) {
          openTabs.splice(fromIndex, 1);
          openTabs.splice(toIndex, 0, draggedPath);
          renderAll();
        }
      }
    });

    elements.pdfTabs.appendChild(tab);
  });

  const addTab = document.createElement("button");
  addTab.type = "button";
  addTab.className = "pdf-tab tab-add";
  addTab.title = "Open a PDF in a new tab";
  addTab.setAttribute("aria-label", "Open a PDF in a new tab");
  addTab.innerHTML = '<i class="fa-solid fa-plus"></i>';
  addTab.addEventListener("click", onAdd);
  elements.pdfTabs.appendChild(addTab);
}

function parentFolder(path) {
  const parts = path.split(/[/\\]/);
  parts.pop();
  return parts.slice(-2).join(" / ") || path;
}

function renderRecents(onPick) {
  const recents = getRecents().slice(0, 6);
  elements.recentList.textContent = "";

  if (recents.length === 0) {
    const empty = document.createElement("li");
    empty.className = "recent-empty";
    empty.textContent = "Nothing here yet. Open a PDF and it will wait for you here.";
    elements.recentList.appendChild(empty);
    return;
  }

  recents.forEach((path) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recent-item-btn";
    btn.title = path;

    const icon = document.createElement("span");
    icon.className = "recent-item-icon";
    icon.innerHTML = '<i class="fa-solid fa-file-lines"></i>';

    const text = document.createElement("span");
    text.className = "recent-item-text";
    const name = document.createElement("span");
    name.className = "recent-item-name";
    name.textContent = tabFileName(path);
    const folder = document.createElement("span");
    folder.className = "recent-item-path";
    folder.textContent = parentFolder(path);
    text.append(name, folder);

    const resume = getReadingState(path);
    if (resume && resume.pageNum > 1) {
      const meta = document.createElement("span");
      meta.className = "recent-item-meta";
      meta.textContent = `Continue on page ${resume.pageNum}`;
      text.appendChild(meta);
    }

    btn.append(icon, text);
    btn.addEventListener("click", () => onPick(path));
    li.appendChild(btn);
    elements.recentList.appendChild(li);
  });
}

function getSelectionTextInTextLayer() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return "";
  }

  let node = selection.getRangeAt(0).commonAncestorContainer;
  while (node) {
    if (node.classList && node.classList.contains("textLayer")) {
      return selection.toString().trim();
    }
    node = node.parentNode;
  }

  return "";
}

function getMaskedKey(key) {
  if (!key) {
    return "";
  }

  if (key.length <= 10) {
    return "•".repeat(Math.max(4, key.length));
  }

  return `${key.slice(0, 6)}${"•".repeat(Math.max(6, key.length - 12))}${key.slice(-4)}`;
}

function getCurrentChatConfig() {
  const profiles = getApiProfiles();
  const selectedId = getActiveApiProfileId();
  const selectedProfile = profiles.find((profile) => profile.id === selectedId) || profiles[0] || null;
  const model = selectedProfile?.model || getChatModel() || "gemini-3.5-flash-lite";

  return {
    profile: selectedProfile,
    apiKey: selectedProfile?.key || "",
    apiKeyLabel: selectedProfile?.label || "No profile selected",
    model
  };
}

function renderThemeSettings() {
  elements.settingsThemeMode.value = getTheme() === "light" ? "light" : "dark";

  const accent = getAccent();
  elements.settingsCustomColor.value = accent;
  if (elements.accentSwatches) {
    if (!elements.accentSwatches.childElementCount) {
      ACCENT_PRESETS.forEach((preset) => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "accent-swatch";
        swatch.style.background = preset.value;
        swatch.title = preset.name;
        swatch.setAttribute("aria-label", `${preset.name} accent`);
        swatch.dataset.color = preset.value;
        swatch.addEventListener("click", () => {
          setAccent(preset.value);
          renderThemeSettings();
        });
        elements.accentSwatches.appendChild(swatch);
      });
    }
    elements.accentSwatches.querySelectorAll(".accent-swatch").forEach((swatch) => {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.color.toLowerCase() === accent.toLowerCase()));
    });
  }
}

function renderSettings() {
  apiProfiles = getApiProfiles();
  const activeId = getActiveApiProfileId() || apiProfiles[0]?.id || "";
  if (activeId && !apiProfiles.some((profile) => profile.id === activeId)) {
    setActiveApiProfileId(apiProfiles[0]?.id || "");
  }

  elements.settingsActiveApi.innerHTML = "";
  if (apiProfiles.length === 0) {
    const fallback = document.createElement("option");
    fallback.value = "";
    fallback.textContent = "No profile saved";
    elements.settingsActiveApi.appendChild(fallback);
  } else {
    apiProfiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.label;
      elements.settingsActiveApi.appendChild(option);
    });
  }

  elements.settingsActiveApi.value = getActiveApiProfileId() || apiProfiles[0]?.id || "";

  if (elements.chatProfileSelect) {
    elements.chatProfileSelect.innerHTML = elements.settingsActiveApi.innerHTML;
    elements.chatProfileSelect.value = elements.settingsActiveApi.value;
    elements.chatProfileSelect.onchange = (event) => {
      setActiveApiProfileId(event.target.value);
      renderSettings();
    };
  }

  if (elements.tokenUsageProfileFilter) {
    const currentFilter = elements.tokenUsageProfileFilter.value || "all";
    elements.tokenUsageProfileFilter.innerHTML = '<option value="all">All Profiles</option>';
    apiProfiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.label;
      elements.tokenUsageProfileFilter.appendChild(option);
    });
    elements.tokenUsageProfileFilter.value = currentFilter;
    elements.tokenUsageProfileFilter.onchange = () => {
      refreshTokenDashboard(elements, elements.tokenUsageProfileFilter.value);
    };
  }

  elements.settingsChatModel.value = getChatModel();
  renderThemeSettings();

  elements.settingsApiList.innerHTML = "";
  if (apiProfiles.length === 0) {
    const empty = document.createElement("li");
    empty.className = "settings-api-item";
    empty.textContent = "No AI model yet. Add one below to start chatting.";
    elements.settingsApiList.appendChild(empty);
  } else {
    apiProfiles.forEach((profile) => {
      const item = document.createElement("li");
      item.className = "settings-api-item";

      const isActive = profile.id === (getActiveApiProfileId() || apiProfiles[0]?.id);
      item.classList.toggle("is-active", isActive);

      const meta = document.createElement("div");
      meta.className = "settings-api-meta";
      const label = document.createElement("div");
      label.className = "settings-api-label";
      label.textContent = profile.label;
      if (isActive) {
        const badge = document.createElement("span");
        badge.className = "chip";
        badge.textContent = "In use";
        label.appendChild(badge);
      }
      const detail = document.createElement("div");
      detail.className = "settings-api-key";
      detail.textContent = [
        profile.format === "openai" ? "OpenAI-compatible" : "Gemini",
        profile.model,
        profile.url,
        profile.key ? "key saved securely" : "no key"
      ].filter(Boolean).join(" \u00b7 ");
      meta.append(label, detail);

      const actions = document.createElement("div");
      actions.className = "settings-api-actions";

      const useBtn = document.createElement("button");
      useBtn.className = "btn";
      useBtn.textContent = "Use";
      useBtn.disabled = isActive;
      useBtn.addEventListener("click", () => {
        setActiveApiProfileId(profile.id);
        renderSettings();
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn danger";
      deleteBtn.textContent = "Remove";
      deleteBtn.addEventListener("click", () => {
        removeApiProfile(profile.id);
        renderSettings();
      });

      actions.appendChild(useBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(meta);
      item.appendChild(actions);
      elements.settingsApiList.appendChild(item);
    });
  }
}

function clearFieldErrors(form) {
  form.querySelectorAll(".field-error").forEach((node) => node.remove());
  form.querySelectorAll("[aria-invalid]").forEach((input) => input.removeAttribute("aria-invalid"));
}

function showFieldError(input, message) {
  input.setAttribute("aria-invalid", "true");
  const note = document.createElement("span");
  note.className = "field-error";
  note.textContent = message;
  input.closest(".field")?.appendChild(note);
}

function addApiKeyFromSettings() {
  const form = elements.settingsApiAdd.closest(".settings-inline-form");
  clearFieldErrors(form);

  const format = elements.settingsApiFormat ? elements.settingsApiFormat.value : "gemini";
  const url = elements.settingsApiUrl ? elements.settingsApiUrl.value.trim() : "";
  const model = elements.settingsChatModel.value.trim();
  const key = elements.settingsApiKey.value.trim();
  const label = elements.settingsApiLabel.value.trim() || `${format === "openai" ? "OpenAI-compatible" : "Gemini"} ${apiProfiles.length + 1}`;
  const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])/i.test(url);

  const problems = [];
  if (!model) problems.push([elements.settingsChatModel, "Enter a model name, for example gemini-3.5-flash-lite."]);
  if (!key && !isLocal) problems.push([elements.settingsApiKey, "Paste your API key. It can stay empty only for a model running on this computer."]);
  if (problems.length > 0) {
    problems.forEach(([input, message]) => showFieldError(input, message));
    problems[0][0].focus();
    setStatus("Fill in the highlighted fields to add this model.");
    const clear = () => clearFieldErrors(form);
    form.addEventListener("input", clear, { once: true });
    return;
  }

  const id = `api-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  upsertApiProfile({ id, label, format, url, model, key });
  setActiveApiProfileId(id);

  elements.settingsApiLabel.value = "";
  if (elements.settingsApiUrl) elements.settingsApiUrl.value = "";
  elements.settingsApiKey.value = "";

  renderSettings();
  window.dispatchEvent(new CustomEvent("thinker:milestone", { detail: "model" }));
  setStatus(`${label} saved and ready to use.`);
}

async function boot() {
  applyTheme();

  elements.fitModeSelect.value = "auto";
  registerAllSettings();
  await loadSettings();

  const embeddingsStoragePath = await window.electronAPI.getUserDataPath();

  // Remember page, zoom and view mode per document (debounced, so scrolling doesn't hammer storage).
  let readingStateTimer = null;
  function scheduleReadingStateSave(path, viewState) {
    if (!path || !getSetting("reading.rememberPosition")) return;
    clearTimeout(readingStateTimer);
    readingStateTimer = setTimeout(() => saveReadingState(path, viewState), 600);
  }

  const pdf = new PdfController({
    canvas: elements.canvas,
    textLayerDiv: elements.textLayer,
    pdfViewer: elements.pdfViewer,
    multiView: elements.multiView,
    pageNumEl: elements.pageNumEl,
    pageCountEl: elements.pageCountEl,
    zoomInput: elements.zoomInput,
    fitModeSelect: elements.fitModeSelect,
    stageElement: elements.pdfStage,
    prevBtn: elements.prevBtn,
    nextBtn: elements.nextBtn,
    outlineList: elements.outlineList,
    thumbnailList: elements.thumbnailList,
    storagePath: embeddingsStoragePath,
    onStatus: setStatus,
    onViewChange: scheduleReadingStateSave,
    onLoadError: (info) => showDocState(info),
    onPathChange: (name) => {
      if (elements.activeFileLabel) {
        elements.activeFileLabel.textContent = name;
      }
    },
    onRendered: (meta) => {
      setActiveModeButton(meta.mode);
      if (meta.annotationSupported) {
        annotation.setEnabled(true);
        annotation.resizeTo(elements.canvas.width, elements.canvas.height);
        annotation.loadPageAnnotations();
      } else {
        annotation.setEnabled(false);
        snip.stop();
      }

      elements.screenshotBtn.disabled = !meta.annotationSupported;
    }
  });

  // ── Find Controller (Ctrl+F) ─────────────────────────────────────────
  const findCtrl = new FindController({
    pdfController: pdf,
    findBar:   document.getElementById('find-bar'),
    findInput: document.getElementById('find-input'),
    findCount: document.getElementById('find-count'),
    findPrev:  document.getElementById('find-prev'),
    findNext:  document.getElementById('find-next'),
    findClose: document.getElementById('find-close'),
    findCase:  document.getElementById('find-case'),
  });

  // Re-run find after every page render so new text layers get highlighted
  const _origOnRendered = pdf.onRendered;
  pdf.onRendered = (meta) => {
    if (typeof _origOnRendered === 'function') _origOnRendered(meta);
    // Small delay to let PDF.js finish painting the text layer
    if (document.getElementById('find-bar').style.display !== 'none' &&
        document.getElementById('find-input').value) {
      setTimeout(() => findCtrl._run(), 200);
    }
  };

  const annotation = new AnnotationController({
    canvas: elements.annotationCanvas,
    pdfViewer: elements.pdfViewer,
    textLayer: elements.textLayer,
    penControls: elements.penControls,
    highlighterControls: elements.highlighterControls,
    penColorInput: elements.penColorInput,
    penWidthInput: elements.penWidthInput,
    highlighterColorInput: elements.highlighterColorInput,
    highlighterWidthInput: elements.highlighterWidthInput,
    penButtons: elements.penButtons,
    highlighterButtons: elements.highlighterButtons,
    eraserButton: elements.eraserBtn,
    onStatus: setStatus,
    getStorageKeyForPage: (pageNum) => `pdf-annotations:${pdf.getCurrentPath()}:page-${pageNum}`,
    getCurrentPage: () => pdf.getPageNum(),
    getPageCount: () => pdf.getPageCount()
  });

  const stickyNotes = new StickyNotesController({
    list: elements.stickyNotesList,
    annotation,
    pdf,
    onStatus: setStatus
  });

  const notes = new NotesController({
    notesList: elements.notesList,
    onStatus: setStatus
  });

  const history = new HistoryController({
    list: elements.historyList,
    getPdfPath: () => pdf.getCurrentPath(),
    onStatus: setStatus,
    onRevert: (entry) => {
      annotation.applyDocumentAnnotations(entry.annotationsByPage || {});
      pdf.setPersistentHighlightsByPage(entry.highlightTextsByPage || {});
      stickyNotes.refresh();
      try {
        if (pdf.viewMode === "single" && pdf.textLayerDiv) {
          pdf.applyHighlightsToLayer(pdf.textLayerDiv, pdf.getPageNum());
        } else if (pdf.multiView) {
          const cards = Array.from(pdf.multiView.querySelectorAll('.pdf-page-card'));
          for (const card of cards) {
            const pageNum = Number(card.dataset.page);
            const textLayer = card.querySelector('.pdf-page-text-layer');
            if (textLayer) pdf.applyHighlightsToLayer(textLayer, pageNum);
          }
        }
      } catch (e) {
        console.warn("Failed to reapply highlights after history revert", e);
      }
      setStatus("Reverted annotations from history.");
    }
  });

  const renderStickyMarkersOnCard = ({ card, pageNum, viewport }) => {
    if (!card || !viewport) return;
    const notesForPage = annotation.getStickyNotesForPage(pageNum);
    const existing = card.querySelector(".sticky-layer");
    if (existing) existing.remove();
    if (!notesForPage || notesForPage.length === 0) return;

    card.style.position = "relative";
    const layer = document.createElement("div");
    layer.className = "sticky-layer";
    layer.style.position = "absolute";
    layer.style.left = "0";
    layer.style.top = "0";
    layer.style.width = `${viewport.width}px`;
    layer.style.height = `${viewport.height}px`;
    layer.style.pointerEvents = "none";

    notesForPage.forEach((note) => {
      const marker = document.createElement("div");
      marker.className = "sticky-marker";
      marker.style.left = `${(note.x * viewport.width) - 9}px`;
      marker.style.top = `${(note.y * viewport.height) - 9}px`;
      marker.style.pointerEvents = "auto";
      marker.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        const rect = marker.getBoundingClientRect();
        annotation.showStickyNotePopover(note, rect.left + rect.width / 2, rect.bottom + 6);
      });
      layer.appendChild(marker);
    });

    card.appendChild(layer);
  };

  pdf.onPageRendered = renderStickyMarkersOnCard;

  // ensure the sticky list refreshes after page renders
  const prevOnRendered = pdf.onRendered;
  pdf.onRendered = (meta) => {
    try {
      if (typeof prevOnRendered === 'function') prevOnRendered(meta);
    } finally {
      try { stickyNotes.refresh(); } catch (e) { /* ignore */ }
    }
  };

  let mindmap;
  try {
    mindmap = new MindMapController({
      modal: elements.mindmapModal,
      viewer: elements.mindmapViewer,
      closeBtn: elements.closeMindmap,
      exportBtn: elements.exportMindmapSvg,
      listContainer: elements.mindmapsList,
      onStatus: setStatus
    });
  } catch (e) {
    console.error("Failed to initialize MindMapController:", e);
  }

  const chat = new ChatController({
    chatHistory: elements.chatHistory,
    chatInput: elements.chatInput,
    chatSend: elements.chatSend,
    selectedTextBox: elements.selectedTextBox,
    imagePreviewContainer: elements.imagePreviewContainer,
    tokenTracker: elements.tokenTracker,
    summarizeCacheBtn: elements.summarizeCacheBtn,
    onStatus: setStatus,
    onSaveNote: (text) => notes.addNote(text, 'Chat'),
    conversationBar: document.getElementById("conversation-bar"),
    chatList: document.getElementById("chat-list"),
    onNeedSetup: () => {
      showSettings();
      document.getElementById("settings-models")?.scrollIntoView({ block: "start" });
      setTimeout(() => elements.settingsApiLabel?.focus(), 0);
    },
    instructionsBtn: document.getElementById("instructions-btn"),
    instructionsCount: document.getElementById("instructions-count"),
    getMode: () => elements.chatModeSelect?.value || "auto",
    getInstructions: (conversationId) => window.electronAPI.resolveInstructions(pdf.getCurrentPath(), conversationId),
    onOpenInstructions: (conversationId) => openInstructionsPanel({
      pdfPath: pdf.getCurrentPath(),
      conversationId,
      onChange: () => chat.renderConversationBar()
    }),
    getChatConfig: getCurrentChatConfig,
    onTokenUsage: () => refreshTokenDashboard(elements, elements.tokenUsageProfileFilter?.value || "all"),
    onAgentAction: (action) => {
      if (action.type === 'highlight') {
        pdf.findAndHighlight(action);
      } else if (action.type === 'note') {
        notes.addNote(action.content);
        sidebarPanel = "notes";
        sidebarVisible = true;
        showReader();
      } else if (action.type === 'mindmap') {
        if (mindmap) mindmap.show(action.code);
      } else if (action.type === 'comment') {
        const comments = Array.isArray(action.comments) && action.comments.length > 0
          ? action.comments
          : [{ text: action.text, page: action.page, x: action.x, y: action.y }];
        annotation.addAgentComments(comments);
        try { stickyNotes.refresh(); } catch (e) { /* ignore */ }
        // Also persist a short summary into detailed notes for review
        try {
          comments.forEach((c) => {
            const page = Number(c.page) || annotation.getCurrentPage();
            const summary = `[Page ${page}] ${String(c.text || '').trim()}`;
            notes.addNote(summary, 'Agent');
          });
        } catch (e) {
          console.warn('Failed to add comments to detailed notes', e);
        }

        setStatus(`Agent added ${comments.length} sticky note${comments.length === 1 ? '' : 's'}.`);
      } else if (action.type === 'websearch') {
        setStatus("Agent performed a web search.");
      }
    },
    onGlossaryTermFound: async (data) => {
      const ok = await addToGlossary(data.term, data.definition, data.source);
      if (ok) {
        updateGlossaryUI();
        setStatus(`Agent added "${data.term}" to glossary.`);
      }
    }
  });

  // AI Capabilities modal handlers
  if (elements.aiCapabilitiesBtn && elements.aiCapabilitiesModal && elements.closeAiCapabilities) {
    elements.aiCapabilitiesBtn.addEventListener('click', () => {
      elements.aiCapabilitiesModal.style.display = 'block';
    });

    elements.closeAiCapabilities.addEventListener('click', () => {
      elements.aiCapabilitiesModal.style.display = 'none';
    });

    elements.aiCapabilitiesModal.addEventListener('click', (e) => {
      if (e.target === elements.aiCapabilitiesModal) elements.aiCapabilitiesModal.style.display = 'none';
    });
  }

  const snip = new SnipController({
    pdfViewer: elements.pdfViewer,
    pdfCanvas: elements.canvas,
    screenshotBtn: elements.screenshotBtn,
    selection: elements.snipSelection,
    onImage: (dataUrl) => chat.attachImage(dataUrl),
    onStatus: setStatus,
    onEnter: () => {
      annotation.stopMode();
      window.getSelection()?.removeAllRanges();
      chat.clearSelectedText();
    },
    onExit: () => { }
  });

  const dictTooltip = new DictionaryTooltip({
    onAddGlossary: async (data) => {
      const ok = await addToGlossary(data.term, data.definition, data.source);
      if (ok) {
        setStatus(`Added "${data.term}" to glossary.`);
        updateGlossaryUI();
      } else {
        setStatus("Failed to add to glossary.");
      }
    }
  });

  const contextMenu = new PdfContextMenu({
    container: elements.pdfStage,
    onDefine: async (text, context, x, y) => {
      setStatus(`Defining "${text}"...`);
      const config = getCurrentChatConfig();
      if (!config.apiKey) {
        setStatus("Select a saved AI profile before using definitions.");
        return;
      }
      const res = await window.electronAPI.getDefinition({
        word: text,
        context,
        profile: config.profile,
        apiKey: config.apiKey,
        model: config.model
      });
      if (res.ok) {
        dictTooltip.show(x, y, res.result);
        setStatus("Definition loaded.");
      } else {
        setStatus("Definition failed.");
      }
    },
    onAddToGlossary: async (text, context) => {
      setStatus(`Adding "${text}" to glossary...`);
      const config = getCurrentChatConfig();
      if (!config.apiKey) {
        setStatus("Select a saved AI profile before using glossary lookup.");
        return;
      }
      const res = await window.electronAPI.getDefinition({
        word: text,
        context,
        profile: config.profile,
        apiKey: config.apiKey,
        model: config.model
      });
      if (res.ok) {
        const ok = await addToGlossary(res.result.term, res.result.definition, res.result.source);
        if (ok) {
          setStatus(`Added "${text}" to glossary.`);
          updateGlossaryUI();
        }
      } else {
        setStatus("Failed to define term.");
      }
    },
    onAddToNotes: (text) => {
      setStatus("Notes integration coming soon!");
    }
  });

  async function updateGlossaryUI() {
    const glossary = await getGlossary();
    const query = elements.glossarySearch.value.toLowerCase();

    elements.glossaryList.innerHTML = "";

    const filtered = glossary.terms.filter(t =>
      t.term.toLowerCase().includes(query) ||
      t.definition.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      elements.glossaryList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spell-check"></i><span>No terms yet. Select a word in the document and choose Define.</span></div>';
      return;
    }

    filtered.forEach(item => {
      const el = document.createElement("div");
      el.className = "glossary-item";
      el.innerHTML = `
        <div class="glossary-term">
          <span>${escapeHtml(item.term)}</span>
          <button class="glossary-remove" title="Remove term"><i class="fa-solid fa-trash-can"></i></button>
        </div>
        <div class="glossary-def">${escapeHtml(item.definition)}</div>
        <div class="glossary-meta">
          <span>${item.source === 'llm' ? 'AI' : 'Dict'}</span>
          <span>${item.frequency || 1} uses</span>
        </div>
      `;

      el.querySelector(".glossary-remove").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (await removeFromGlossary(item.term)) {
          updateGlossaryUI();
        }
      });

      elements.glossaryList.appendChild(el);
    });
  }

  elements.tokenUsagePanel?.addEventListener("toggle", () => {
    if (elements.tokenUsagePanel.open) refreshTokenDashboard(elements, elements.tokenUsageProfileFilter?.value || "all");
  });

  elements.glossarySearch.addEventListener("input", updateGlossaryUI);
  updateGlossaryUI();

  elements.glossaryExportBtn.addEventListener("click", async () => {
    const glossary = await getGlossary();
    if (!glossary.terms || glossary.terms.length === 0) {
      setStatus("Glossary is empty.");
      return;
    }

    let md = "# Glossary\n\n";
    glossary.terms.forEach(t => {
      md += `### ${t.term}\n`;
      md += `**Definition**: ${t.definition}\n`;
      md += `**Source**: ${t.source}\n`;
      md += `**Added**: ${new Date(t.dateAdded).toLocaleDateString()}\n\n`;
    });

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "glossary.md";
    downloadData(md, "glossary.md", "text/markdown");
    setStatus("Glossary exported as Markdown.");
  });

  function downloadData(data, filename, type) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  elements.exportMd.addEventListener("click", (e) => {
    e.preventDefault();
    const md = notes.getNotesMarkdown();
    if (md) {
      downloadData(md, "research_notes.md", "text/markdown");
      setStatus("Notes exported as Markdown.");
    }
  });

  elements.exportLatex.addEventListener("click", (e) => {
    e.preventDefault();
    const latex = notes.getNotesLatex();
    if (latex) {
      downloadData(latex, "research_notes.tex", "text/plain");
      setStatus("Notes exported as LaTeX.");
    }
  });

  elements.exportPdf.addEventListener("click", (e) => {
    e.preventDefault();
    notes.printNotes();
  });

  function renderAll() {
    renderSettings();
    renderTabs(activateTab, showWelcome, showSettings, closeTab, openPdfDialog);
    syncLayoutToggles();
  }

  tabActionHandlers.onActivate = activateTab;
  tabActionHandlers.onHome = showWelcome;
  tabActionHandlers.onSettings = showSettings;
  tabActionHandlers.onClose = closeTab;
  tabActionHandlers.onAdd = openPdfDialog;

  chat.bindEvents();
  annotation.bindEvents();
  snip.bindEvents();

  window.addEventListener("navigate-pdf-page", (event) => {
    const pageNum = event.detail.page;
    if (pageNum && pdf && pdf.hasDocument()) {
      pdf.jumpToPage(pageNum);
      // Optional: Maybe briefly highlight the page or just ensure it's in view
    }
  });

  // Passwords for locked PDFs live only in memory, for as long as the tab is open.
  const tabPasswords = new Map();

  function showDocState(info) {
    elements.appShell.classList.add("no-doc");
    elements.pdfContainer.hidden = true;
    renderDocState(elements.docState, info, {
      onUnlock: (password) => {
        tabPasswords.set(info.path, password);
        activateTab(info.path);
      },
      onChoose: () => openPdfDialog(),
      onClose: () => closeTab(info.path),
      onForget: () => {
        removeRecent(info.path);
        renderRecents(loadRecent);
        closeTab(info.path);
      }
    });
  }

  function hideDocState() {
    elements.appShell.classList.remove("no-doc");
    clearDocState(elements.docState);
    elements.pdfContainer.hidden = false;
  }

  // Resolves true when the document is on screen.
  async function activateTab(path) {
    if (!path) {
      return false;
    }

    if (activeTabPath && activeTabPath !== path && pdf.hasDocument()) {
      tabViewState.set(activeTabPath, pdf.getViewState());
    }

    activeTabPath = path;
    const remembered = getSetting("reading.rememberPosition") ? getReadingState(path) : null;
    const savedState = tabViewState.get(path) || remembered || {
      pageNum: 1,
      scale: getSetting("reading.defaultZoom") / 100,
      viewMode: getSetting("reading.defaultViewMode")
    };

    // Show the reader before loading: the page is fitted to the space it will occupy.
    hideDocState();
    showReader();
    chat.setEnabled(false);
    const opened = await pdf.load(path, savedState, { password: tabPasswords.get(path) });

    // Startup code may have switched to Home while the file loaded; this tab is what was asked for.
    showReader();

    if (!opened) {
      // The doc-state view explains why. The chat has nothing to talk about yet.
      await chat.loadPdfHistory(null);
      notes.load(null);
      renderAll();
      return false;
    }

    await chat.loadPdfHistory(path);
    await notes.load(path);
    await mindmap.load(path);
    history.load(path);
    stickyNotes.refresh();
    chat.setEnabled(currentView === "reader" && chatVisible);
    renderAll();
    return true;
  }

  async function openTab(path) {
    if (!openTabs.includes(path)) {
      openTabs.push(path);
    }

    const opened = await activateTab(path);
    if (opened) {
      pushRecent(path);
      renderRecents(loadRecent);
      window.dispatchEvent(new CustomEvent("thinker:milestone", { detail: "open" }));
      maybeOfferReaderTour();
    }
  }

  function closeTab(path) {
    const index = openTabs.indexOf(path);
    if (index === -1) {
      return;
    }

    openTabs.splice(index, 1);
    tabViewState.delete(path);

    if (activeTabPath === path) {
      if (openTabs.length > 0) {
        const nextIndex = Math.max(0, index - 1);
        activateTab(openTabs[nextIndex]);
      } else {
        activeTabPath = null;
        currentView = "home";
        chat.resetUi();
        chat.setEnabled(false);
        showWelcome();
      }
    }

    renderAll();
  }

  async function openPdfDialog() {
    if (!window.electronAPI || !window.electronAPI.openPDF) {
      setStatus("Open dialog unavailable.");
      return;
    }

    const path = await window.electronAPI.openPDF();
    if (!path) {
      return;
    }

    await openTab(path);
  }

  function loadRecent(path) {
    openTab(path);
  }

  elements.welcomeOpenBtn.addEventListener("click", openPdfDialog);
  elements.welcomeSettingsBtn.addEventListener("click", showSettings);

  elements.settingsApiAdd.addEventListener("click", addApiKeyFromSettings);
  elements.settingsActiveApi.addEventListener("change", () => {
    setActiveApiProfileId(elements.settingsActiveApi.value);
    renderSettings();
  });
  elements.settingsChatModel.addEventListener("change", () => {
    setChatModel(elements.settingsChatModel.value);
    renderSettings();
  });
  elements.settingsThemeMode.addEventListener("change", () => {
    setTheme(elements.settingsThemeMode.value);
    applyTheme();
    renderSettings();
  });

  elements.settingsCustomColor.addEventListener("input", (e) => {
    setAccent(e.target.value);
    renderThemeSettings();
  });

  elements.resetColorBtn.addEventListener("click", () => {
    resetAccent();
    renderThemeSettings();
  });

  // ---- Tutorials: guided tours, the Get started checklist and the Help screen ----
  const onboarding = createOnboarding(
    { get: (key) => window.electronAPI.getItem(key), set: (key, value) => window.electronAPI.setItem(key, value) },
    () => renderChecklist()
  );

  const tourContext = {
    goHome: () => showWelcome(),
    goReader: () => { if (activeTabPath) showReader(); },
    openChat: () => {
      if (activeTabPath && !chatVisible) elements.navChat.click();
    }
  };
  const tours = buildTours(tourContext);
  let tourRunning = false;

  async function startTour(name) {
    if (tourRunning) return;
    const tour = tours[name];
    if (!tour) return;
    if (name === "reader" && !activeTabPath) {
      setStatus("Open a PDF first, then the reader tour can point at things on the page.");
      return;
    }
    tourRunning = true;
    hideTourOffer();
    try {
      const outcome = await runTour({ steps: tour.steps, ctx: tourContext, label: tour.label });
      onboarding.markTourSeen(name);
      if (outcome.completed) setStatus(name === "welcome" ? "Tour done. Help is always under the ? in the rail." : "That's the reader. Help has a guide for each part.");
    } finally {
      tourRunning = false;
    }
  }

  function hideTourOffer() {
    elements.tourOffer.hidden = true;
    elements.tourOffer.textContent = "";
  }

  // A one-time, dismissible nudge the first time a document opens.
  function maybeOfferReaderTour() {
    if (onboarding.tourSeen("reader") || onboarding.tourSeen("readerOffer") || tourRunning) return;
    onboarding.markTourSeen("readerOffer");
    const box = elements.tourOffer;
    box.textContent = "";
    const text = document.createElement("span");
    text.textContent = "New to the reader? A one-minute tour shows where everything is.";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "btn primary";
    yes.textContent = "Take the tour";
    yes.addEventListener("click", () => startTour("reader"));
    const no = document.createElement("button");
    no.type = "button";
    no.className = "btn";
    no.textContent = "No thanks";
    no.addEventListener("click", hideTourOffer);
    box.append(text, yes, no);
    box.hidden = false;
    setTimeout(() => { if (!box.hidden) hideTourOffer(); }, 20000);
  }

  function runHelpAction(action) {
    const [kind, value] = String(action).split(":");
    if (kind === "tour") {
      if (value === "welcome") showWelcome();
      if (value === "reader" && !activeTabPath) {
        setStatus("Open a PDF first, then the reader tour can point at things on the page.");
        return;
      }
      startTour(value);
    } else if (kind === "goto" && value === "settings") {
      showSettings();
    } else if (kind === "checklist") {
      onboarding.show();
      showWelcome();
    }
  }

  function renderChecklist() {
    const state = onboarding.get();
    const box = elements.gettingStarted;
    if (!box) return;
    const stats = progress(state);
    box.hidden = state.dismissed;
    if (state.dismissed) return;

    elements.gsFill.style.width = `${stats.percent}%`;
    box.querySelector(".gs-bar").setAttribute("aria-valuenow", String(stats.percent));
    elements.gsSub.textContent = stats.complete
      ? "You've tried everything. Nicely done. Help has a guide for each part whenever you need it."
      : `${stats.done} of ${stats.total} done. Each one ticks itself off when you try it.`;

    elements.gsList.textContent = "";
    const upNext = nextTask(state);
    TASKS.forEach((task) => {
      const done = Boolean(state.done[task.id]);
      const item = document.createElement("li");
      item.className = "gs-item" + (done ? " done" : "") + (upNext && upNext.id === task.id ? " next" : "");
      const mark = document.createElement("span");
      mark.className = "gs-check";
      mark.innerHTML = done ? '<i class="fa-solid fa-check"></i>' : "";
      mark.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "gs-text";
      const title = document.createElement("strong");
      title.textContent = task.title;
      const hint = document.createElement("span");
      hint.textContent = task.hint;
      text.append(title, hint);
      item.append(mark, text);
      if (!done) {
        const go = document.createElement("button");
        go.type = "button";
        go.className = "btn" + (upNext && upNext.id === task.id ? " primary" : "");
        go.textContent = task.cta;
        go.addEventListener("click", () => runChecklistTask(task.id));
        item.appendChild(go);
      } else {
        const sr = document.createElement("span");
        sr.className = "sr-only";
        sr.textContent = "Done";
        item.appendChild(sr);
      }
      elements.gsList.appendChild(item);
    });
  }

  function runChecklistTask(id) {
    if (id === "model") {
      showSettings();
      document.getElementById("settings-models")?.scrollIntoView({ block: "start" });
      setTimeout(() => elements.settingsApiLabel?.focus(), 0);
    } else if (id === "open") {
      openPdfDialog();
    } else if (!activeTabPath) {
      setStatus("Open a PDF first. This step needs a document.");
      openPdfDialog();
    } else if (id === "ask") {
      showReader();
      if (!chatVisible) elements.navChat.click();
      elements.chatInput.focus();
    } else if (id === "markup") {
      showReader();
      startTour("reader");
    } else if (id === "save") {
      showReader();
      elements.saveAnnotationsBtn.click();
    }
  }

  // Everything people do in the app can complete a step.
  window.addEventListener("thinker:milestone", (event) => onboarding.mark(event.detail));
  // Work out what existing users have already done, so the checklist never asks for it again.
  (async () => {
    if (getApiProfiles().length > 0) onboarding.mark("model");
    if (getRecents().length > 0) onboarding.mark("open");
    try {
      const usage = await window.electronAPI.getTokenUsageHistory();
      if (Array.isArray(usage) && usage.length > 0) onboarding.mark("ask");
    } catch { /* optional */ }
    renderChecklist();
  })();

  document.getElementById("gs-tour")?.addEventListener("click", () => startTour("welcome"));
  document.getElementById("gs-hide")?.addEventListener("click", () => {
    onboarding.dismiss();
    setStatus("Hidden. You can bring it back from Help.");
  });
  elements.navHelp.addEventListener("click", showHelp);
  renderHelp(elements.helpContent, {
    run: runHelpAction,
    openLink: (url) => window.electronAPI.openExternal(url)
  });

  // First run only: someone with no recent files and no saved model gets the welcome tour once.
  if (!onboarding.tourSeen("welcome") && getRecents().length === 0 && getApiProfiles().length === 0 && !new URLSearchParams(window.location.search).get("open")) {
    setTimeout(() => startTour("welcome"), 900);
  }

  // Escape closes the topmost dialog; clicking the dimmed backdrop does too.
  const DIALOG_IDS = ["user-sticky-dialog", "save-modal", "ai-capabilities-modal", "mindmap-modal"];
  const openDialog = () => DIALOG_IDS.map((id) => document.getElementById(id)).find((d) => d && getComputedStyle(d).display !== "none");
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const dialog = openDialog();
    if (!dialog) return;
    dialog.style.display = "none";
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  DIALOG_IDS.forEach((id) => {
    const dialog = document.getElementById(id);
    dialog?.addEventListener("mousedown", (event) => {
      if (event.target === dialog) dialog.style.display = "none";
    });
  });

  elements.prevBtn.addEventListener("click", () => pdf.prevPage());
  elements.nextBtn.addEventListener("click", () => pdf.nextPage());
  elements.zoomInBtn.addEventListener("click", () => pdf.setScale((parseFloat(elements.zoomInput.value) || 150) / 100 + 0.1));
  elements.zoomOutBtn.addEventListener("click", () => pdf.setScale((parseFloat(elements.zoomInput.value) || 150) / 100 - 0.1));
  elements.zoomInput.addEventListener("change", () => pdf.setScaleFromInput(elements.zoomInput.value));

  elements.modeSingleBtn.addEventListener("click", () => pdf.setViewMode("single"));
  elements.modeTwoBtn.addEventListener("click", () => pdf.setViewMode("two"));
  elements.modeScrollBtn.addEventListener("click", () => pdf.setViewMode("scroll"));

  const saveOptionsKey = "save-options";
  const getSaveOptions = () => {
    try {
      const raw = window.electronAPI.getItem(saveOptionsKey);
      const parsed = JSON.parse(raw || "{}");
      return {
        pen: parsed.pen !== false,
        sticky: parsed.sticky !== false,
        highlights: parsed.highlights !== false,
        notes: parsed.notes !== false,
        flatten: parsed.flatten === true
      };
    } catch {
      return { pen: true, sticky: true, highlights: true, notes: true, flatten: false };
    }
  };

  const setSaveOptions = (opts) => {
    window.electronAPI.setItem(saveOptionsKey, JSON.stringify(opts));
  };

  const openSaveModal = async () => {
    const opts = getSaveOptions();
    if (elements.saveOptPen) elements.saveOptPen.checked = opts.pen;
    if (elements.saveOptSticky) elements.saveOptSticky.checked = opts.sticky;
    if (elements.saveOptHighlights) elements.saveOptHighlights.checked = opts.highlights;
    if (elements.saveOptNotes) elements.saveOptNotes.checked = opts.notes;
    if (elements.saveOptFlatten) elements.saveOptFlatten.checked = opts.flatten;

    // Update stats
    const annotationsByPage = annotation.collectDocumentAnnotations();
    const highlightBoxes = await pdf.collectHighlightBoxesByPage();
    
    let strokeCount = 0;
    let stickyCount = 0;
    Object.values(annotationsByPage).forEach(page => {
      strokeCount += (page.paths || []).length;
      stickyCount += (page.stickyNotes || []).length;
    });

    let hlCount = 0;
    Object.values(highlightBoxes).forEach(boxes => hlCount += boxes.length);

    if (elements.statStrokes) elements.statStrokes.textContent = strokeCount;
    if (elements.statHighlights) elements.statHighlights.textContent = hlCount;
    if (elements.statStickies) elements.statStickies.textContent = stickyCount;
    if (elements.statNotes) elements.statNotes.textContent = notes.notes.length;

    if (elements.saveModal) elements.saveModal.style.display = "flex";
  };

  const closeSaveModal = () => {
    if (elements.saveModal) elements.saveModal.style.display = "none";
  };

  elements.saveModalClose?.addEventListener("click", closeSaveModal);
  elements.saveModalCancel?.addEventListener("click", closeSaveModal);
  elements.saveModal?.addEventListener("click", (e) => {
    if (e.target === elements.saveModal) closeSaveModal();
  });

  elements.saveAnnotationsBtn?.addEventListener("click", async () => {
    if (!pdf.hasDocument() || !pdf.getCurrentPath()) {
      setStatus("Open a PDF before saving annotations.");
      return;
    }
    openSaveModal();
  });

  elements.saveModalConfirm?.addEventListener("click", async () => {
    if (!pdf.hasDocument() || !pdf.getCurrentPath()) {
      setStatus("Open a PDF before saving annotations.");
      closeSaveModal();
      return;
    }

    const opts = {
      pen: Boolean(elements.saveOptPen?.checked),
      sticky: Boolean(elements.saveOptSticky?.checked),
      highlights: Boolean(elements.saveOptHighlights?.checked),
      notes: Boolean(elements.saveOptNotes?.checked),
      flatten: Boolean(elements.saveOptFlatten?.checked)
    };
    setSaveOptions(opts);

    let annotationsByPage = annotation.collectDocumentAnnotations();
    Object.keys(annotationsByPage).forEach((key) => {
      const entry = annotationsByPage[key];
      if (!opts.pen) entry.paths = [];
      if (!opts.sticky) entry.stickyNotes = [];
      if ((entry.paths?.length || 0) === 0 && (entry.stickyNotes?.length || 0) === 0) {
        delete annotationsByPage[key];
      }
    });

    const highlightBoxesByPage = opts.highlights ? await pdf.collectHighlightBoxesByPage() : {};
    const hasAnything = Object.keys(annotationsByPage).length > 0
      || (opts.highlights && Object.keys(highlightBoxesByPage).length > 0)
      || (opts.notes && (notes.notes?.length || 0) > 0);

    if (!hasAnything) {
      setStatus("Nothing selected to save.");
      closeSaveModal();
      return;
    }

    setStatus("Saving annotated PDF...");
    const result = await window.electronAPI.saveAnnotatedPdf({
      pdfPath: pdf.getCurrentPath(),
      annotationsByPage,
      highlightBoxesByPage,
      includeNotes: opts.notes,
      flatten: opts.flatten,
      author: getSetting("annotation.author")
    });

    if (result?.ok) {
      window.dispatchEvent(new CustomEvent("thinker:milestone", { detail: "save" }));
      const historySnapshot = {
        id: String(Date.now()),
        timestamp: Date.now(),
        label: "Saved annotations",
        options: opts,
        annotationsByPage,
        highlightTextsByPage: opts.highlights ? pdf.getPersistentHighlightsByPage() : {},
        highlightBoxesByPage
      };
      history.addSnapshot(pdf.getCurrentPath(), historySnapshot);
      setStatus(`Annotated PDF saved: ${result.filePath}`);
    } else if (!result?.canceled) {
      setStatus(`Save failed: ${result?.error || 'Unknown error'}`);
    } else {
      setStatus("Save canceled.");
    }
    closeSaveModal();
  });

  elements.navHome.addEventListener("click", showWelcome);
  elements.navReader.addEventListener("click", () => {
    if (!activeTabPath) {
      showWelcome();
      return;
    }
    showReader();
    chat.setEnabled(chatVisible);
  });
  elements.navSettings.addEventListener("click", showSettings);
  elements.navOutline.addEventListener("click", () => {
    if (!activeTabPath) {
      setStatus("Open a PDF tab before showing outline.");
      return;
    }

    sidebarVisible = !(sidebarVisible && sidebarPanel === "outline");
    sidebarPanel = "outline";
    showReader();
  });
  elements.navThumbs.addEventListener("click", () => {
    if (!activeTabPath) {
      setStatus("Open a PDF tab before showing thumbnails.");
      return;
    }

    sidebarVisible = !(sidebarVisible && sidebarPanel === "thumbs");
    sidebarPanel = "thumbs";
    showReader();
  });
  elements.navGlossary.addEventListener("click", () => {
    if (!activeTabPath) {
      setStatus("Open a PDF tab before showing glossary.");
      return;
    }

    sidebarVisible = !(sidebarVisible && sidebarPanel === "glossary");
    sidebarPanel = "glossary";
    showReader();
    updateGlossaryUI();
  });
  elements.navNotes.addEventListener("click", () => {
    if (!activeTabPath) {
      setStatus("Open a PDF tab before showing notes.");
      return;
    }

    sidebarVisible = !(sidebarVisible && sidebarPanel === "notes");
    sidebarPanel = "notes";
    showReader();
    notes.render();
    stickyNotes.refresh();
  });

  elements.tabResearchNotes?.addEventListener("click", () => {
    notesPanelTab = "research";
    syncLayoutToggles();
    notes.render();
  });

  elements.tabStickyNotes?.addEventListener("click", () => {
    notesPanelTab = "sticky";
    syncLayoutToggles();
    stickyNotes.refresh();
  });

  // User Sticky Note Placement Logic
  const startStickyPlacement = () => {
    if (!activeTabPath) return;
    isPlacingSticky = true;
    annotation.stopMode();
    elements.userStickyBtn?.classList.add("active");
    document.body.classList.add("sticky-placement-mode");
    setStatus("Click on the PDF page to place a sticky note.");
    
    // Create hint element if not exists
    let hint = document.querySelector(".placement-hint");
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "placement-hint";
      hint.innerHTML = `<i class="fa-solid fa-map-pin"></i> Click anywhere to place note (Esc to cancel)`;
      document.body.appendChild(hint);
    }
  };

  const stopStickyPlacement = () => {
    isPlacingSticky = false;
    elements.userStickyBtn?.classList.remove("active");
    document.body.classList.remove("sticky-placement-mode");
    const hint = document.querySelector(".placement-hint");
    if (hint) hint.remove();
  };

  elements.userStickyBtn?.addEventListener("click", () => {
    if (isPlacingSticky) stopStickyPlacement();
    else startStickyPlacement();
  });

  elements.addUserStickyBtn?.addEventListener("click", () => {
    startStickyPlacement();
  });

  // Intercept canvas click for sticky placement
  const originalHandleCanvasClick = annotation.handleCanvasClick;
  annotation.handleCanvasClick = (event) => {
    if (isPlacingSticky) {
      const rect = elements.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      stickyPlacementPoint = { x, y };
      elements.userStickyText.value = "";
      elements.userStickyDialog.style.display = "flex";
      elements.userStickyText.focus();
      return; // Skip original hit testing
    }
    originalHandleCanvasClick.call(annotation, event);
  };

  elements.userStickyConfirm?.addEventListener("click", () => {
    const text = elements.userStickyText.value.trim();
    if (text && stickyPlacementPoint) {
      annotation.addStickyNote(text, stickyPlacementPoint.x, stickyPlacementPoint.y);
      stickyNotes.refresh();
      setStatus("Sticky note placed.");
    }
    elements.userStickyDialog.style.display = "none";
    stopStickyPlacement();
  });

  elements.userStickyCancel?.addEventListener("click", () => {
    elements.userStickyDialog.style.display = "none";
    stopStickyPlacement();
  });

  elements.userStickyClose?.addEventListener("click", () => {
    elements.userStickyDialog.style.display = "none";
    stopStickyPlacement();
  });
  elements.navHistory.addEventListener("click", () => {
    if (!activeTabPath) {
      setStatus("Open a PDF tab before showing history.");
      return;
    }

    sidebarVisible = !(sidebarVisible && sidebarPanel === "history");
    sidebarPanel = "history";
    showReader();
    history.load(pdf.getCurrentPath());
  });
  elements.historyRefreshBtn?.addEventListener("click", () => {
    history.load(pdf.getCurrentPath());
  });
  elements.navMindmaps.addEventListener("click", () => {
    if (!activeTabPath) {
      setStatus("Open a PDF tab before showing mind maps.");
      return;
    }

    sidebarVisible = !(sidebarVisible && sidebarPanel === "mindmaps");
    sidebarPanel = "mindmaps";
    showReader();
  });

  elements.mindmapNewBtn.addEventListener("click", () => {
    chatVisible = true;
    showReader();
    elements.chatInput.value = "Generate a comprehensive mind map of this document.";
    elements.chatInput.focus();
    setStatus("Ask the AI to generate a map.");
  });

  elements.navChat.addEventListener("click", () => {
    if (!activeTabPath) {
      setStatus("Open a PDF tab before using chat.");
      return;
    }

    chatVisible = !chatVisible;
    chat.setEnabled(currentView === "reader" && chatVisible);
    showReader();
    if (chatVisible) {
      elements.chatInput.focus();
    }
  });

  if (elements.chatCloseBtn) {
    elements.chatCloseBtn.addEventListener("click", () => {
      chatVisible = false;
      chat.setEnabled(false);
      showReader();
    });
  }

  let isResizingChat = false;
  let isResizingSidebar = false;

  elements.chatResizer?.addEventListener("mousedown", () => {
    isResizingChat = true;
    document.body.style.cursor = "ew-resize";
    elements.chatResizer.classList.add("dragging");
  });

  elements.sidebarResizer?.addEventListener("mousedown", () => {
    isResizingSidebar = true;
    document.body.style.cursor = "ew-resize";
    elements.sidebarResizer.classList.add("dragging");
  });

  document.addEventListener("mousemove", (e) => {
    if (isResizingChat) {
      let newWidth = window.innerWidth - e.clientX;
      newWidth = Math.max(250, Math.min(newWidth, 800));
      document.documentElement.style.setProperty("--chat-width", `${newWidth}px`);
    }
    if (isResizingSidebar) {
      let newWidth = e.clientX - 56;
      newWidth = Math.max(180, Math.min(newWidth, 600));
      document.documentElement.style.setProperty("--sidebar-width", `${newWidth}px`);
    }
  });

  document.addEventListener("mouseup", () => {
    if (isResizingChat || isResizingSidebar) {
      isResizingChat = false;
      isResizingSidebar = false;
      document.body.style.cursor = "";
      elements.chatResizer?.classList.remove("dragging");
      elements.sidebarResizer?.classList.remove("dragging");

      if (pdf && (pdf.fitMode === "auto" || pdf.fitMode === "width")) {
        pdf.scrollCacheKey = "";
        pdf.queueRender(pdf.getPageNum());
      }
    }
  });

  document.addEventListener("selectionchange", () => {
    if (currentView === "home" || currentView === "settings" || snip.isSnipping || annotation.isAnnotating) {
      return;
    }

    const selectedText = getSelectionTextInTextLayer();
    if (selectedText) {
      chat.setSelectedText(selectedText);
      return;
    }

    if (elements.chatPanel.contains(document.activeElement)) {
      return;
    }

    chat.clearSelectedText();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      snip.stop();
      annotation.stopMode();
      findCtrl.close();
      setStatus("Ready.");
    }

    // Ctrl+F → open find bar (only when a PDF is open)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      if (activeTabPath && currentView === "reader") {
        event.preventDefault();
        findCtrl.open();
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
      event.preventDefault();
      openPdfDialog();
    }
  });

  // Allow dropping on the empty space of the tab container to append
  elements.pdfTabs.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  elements.pdfTabs.addEventListener("drop", (e) => {
    e.preventDefault();
    const draggedPath = e.dataTransfer.getData("text/plain");
    if (draggedPath) {
      const fromIndex = openTabs.indexOf(draggedPath);
      if (fromIndex > -1) {
        openTabs.splice(fromIndex, 1);
        openTabs.push(draggedPath);
        renderAll();
      }
    }
  });

  // Listen for new PDFs opened from external triggers (second-instance event in main process)
  window.electronAPI.onOpenPdf((path) => {
    if (path) {
      openTab(path);
    }
  });

  // Check URL query parameters to see if a PDF needs to be opened on startup
  const params = new URLSearchParams(window.location.search);
  const pdfToOpen = params.get("open");
  if (pdfToOpen) {
    // URLSearchParams has already decoded the path; decoding again breaks names containing "%".
    openTab(pdfToOpen);
  }

  // Preferences screen, generated from the settings registry.
  renderPreferences({
    container: document.getElementById("prefs-list"),
    searchInput: document.getElementById("prefs-search"),
    modifiedOnlyInput: document.getElementById("prefs-modified-only")
  });
  const applyAiSettings = () => {
    if (elements.chatModeSelect) elements.chatModeSelect.value = getSetting("ai.defaultMode");
    if (elements.tokenTracker) elements.tokenTracker.style.display = getSetting("ai.showTokenCounter") ? "" : "none";
  };
  applyAiSettings();
  onSettingChange((key) => {
    if (key.startsWith("ai.")) applyAiSettings();
  });

  // Icon-only buttons need an accessible name; reuse their tooltip text.
  document.querySelectorAll("button[title]:not([aria-label])").forEach((btn) => btn.setAttribute("aria-label", btn.title));

  renderRecents(loadRecent);
  renderSettings();
  renderAll();
  chat.setEnabled(false);
  setActiveModeButton("single");
  showWelcome();
  setStatus("Ready. Open a PDF to start reading.");
}

window.addEventListener("load", boot);
