// The page a guest sees. It shows one shared thing, read-only, and refreshes it when the host changes it.
(function () {
  "use strict";

  var base = location.pathname.replace(/\/+$/, "");
  var $ = function (id) { return document.getElementById(id); };
  var gate = $("gate");
  var message = $("message");
  var view = $("view");
  var info = null;
  var frame = null;
  var pending = null;

  function show(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  function api(path, options) {
    return fetch(base + path, Object.assign({ credentials: "same-origin", cache: "no-store" }, options || {}));
  }

  function showGate() {
    view.hidden = true;
    gate.hidden = false;
    $("pin").focus();
  }

  gate.addEventListener("submit", function (event) {
    event.preventDefault();
    $("gate-error").textContent = "";
    api("/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: $("pin").value }) })
      .then(function (res) {
        if (res.ok) { gate.hidden = true; return start(); }
        return res.json().then(function (body) { $("gate-error").textContent = body.error || "That did not work."; $("pin").select(); });
      })
      .catch(function () { $("gate-error").textContent = "Could not reach the person sharing this."; });
  });

  var DARK = {
    "--tk-bg": "#1c1b2e", "--tk-surface": "#24233a", "--tk-sunken": "#2c2b46", "--tk-text": "#f1effa", "--tk-text-2": "#c9c7e6",
    "--tk-text-3": "#a9a7c4", "--tk-border": "#34324d", "--tk-primary": "#f7c948", "--tk-on-primary": "#1c1b2e",
    "--tk-good": "#4ade80", "--tk-warn": "#fbbf24", "--tk-bad": "#f87171", "--tk-info": "#8b85ff", "--tk-scheme": "dark"
  };
  var dark = function () { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; };

  function mountFrame(src) {
    view.textContent = "";
    var f = document.createElement("iframe");
    f.title = info.title;
    f.setAttribute("referrerpolicy", "no-referrer");
    f.src = src;
    view.appendChild(f);
    return f;
  }

  function showArtifact(html) {
    pending = html;
    if (frame && frame.isConnected) { post(); return; }
    frame = mountFrame(base + "/frame/artifact-frame.html");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.className = "fit";
    frame.style.height = "80px";
  }

  function post() {
    if (!frame || !frame.contentWindow) return;
    fetch(base + "/kit.css", { cache: "no-store" }).then(function (r) { return r.text(); }).then(function (css) {
      frame.contentWindow.postMessage({ type: "render", html: pending, css: css, tokens: dark() ? DARK : {} }, "*");
    });
  }

  window.addEventListener("message", function (event) {
    if (!frame || event.source !== frame.contentWindow) return;
    var data = event.data || {};
    if (data.type === "ready") post();
    else if (data.type === "height" && isFinite(data.value)) {
      frame.style.height = Math.max(80, Math.min(Math.ceil(data.value), 20000)) + "px";
    }
  });

  function load() {
    return api("/api/content").then(function (res) {
      if (res.status === 401) { showGate(); return; }
      if (res.status === 404 || res.status === 502) {
        return res.json().then(function (b) { view.hidden = true; show(b.error || "Nothing to show yet."); });
      }
      show("");
      view.hidden = false;
      if ((res.headers.get("content-type") || "").indexOf("application/pdf") === 0) {
        frame = null;
        if (!view.querySelector("iframe.pdf")) {
          var f = mountFrame(base + "/api/content");
          f.className = "pdf";
        } else {
          view.querySelector("iframe.pdf").src = base + "/api/content?t=" + Date.now();
        }
        return;
      }
      return res.json().then(function (body) { if (body.type === "html") showArtifact(body.html); });
    });
  }

  function watch() {
    var source = new EventSource(base + "/api/events");
    var first = true;
    source.addEventListener("version", function () {
      $("live").hidden = false;
      if (first) { first = false; return; }
      load();
    });
    source.addEventListener("ended", function () {
      source.close();
      $("live").hidden = true;
      view.hidden = true;
      show("The person sharing this has stopped sharing.");
    });
    source.onerror = function () { $("live").hidden = true; };
  }

  function start() {
    return api("/api/info").then(function (res) {
      if (res.status === 401) { showGate(); return; }
      if (!res.ok) { show("This link has ended or is not valid."); return; }
      return res.json().then(function (body) {
        info = body;
        $("title").textContent = body.title;
        document.title = body.title + " - Thinker";
        return load().then(watch);
      });
    });
  }

  start().catch(function () { show("Could not reach the person sharing this."); });
})();
