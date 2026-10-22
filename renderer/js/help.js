// Renders the Help screen from help-content.js. All text is set with textContent.
import { GUIDES, SHORTCUTS, FAQ, LINKS } from "./help-content.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// actions: { run(name), openLink(url) }
export function renderHelp(container, actions) {
  container.textContent = "";

  const head = el("header", "settings-head");
  head.append(el("h1", null, "Help"), el("p", null, "Short guides for everything Thinker does. Nothing here is homework: dip in when you need it."));
  const tours = el("div", "help-tours");
  const tourButton = (label, icon, run) => {
    const b = el("button", "btn");
    b.type = "button";
    b.innerHTML = `<i class="fa-solid ${icon}"></i> `;
    b.append(label);
    b.addEventListener("click", () => actions.run(run));
    return b;
  };
  tours.append(
    tourButton("Take the welcome tour", "fa-route", "tour:welcome"),
    tourButton("Tour the reader", "fa-book-open", "tour:reader"),
    tourButton("Show the Get started checklist", "fa-list-check", "checklist:show")
  );
  head.appendChild(tours);
  container.appendChild(head);

  // ---- guides
  const guides = el("section", "settings-card");
  const guidesHead = el("div", "card-head");
  guidesHead.append(el("h3", null, "How to"), el("span", null, `${GUIDES.length} short guides`));
  guides.appendChild(guidesHead);
  const list = el("div", "help-guides");
  GUIDES.forEach((guide, index) => {
    const details = el("details", "guide");
    details.id = `guide-${guide.id}`;
    if (index === 0) details.open = true;
    const summary = el("summary");
    const icon = el("span", "guide-icon");
    icon.innerHTML = `<i class="fa-solid ${guide.icon}"></i>`;
    const text = el("span", "guide-text");
    text.append(el("strong", null, guide.title), el("span", null, guide.summary));
    summary.append(icon, text);
    details.appendChild(summary);

    const body = el("div", "guide-body");
    const steps = el("ol", "guide-steps");
    guide.steps.forEach((step) => steps.appendChild(el("li", null, step)));
    body.appendChild(steps);
    if (guide.tip) {
      const tip = el("p", "guide-tip");
      tip.append(el("strong", null, "Tip: "), guide.tip);
      body.appendChild(tip);
    }
    const buttons = el("div", "guide-actions");
    (guide.links || []).forEach((key) => {
      const link = LINKS[key];
      const b = el("button", "btn");
      b.type = "button";
      b.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i> ';
      b.append(link.label);
      b.addEventListener("click", () => actions.openLink(link.url));
      buttons.appendChild(b);
    });
    if (guide.action) {
      const b = el("button", "btn primary", guide.action.label);
      b.type = "button";
      b.addEventListener("click", () => actions.run(guide.action.run));
      buttons.appendChild(b);
    }
    if (buttons.childElementCount) body.appendChild(buttons);
    details.appendChild(body);
    list.appendChild(details);
  });
  guides.appendChild(list);
  container.appendChild(guides);

  // ---- shortcuts
  const shortcuts = el("section", "settings-card");
  const shortcutsHead = el("div", "card-head");
  shortcutsHead.append(el("h3", null, "Keyboard shortcuts"), el("span", null, "Ctrl is Cmd on a Mac"));
  shortcuts.appendChild(shortcutsHead);
  const table = el("div", "shortcut-list");
  SHORTCUTS.forEach((row) => {
    const line = el("div", "shortcut-row");
    const keys = el("span", "shortcut-keys");
    row.keys.forEach((key, i) => {
      if (i > 0) keys.append(" + ");
      keys.appendChild(el("kbd", null, key));
    });
    line.append(keys, el("span", "shortcut-does", row.does));
    table.appendChild(line);
  });
  shortcuts.appendChild(table);
  container.appendChild(shortcuts);

  // ---- FAQ
  const faq = el("section", "settings-card");
  const faqHead = el("div", "card-head");
  faqHead.append(el("h3", null, "Questions people ask"));
  faq.appendChild(faqHead);
  FAQ.forEach((item) => {
    const details = el("details", "faq");
    details.append(el("summary", null, item.q), el("p", null, item.a));
    faq.appendChild(details);
  });
  container.appendChild(faq);
}

// Opens a guide from elsewhere (for example a checklist item) and scrolls to it.
export function openGuide(container, id) {
  const guide = container.querySelector(`#guide-${CSS.escape(id)}`);
  if (!guide) return false;
  guide.open = true;
  guide.scrollIntoView({ block: "start", behavior: "smooth" });
  return true;
}
