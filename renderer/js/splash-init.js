    (function() {
      const urlParams = new URLSearchParams(window.location.search);
      const savedTheme = urlParams.get('theme') || 'dark';
      const savedPalette = urlParams.get('palette') || 'aurora';
      const customAccent = urlParams.get('customAccent') || '';

      document.documentElement.setAttribute('data-theme', savedTheme);
      document.documentElement.setAttribute('data-palette', savedPalette);
      
      const palettes = {
        aurora: { light: "#0d7f8d", dark: "#37c2b5" },
        graphite: { light: "#3f6ee6", dark: "#6ea8ff" },
        sunset: { light: "#d86b45", dark: "#f08b60" },
        forest: { light: "#2d8f63", dark: "#4bbf8a" }
      };

      let accentColor = customAccent;
      if (!accentColor) {
        const p = palettes[savedPalette] || palettes.aurora;
        accentColor = p[savedTheme] || p.dark;
      }
      
      document.documentElement.style.setProperty('--accent', accentColor);
      
      const bgColors = {
        light: {
          aurora: "#eef4fb",
          graphite: "#f4f5f8",
          sunset: "#fbf1ea",
          forest: "#eef6ef"
        },
        dark: {
          aurora: "#0c1118",
          graphite: "#0c1017",
          sunset: "#14100e",
          forest: "#0d1210"
        }
      };

      const panelColors = {
        light: {
          aurora: "#ffffff",
          graphite: "#ffffff",
          sunset: "#ffffff",
          forest: "#ffffff"
        },
        dark: {
          aurora: "#141b24",
          graphite: "#151b23",
          sunset: "#1c1714",
          forest: "#151c19"
        }
      };

      const textColors = {
        light: {
          aurora: "#16202c",
          graphite: "#1d2733",
          sunset: "#2b1f1a",
          forest: "#19251d"
        },
        dark: {
          aurora: "#eaf2fb",
          graphite: "#edf3fb",
          sunset: "#fff2eb",
          forest: "#ebf6ef"
        }
      };

      const textSoftColors = {
        light: "#5c6d82",
        dark: "#9faec5"
      };

      const lineColors = {
        light: {
          aurora: "#d8e3f0",
          graphite: "#d6dce5",
          sunset: "#ead8cc",
          forest: "#d9e6da"
        },
        dark: {
          aurora: "#253145",
          graphite: "#263042",
          sunset: "#342821",
          forest: "#25322c"
        }
      };

      const themeBg = bgColors[savedTheme][savedPalette] || bgColors[savedTheme].aurora;
      const themePanel = panelColors[savedTheme][savedPalette] || panelColors[savedTheme].aurora;
      const themeText = textColors[savedTheme][savedPalette] || textColors[savedTheme].aurora;
      const themeTextSoft = textSoftColors[savedTheme];
      const themeLine = lineColors[savedTheme][savedPalette] || lineColors[savedTheme].aurora;

      document.documentElement.style.setProperty('--bg', themeBg);
      document.documentElement.style.setProperty('--panel', themePanel);
      document.documentElement.style.setProperty('--text', themeText);
      document.documentElement.style.setProperty('--text-soft', themeTextSoft);
      document.documentElement.style.setProperty('--line', themeLine);
    })();
  