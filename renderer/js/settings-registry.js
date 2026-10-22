// Every user-facing option is registered here once. The Preferences screen is generated from
// the registry, and values resolve from the narrowest scope that has one:
// document, then workspace, then app, then the default.

const SCOPES = ["app", "workspace", "document"];
const TYPES = new Set(["boolean", "enum", "number", "string"]);

function coerce(def, value) {
  switch (def.type) {
    case "boolean":
      return Boolean(value);
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${def.key} must be a number`);
      const min = def.min ?? -Infinity;
      const max = def.max ?? Infinity;
      return Math.max(min, Math.min(max, n));
    }
    case "enum":
      if (!def.options.some((o) => o.value === value)) throw new Error(`${def.key}: "${value}" is not an allowed option`);
      return value;
    default:
      return String(value ?? "");
  }
}

// api: { getAll(): Promise<[{key, scope, scopeId, value}]>, set(key, scope, scopeId, value), reset(key, scope, scopeId) }
export function createRegistry(api) {
  const defs = new Map();
  const values = new Map();
  const listeners = new Set();
  const slot = (key, scope, scopeId = "") => `${scope}|${scopeId}|${key}`;

  function registerSetting(def) {
    if (!def?.key || defs.has(def.key)) throw new Error(`Setting "${def?.key}" is missing or already registered`);
    if (!TYPES.has(def.type)) throw new Error(`${def.key}: unknown type "${def.type}"`);
    if (def.type === "enum" && !Array.isArray(def.options)) throw new Error(`${def.key}: enum needs options`);
    const full = { scopes: ["app"], group: "General", advanced: false, locked: false, ...def };
    full.default = coerce(full, full.default);
    defs.set(full.key, full);
    return full;
  }

  async function load() {
    values.clear();
    const rows = (await api.getAll()) || [];
    for (const row of rows) {
      const def = defs.get(row.key);
      if (!def) continue;
      try {
        values.set(slot(row.key, row.scope, row.scopeId), coerce(def, row.value));
      } catch { /* a stale or invalid stored value falls back to the default */ }
    }
  }

  function getSetting(key, context = {}) {
    const def = defs.get(key);
    if (!def) throw new Error(`Unknown setting "${key}"`);
    const chain = [
      ["document", context.documentId],
      ["workspace", context.workspaceId],
      ["app", ""]
    ];
    for (const [scope, scopeId] of chain) {
      if (!def.scopes.includes(scope) || (scope !== "app" && !scopeId)) continue;
      const found = values.get(slot(key, scope, scopeId));
      if (found !== undefined) return found;
    }
    return def.default;
  }

  function notify(key) {
    listeners.forEach((fn) => fn(key));
  }

  async function setSetting(key, value, scope = "app", scopeId = "") {
    const def = defs.get(key);
    if (!def) throw new Error(`Unknown setting "${key}"`);
    if (def.locked) throw new Error(`${key} is locked`);
    if (!SCOPES.includes(scope) || !def.scopes.includes(scope)) throw new Error(`${key} does not support scope "${scope}"`);
    const clean = coerce(def, value);
    if (clean === def.default && scope === "app") {
      values.delete(slot(key, scope, scopeId));
      await api.reset(key, scope, scopeId);
    } else {
      values.set(slot(key, scope, scopeId), clean);
      await api.set(key, scope, scopeId, clean);
    }
    notify(key);
    return clean;
  }

  async function resetSetting(key, scope = "app", scopeId = "") {
    values.delete(slot(key, scope, scopeId));
    await api.reset(key, scope, scopeId);
    notify(key);
  }

  const isModified = (key, scope = "app", scopeId = "") => values.has(slot(key, scope, scopeId));
  const listSettings = () => [...defs.values()];
  const onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  return { registerSetting, load, getSetting, setSetting, resetSetting, isModified, listSettings, onChange };
}

// The app-wide registry, backed by the main process.
export const registry = createRegistry({
  getAll: () => window.electronAPI.getSettings(),
  set: (key, scope, scopeId, value) => window.electronAPI.setSetting(key, scope, scopeId, value),
  reset: (key, scope, scopeId) => window.electronAPI.resetSetting(key, scope, scopeId)
});

export const { registerSetting, getSetting, setSetting, resetSetting, isModified, listSettings, onChange: onSettingChange } = registry;
export const loadSettings = () => registry.load();
