export const STORAGE_KEYS = {
  theme: "smartpdf.theme",
  themePalette: "smartpdf.themePalette",
  recents: "smartpdf.recents",
  geminiApiKey: "smartpdf.geminiApiKey",
  apiProfiles: "smartpdf.apiProfiles",
  activeApiProfileId: "smartpdf.activeApiProfileId",
  chatModel: "smartpdf.chatModel"
};

const RECENT_LIMIT = 8;
export const DEFAULT_CHAT_MODEL = "gemini-2.5-flash-lite";
export const DEFAULT_THEME_PALETTE = "aurora";

function safeParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const id = String(profile.id || "").trim();
  const label = String(profile.label || "API Key").trim();
  const key = String(profile.key || "").trim();

  if (!id || !key) {
    return null;
  }

  return { id, label, key };
}

export function getTheme() {
  return window.electronAPI.getItem(STORAGE_KEYS.theme) || "dark";
}

export function setTheme(theme) {
  window.electronAPI.setItem(STORAGE_KEYS.theme, theme);
}

export function getThemePalette() {
  return window.electronAPI.getItem(STORAGE_KEYS.themePalette) || DEFAULT_THEME_PALETTE;
}

export function setThemePalette(palette) {
  window.electronAPI.setItem(STORAGE_KEYS.themePalette, palette || DEFAULT_THEME_PALETTE);
}

export function getRecents() {
  const raw = window.electronAPI.getItem(STORAGE_KEYS.recents);
  if (!raw) {
    return [];
  }

  try {
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export function pushRecent(path) {
  const trimmed = path.trim();
  if (!trimmed) {
    return;
  }

  const recents = getRecents().filter((item) => item !== trimmed);
  recents.unshift(trimmed);
  window.electronAPI.setItem(STORAGE_KEYS.recents, JSON.stringify(recents.slice(0, RECENT_LIMIT)));
}

export function getGeminiApiKeyLocal() {
  return window.electronAPI.getItem(STORAGE_KEYS.geminiApiKey) || "";
}

export function setGeminiApiKeyLocal(key) {
  window.electronAPI.setItem(STORAGE_KEYS.geminiApiKey, key);
}

export function getApiProfiles() {
  const raw = window.electronAPI.getItem(STORAGE_KEYS.apiProfiles);
  const parsed = raw ? safeParse(raw, []) : [];
  const profiles = Array.isArray(parsed) ? parsed.map(normalizeProfile).filter(Boolean) : [];

  if (profiles.length > 0) {
    return profiles;
  }

  const legacyKey = getGeminiApiKeyLocal();
  if (legacyKey) {
    return [{ id: "legacy-api-key", label: "Legacy key", key: legacyKey }];
  }

  return [];
}

export function setApiProfiles(profiles) {
  const normalized = Array.isArray(profiles) ? profiles.map(normalizeProfile).filter(Boolean) : [];
  window.electronAPI.setItem(STORAGE_KEYS.apiProfiles, JSON.stringify(normalized));
}

export function upsertApiProfile(profile) {
  const normalized = normalizeProfile(profile);
  if (!normalized) {
    return getApiProfiles();
  }

  const profiles = getApiProfiles().filter((item) => item.id !== normalized.id);
  profiles.unshift(normalized);
  setApiProfiles(profiles);
  return profiles;
}

export function removeApiProfile(profileId) {
  const profiles = getApiProfiles().filter((item) => item.id !== profileId);
  setApiProfiles(profiles);
  if (getActiveApiProfileId() === profileId) {
    setActiveApiProfileId(profiles[0]?.id || "");
  }
  return profiles;
}

export function getActiveApiProfileId() {
  return window.electronAPI.getItem(STORAGE_KEYS.activeApiProfileId) || "";
}

export function setActiveApiProfileId(profileId) {
  window.electronAPI.setItem(STORAGE_KEYS.activeApiProfileId, profileId || "");
}

export function getChatModel() {
  return window.electronAPI.getItem(STORAGE_KEYS.chatModel) || DEFAULT_CHAT_MODEL;
}

export function setChatModel(model) {
  window.electronAPI.setItem(STORAGE_KEYS.chatModel, model || DEFAULT_CHAT_MODEL);
}
