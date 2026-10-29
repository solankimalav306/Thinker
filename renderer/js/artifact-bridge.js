// Runs INSIDE the sandboxed artifact frame. It is the only script there, and it is ours.
// It receives HTML from the app, cleans it a second time, shows it, tells the app how tall it is, and turns
// clicks on marked elements into a few fixed messages. It never evaluates anything the model wrote.
(function () {
  "use strict";

  var ALLOWED_DATA = { "data-cite": 1, "data-action": 1, "data-text": 1, "data-page": 1, "data-cite-unverified": 1 };
  var CONFIG = {
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link", "meta", "base", "frame", "frameset", "audio", "video", "source", "foreignObject"],
    FORBID_ATTR: ["srcdoc", "formaction", "action", "ping", "target"],
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP: /^(?:#|data:image\/(?:png|jpe?g|gif|webp);base64,)/i
  };
  var root = document.getElementById("root");
  var kitStyle = document.createElement("style");
  document.head.appendChild(kitStyle);

  function post(message) {
    window.parent.postMessage(message, "*");
  }

  if (window.DOMPurify) {
    window.DOMPurify.addHook("uponSanitizeAttribute", function (_node, data) {
      if (data.attrName.indexOf("data-") === 0 && !ALLOWED_DATA[data.attrName]) data.keepAttr = false;
    });
  }

  function applyTokens(tokens) {
    if (!tokens || typeof tokens !== "object") return;
    Object.keys(tokens).forEach(function (key) {
      var value = tokens[key];
      if (/^--tk-[a-z0-9-]+$/.test(key) && typeof value === "string" && value.length < 80 && !/[;{}]/.test(value)) {
        document.documentElement.style.setProperty(key, value);
      }
    });
    if (tokens["--tk-scheme"] === "dark" || tokens["--tk-scheme"] === "light") document.documentElement.style.colorScheme = tokens["--tk-scheme"];
  }

  function render(data) {
    if (!window.DOMPurify) {
      root.textContent = "This content could not be displayed safely.";
      post({ type: "error", reason: "no-sanitiser" });
      return;
    }
    if (typeof data.css === "string") kitStyle.textContent = data.css.slice(0, 60000);
    applyTokens(data.tokens);
    root.innerHTML = window.DOMPurify.sanitize(String(data.html || "").slice(0, 200000), CONFIG);
    measure();
  }

  function measure() {
    post({ type: "height", value: Math.ceil(document.documentElement.scrollHeight) });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data || {};
    if (data.type === "render") render(data);
    else if (data.type === "theme") applyTokens(data.tokens);
  });

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("[data-cite], [data-action]") : null;
    var anchor = event.target && event.target.closest ? event.target.closest("a") : null;
    if (anchor) event.preventDefault(); // links never navigate; only the marked ones do something
    if (!target) return;
    event.preventDefault();
    post({
      type: "action",
      cite: target.getAttribute("data-cite"),
      action: target.getAttribute("data-action"),
      text: (target.getAttribute("data-text") || "").slice(0, 5000)
    });
  });

  if (typeof ResizeObserver === "function") new ResizeObserver(measure).observe(document.documentElement);
  window.addEventListener("load", measure);
  post({ type: "ready" });
})();
