// What the reader shows instead of a page when a file cannot be displayed: a locked PDF asks for
// its password, anything else explains the problem in plain words and offers a way forward.

const COPY = {
  invalid: {
    icon: "fa-file-circle-exclamation",
    title: "This file won't open",
    text: "It might be damaged, or it might not be a PDF at all. If you downloaded it, try downloading it again."
  },
  empty: {
    icon: "fa-file",
    title: "This file is empty",
    text: "There is nothing inside it to show. If it came from an email or a download, it may not have finished."
  },
  missing: {
    icon: "fa-folder-open",
    title: "We can't find this file",
    text: "It may have been moved, renamed or deleted since you last opened it."
  },
  unknown: {
    icon: "fa-triangle-exclamation",
    title: "Something went wrong opening this file",
    text: "Try opening it again. If it keeps happening, the technical details below can help."
  }
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, className, onClick, icon) {
  const node = el("button", `btn ${className}`.trim());
  node.type = "button";
  if (icon) node.innerHTML = `<i class="fa-solid ${icon}"></i> `;
  node.append(label);
  node.addEventListener("click", onClick);
  return node;
}

// info: { kind, path, error }. actions: { onUnlock(password), onChoose(), onClose(), onForget() }
export function renderDocState(container, info, actions) {
  container.textContent = "";
  container.hidden = false;
  const card = el("div", "doc-state-card doc-error");
  card.setAttribute("role", "alert");

  if (info.kind === "password" || info.kind === "wrong-password") {
    const icon = el("div", "doc-state-icon");
    icon.innerHTML = '<i class="fa-solid fa-lock"></i>';
    const form = el("form", "doc-state-form");
    const input = el("input");
    input.type = "password";
    input.placeholder = "Password";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "PDF password");
    if (info.kind === "wrong-password") input.setAttribute("aria-invalid", "true");
    const unlock = el("button", "btn primary", "Unlock");
    unlock.type = "submit";
    form.append(input, unlock);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (input.value) actions.onUnlock(input.value);
    });
    card.append(icon, el("h2", null, "This PDF is locked"), el("p", null, "Enter the password to open it. Thinker doesn't store it."), form);
    if (info.kind === "wrong-password") card.appendChild(el("p", "doc-state-error", "That password didn't work. Check it and try again."));
    const row = el("div", "doc-state-actions");
    row.append(button("Close tab", "", actions.onClose));
    card.appendChild(row);
    container.appendChild(card);
    setTimeout(() => input.focus(), 0);
    return;
  }

  const copy = COPY[info.kind] || COPY.unknown;
  const icon = el("div", "doc-state-icon");
  icon.innerHTML = `<i class="fa-solid ${copy.icon}"></i>`;
  const row = el("div", "doc-state-actions");
  row.append(button("Choose another file", "primary", actions.onChoose, "fa-folder-open"));
  if (info.kind === "missing") row.append(button("Forget this file", "", actions.onForget));
  row.append(button("Close tab", "", actions.onClose));

  const details = el("details", "doc-state-details");
  details.append(el("summary", null, "Technical details"));
  const pre = el("pre");
  pre.textContent = `${info.error?.name || "Error"}: ${info.error?.message || ""}\n${info.path}`;
  details.appendChild(pre);

  card.append(icon, el("h2", null, copy.title), el("p", null, copy.text), row, details);
  container.appendChild(card);
}

export function clearDocState(container) {
  container.textContent = "";
  container.hidden = true;
}
