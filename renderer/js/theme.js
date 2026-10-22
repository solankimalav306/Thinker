import { getTheme, setTheme } from "./state.js";

// One brand palette (see css/tokens.css) in light and dark. The only thing a user can tune is
// the accent: it drives primary buttons and the active highlight in the navigation.
export const DEFAULT_ACCENT = "#ffd23f";
export const ACCENT_STORAGE_KEY = "custom-accent-color";

export const ACCENT_PRESETS = [
  { name: "Highlighter", value: "#ffd23f" },
  { name: "Pen", value: "#4f46e5" },
  { name: "Coral", value: "#ff6b57" },
  { name: "Mint", value: "#2fbf9b" },
  { name: "Grape", value: "#a259f7" }
];

// Kept so older imports keep working; palettes were replaced by the single brand theme.
export const THEME_PALETTES = {};

const ACCENT_VARS = ["--primary", "--primary-hover", "--primary-press", "--on-primary"];

function relativeLuminance(hex) {
  const channel = (i) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ""));
}

// Applies (or clears) a custom accent, picking dark or light text so buttons stay readable.
export function applyAccent(color) {
  const root = document.documentElement.style;
  if (!isHexColor(color) || color.toLowerCase() === DEFAULT_ACCENT) {
    ACCENT_VARS.forEach((name) => root.removeProperty(name));
    return;
  }
  root.setProperty("--primary", color);
  root.setProperty("--primary-hover", `color-mix(in srgb, ${color} 88%, white)`);
  root.setProperty("--primary-press", `color-mix(in srgb, ${color} 82%, black)`);
  root.setProperty("--on-primary", relativeLuminance(color) > 0.4 ? "#1c1b2e" : "#ffffff");
}

export function getAccent() {
  const stored = window.electronAPI.getItem(ACCENT_STORAGE_KEY);
  return isHexColor(stored) ? stored : DEFAULT_ACCENT;
}

export function setAccent(color) {
  if (!isHexColor(color)) return;
  window.electronAPI.setItem(ACCENT_STORAGE_KEY, color);
  applyAccent(color);
}

export function resetAccent() {
  window.electronAPI.removeItem(ACCENT_STORAGE_KEY);
  applyAccent(DEFAULT_ACCENT);
}

export function applyTheme() {
  const mode = getTheme() === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", mode);
  applyAccent(getAccent());
  window.electronAPI.setTitleBarTheme?.(mode);
}

export function initTheme(toggleButton, onChange) {
  applyTheme();
  toggleButton?.addEventListener("click", () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
    applyTheme();
    if (typeof onChange === "function") onChange();
  });
}
