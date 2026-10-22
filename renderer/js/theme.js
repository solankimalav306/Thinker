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
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

const INK = "#1c1b2e";

export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Whichever of ink or white reads better on the accent colour.
export function readableOn(color) {
  return contrastRatio(color, "#ffffff") >= contrastRatio(color, INK) ? "#ffffff" : INK;
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ""));
}

function mixHex(from, to, amount) {
  const part = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const channel = (i) => Math.round(part(from, i) + (part(to, i) - part(from, i)) * amount).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

// The fill and text colour to use for a chosen accent. Text is white or ink, whichever reads
// better; if even that is below 4.5:1 the fill is nudged darker or lighter until it is readable.
export function accentColors(color) {
  const text = readableOn(color);
  const toward = text === "#ffffff" ? "#000000" : "#ffffff";
  let fill = color;
  for (let i = 0; i < 14 && contrastRatio(fill, text) < 4.5; i += 1) fill = mixHex(fill, toward, 0.06);
  return { fill, text };
}

// Applies (or clears) a custom accent so buttons keep readable text.
export function applyAccent(color) {
  const root = document.documentElement.style;
  if (!isHexColor(color) || color.toLowerCase() === DEFAULT_ACCENT) {
    ACCENT_VARS.forEach((name) => root.removeProperty(name));
    return;
  }
  const { fill, text } = accentColors(color);
  root.setProperty("--primary", fill);
  root.setProperty("--primary-hover", `color-mix(in srgb, ${fill} 88%, white)`);
  root.setProperty("--primary-press", `color-mix(in srgb, ${fill} 82%, black)`);
  root.setProperty("--on-primary", text);
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
