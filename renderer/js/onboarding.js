// "Get started" progress. The checklist ticks itself off as people really do each thing, so it is
// never homework: it is a record of what they have already tried. State lives in app storage.

export const STORAGE_KEY = "smartpdf.onboarding";

export const TASKS = [
  { id: "model", title: "Connect an AI model", hint: "Paste a free Gemini key, or use a model on your computer.", action: "settings", cta: "Set up" },
  { id: "open", title: "Open a PDF", hint: "Click Open a PDF or press Ctrl+O.", action: "open", cta: "Open" },
  { id: "ask", title: "Ask your first question", hint: "Open the chat and ask about the document.", action: "reader", cta: "Show me" },
  { id: "markup", title: "Mark something up", hint: "Pick a highlighter or pen and drag across the page.", action: "reader", cta: "Show me" },
  { id: "save", title: "Save your marks", hint: "The Save button makes a new PDF with your marks in it.", action: "reader", cta: "Show me" }
];

const TASK_IDS = new Set(TASKS.map((task) => task.id));

export function emptyState() {
  return { done: {}, dismissed: false, tours: {} };
}

// Reads whatever was stored, tolerating junk, old versions and unknown ids.
export function parseState(raw) {
  const state = emptyState();
  let parsed = null;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return state;
  }
  if (!parsed || typeof parsed !== "object") return state;
  for (const id of Object.keys(parsed.done || {})) {
    if (TASK_IDS.has(id) && parsed.done[id]) state.done[id] = true;
  }
  state.dismissed = parsed.dismissed === true;
  for (const key of Object.keys(parsed.tours || {})) {
    if (parsed.tours[key]) state.tours[key] = true;
  }
  return state;
}

export function markDone(state, id) {
  if (!TASK_IDS.has(id) || state.done[id]) return state;
  return { ...state, done: { ...state.done, [id]: true } };
}

export function progress(state) {
  const done = TASKS.filter((task) => state.done[task.id]).length;
  return { done, total: TASKS.length, complete: done === TASKS.length, percent: Math.round((done / TASKS.length) * 100) };
}

export function nextTask(state) {
  return TASKS.find((task) => !state.done[task.id]) || null;
}

// A small store around the pure functions: load once, persist on change, notify listeners.
export function createOnboarding(storage, onChange = () => {}) {
  let state = parseState(storage.get(STORAGE_KEY));

  const save = (next) => {
    if (next === state) return false;
    state = next;
    try {
      storage.set(STORAGE_KEY, JSON.stringify(state));
    } catch { /* progress is a nicety; never break the app over it */ }
    onChange(state);
    return true;
  };

  return {
    get: () => state,
    mark: (id) => save(markDone(state, id)),
    dismiss: () => save({ ...state, dismissed: true }),
    show: () => save({ ...state, dismissed: false }),
    reset: () => save(emptyState()),
    tourSeen: (name) => Boolean(state.tours[name]),
    markTourSeen: (name) => save(state.tours[name] ? state : { ...state, tours: { ...state.tours, [name]: true } })
  };
}
