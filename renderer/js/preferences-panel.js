import { listSettings, getSetting, setSetting, resetSetting, isModified, onSettingChange } from "./settings-registry.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildControl(def) {
  const current = getSetting(def.key);
  const commit = (value) => setSetting(def.key, value).catch((error) => console.warn(error.message));

  if (def.type === "boolean") {
    const label = el("label", "toggle-switch");
    const input = el("input");
    input.type = "checkbox";
    input.checked = Boolean(current);
    input.setAttribute("aria-label", def.label);
    input.addEventListener("change", () => commit(input.checked));
    label.append(input, el("span", "toggle-slider"));
    return label;
  }
  if (def.type === "enum") {
    const select = el("select", "prefs-input");
    select.setAttribute("aria-label", def.label);
    def.options.forEach((option) => {
      const node = el("option", null, option.label);
      node.value = option.value;
      select.appendChild(node);
    });
    select.value = current;
    select.addEventListener("change", () => commit(select.value));
    return select;
  }
  const input = el("input", "prefs-input");
  input.setAttribute("aria-label", def.label);
  input.type = def.type === "number" ? "number" : "text";
  if (def.type === "number") {
    if (def.min != null) input.min = def.min;
    if (def.max != null) input.max = def.max;
  }
  input.value = current;
  input.addEventListener("change", () => commit(input.value));
  return input;
}

// Renders the registry into `container`, honouring the search text and the "modified only" filter.
export function renderPreferences({ container, searchInput, modifiedOnlyInput }) {
  const draw = () => {
    const query = (searchInput?.value || "").trim().toLowerCase();
    const modifiedOnly = Boolean(modifiedOnlyInput?.checked);
    container.textContent = "";

    const visible = listSettings().filter((def) => {
      if (modifiedOnly && !isModified(def.key)) return false;
      if (!query) return true;
      return `${def.label} ${def.description || ""} ${def.group} ${def.key}`.toLowerCase().includes(query);
    });

    if (visible.length === 0) {
      container.appendChild(el("p", "prefs-empty", modifiedOnly && !query ? "You haven't changed any settings." : "No settings match."));
      return;
    }

    const groups = new Map();
    visible.forEach((def) => {
      if (!groups.has(def.group)) groups.set(def.group, []);
      groups.get(def.group).push(def);
    });

    groups.forEach((defs, group) => {
      container.appendChild(el("h4", "prefs-group", group));
      defs.forEach((def) => {
        const row = el("div", "prefs-row");
        const info = el("div", "prefs-info");
        info.append(el("span", "prefs-label", def.label));
        if (def.description) info.append(el("span", "prefs-desc", def.description));

        const actions = el("div", "prefs-actions");
        actions.appendChild(buildControl(def));
        if (isModified(def.key)) {
          const reset = el("button", "btn icon-btn prefs-reset");
          reset.type = "button";
          reset.title = `Reset "${def.label}" to its default`;
          reset.setAttribute("aria-label", reset.title);
          reset.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
          reset.addEventListener("click", () => resetSetting(def.key));
          actions.appendChild(reset);
        }
        row.append(info, actions);
        container.appendChild(row);
      });
    });
  };

  searchInput?.addEventListener("input", draw);
  modifiedOnlyInput?.addEventListener("change", draw);
  // Redraw after a change so reset buttons and the modified filter stay accurate.
  onSettingChange(() => draw());
  draw();
}
