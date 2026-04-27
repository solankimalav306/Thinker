import {
  DEFAULT_THEME_PALETTE,
  getTheme,
  getThemePalette,
  setTheme,
  setThemePalette
} from "./state.js";

export const THEME_PALETTES = {
  aurora: {
    label: "Aurora",
    light: {
      bg: "#eef4fb",
      panel: "#ffffff",
      panelSoft: "#f4f8fc",
      line: "#d8e3f0",
      text: "#16202c",
      textSoft: "#5c6d82",
      accent: "#0f8b8d",
      accentStrong: "#0b6f71",
      chip: "#d7f1f0",
      activity: "#f7fafc",
      shadow: "0 8px 24px rgba(28, 42, 56, 0.11)"
    },
    dark: {
      bg: "#0c1118",
      panel: "#141b24",
      panelSoft: "#0f141b",
      line: "#253145",
      text: "#eaf2fb",
      textSoft: "#9faec5",
      accent: "#3bc6bd",
      accentStrong: "#29a79f",
      chip: "#1b3146",
      activity: "#0a0f15",
      shadow: "0 12px 30px rgba(0, 0, 0, 0.45)"
    }
  },
  graphite: {
    label: "Graphite",
    light: {
      bg: "#f4f5f8",
      panel: "#ffffff",
      panelSoft: "#eef1f5",
      line: "#d6dce5",
      text: "#1d2733",
      textSoft: "#607086",
      accent: "#3f6ee6",
      accentStrong: "#3158be",
      chip: "#dbe6ff",
      activity: "#f2f4f8",
      shadow: "0 8px 24px rgba(28, 42, 56, 0.11)"
    },
    dark: {
      bg: "#0c1017",
      panel: "#151b23",
      panelSoft: "#10151c",
      line: "#263042",
      text: "#edf3fb",
      textSoft: "#96a3b8",
      accent: "#6ea8ff",
      accentStrong: "#4f88ee",
      chip: "#17273f",
      activity: "#090d12",
      shadow: "0 12px 30px rgba(0, 0, 0, 0.42)"
    }
  },
  sunset: {
    label: "Sunset",
    light: {
      bg: "#fbf1ea",
      panel: "#ffffff",
      panelSoft: "#fff6f0",
      line: "#ead8cc",
      text: "#2b1f1a",
      textSoft: "#755f53",
      accent: "#d86b45",
      accentStrong: "#b95634",
      chip: "#ffe4d5",
      activity: "#fff6f1",
      shadow: "0 8px 24px rgba(62, 38, 26, 0.12)"
    },
    dark: {
      bg: "#14100e",
      panel: "#1c1714",
      panelSoft: "#16110f",
      line: "#342821",
      text: "#fff2eb",
      textSoft: "#bd9c8d",
      accent: "#f08b60",
      accentStrong: "#d97247",
      chip: "#35251d",
      activity: "#100d0b",
      shadow: "0 12px 30px rgba(0, 0, 0, 0.5)"
    }
  },
  forest: {
    label: "Forest",
    light: {
      bg: "#eef6ef",
      panel: "#ffffff",
      panelSoft: "#f4faf4",
      line: "#d9e6da",
      text: "#19251d",
      textSoft: "#5e7064",
      accent: "#2d8f63",
      accentStrong: "#237551",
      chip: "#d9f0e4",
      activity: "#f5faf6",
      shadow: "0 8px 24px rgba(24, 42, 32, 0.11)"
    },
    dark: {
      bg: "#0d1210",
      panel: "#151c19",
      panelSoft: "#101613",
      line: "#25322c",
      text: "#ebf6ef",
      textSoft: "#96ad9d",
      accent: "#4bbf8a",
      accentStrong: "#2e9f6d",
      chip: "#183425",
      activity: "#0a0f0d",
      shadow: "0 12px 30px rgba(0, 0, 0, 0.45)"
    }
  }
};

function applyPaletteVars(vars) {
  Object.entries(vars).forEach(([key, value]) => {
    document.documentElement.style.setProperty(`--${key}`, value);
  });
}

export function applyTheme() {
  const mode = getTheme() === "light" ? "light" : "dark";
  const paletteName = getThemePalette() || DEFAULT_THEME_PALETTE;
  const palette = THEME_PALETTES[paletteName] || THEME_PALETTES[DEFAULT_THEME_PALETTE];
  const vars = palette[mode] || palette.dark;

  document.documentElement.setAttribute("data-theme", mode);
  document.documentElement.setAttribute("data-palette", paletteName);
  applyPaletteVars(vars);
}

export function initTheme(toggleButton, onChange) {
  applyTheme();

  toggleButton.addEventListener("click", () => {
    const current = getTheme();
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme();
    if (typeof onChange === "function") {
      onChange();
    }
  });
}

export function setThemePaletteName(paletteName) {
  const normalized = THEME_PALETTES[paletteName] ? paletteName : DEFAULT_THEME_PALETTE;
  setThemePalette(normalized);
  applyTheme();
}

export function getThemePaletteOptions() {
  return Object.entries(THEME_PALETTES).map(([value, palette]) => ({
    value,
    label: palette.label
  }));
}
