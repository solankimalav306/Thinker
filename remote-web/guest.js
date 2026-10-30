// The page a guest sees. One shared thing: an artifact, a compiled PDF, or (when the host allows it) a LaTeX project
// you can read and, with an edit code, change together with the host, live.
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
  var live = null; // the live-editing layout, once built

  function show(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  function api(path, options) {
    return fetch(base + path, Object.assign({ credentials: "same-origin", cache: "no-store" }, options || {}));
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
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

  // ---- artifacts: shown in the same sealed frame the app uses ----
  var DARK = {
    "--tk-bg": "#1c1b2e", "--tk-surface": "#24233a", "--tk-sunken": "#2c2b46", "--tk-text": "#f1effa", "--tk-text-2": "#c9c7e6",
    "--tk-text-3": "#a9a7c4", "--tk-border": "#34324d", "--tk-primary": "#f7c948", "--tk-on-primary": "#1c1b2e",
    "--tk-good": "#4ade80", "--tk-warn": "#fbbf24", "--tk-bad": "#f87171", "--tk-info": "#8b85ff", "--tk-scheme": "dark"
  };
  var dark = function () { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; };

  function mountFrame(parent, src) {
    var f = document.createElement("iframe");
    f.title = info.title;
    f.setAttribute("referrerpolicy", "no-referrer");
    f.src = src;
    parent.appendChild(f);
    return f;
  }

  function showArtifact(html) {
    pending = html;
    if (frame && frame.isConnected) { post(); return; }
    view.textContent = "";
    frame = mountFrame(view, base + "/frame/artifact-frame.html");
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

  // ---- a project: just the PDF, or the PDF beside a live editor ----
  function pdfFrame(parent) {
    var f = mountFrame(parent, base + "/api/content");
    f.className = "pdf";
    return f;
  }

  // the PDF is shown only once there is one; before that, say what to do instead of showing an error page
  function refreshPdf(holder) {
    return api("/api/content?t=" + Date.now()).then(function (res) {
      var isPdf = (res.headers.get("content-type") || "").indexOf("application/pdf") === 0;
      var existing = holder.querySelector("iframe.pdf");
      var note = holder.querySelector(".no-pdf");
      if (!isPdf) {
        if (existing) existing.remove();
        if (!note) { note = el("p", "no-pdf", info.canEdit ? "Nothing has been built yet. Press Build PDF." : "Nothing has been built yet. The PDF appears here when the host compiles."); holder.appendChild(note); }
        return;
      }
      if (note) note.remove();
      if (existing) existing.src = base + "/api/content?t=" + Date.now();
      else pdfFrame(holder);
    });
  }

  var myName = (function () {
    try { var saved = localStorage.getItem("thinker-guest-name"); if (saved) return saved; } catch (e) { /* private mode */ }
    return "Guest " + (10 + Math.floor(Math.random() * 90));
  })();

  function buildLive() {
    view.textContent = "";
    view.className = "view live";
    var left = el("div", "pane edit-pane");
    var right = el("div", "pane preview-pane");

    var bar = el("div", "pane-bar");
    var files = el("select", "file-select");
    files.setAttribute("aria-label", "File");
    var status = el("span", "chip", "Connecting…");
    var people = el("span", "chip people");
    people.hidden = true;
    bar.append(files, status, people);
    var mount = el("div", "editor-mount");
    left.append(bar, mount);

    var pbar = el("div", "pane-bar");
    var build = el("button", "build-btn", "Build PDF");
    build.type = "button";
    var buildStatus = el("span", "chip", "");
    pbar.append(build, buildStatus);
    if (!info.canEdit) { build.hidden = true; }
    var holder = el("div", "pdf-holder");
    right.append(pbar, holder);

    var tabs = el("div", "tabs");
    var tabEdit = el("button", "tab active", "Edit");
    var tabPdf = el("button", "tab", "PDF");
    tabEdit.type = tabPdf.type = "button";
    tabs.append(tabEdit, tabPdf);
    var pick = function (which) {
      view.classList.toggle("show-pdf", which === "pdf");
      tabEdit.classList.toggle("active", which === "edit");
      tabPdf.classList.toggle("active", which === "pdf");
    };
    tabEdit.addEventListener("click", function () { pick("edit"); });
    tabPdf.addEventListener("click", function () { pick("pdf"); });

    view.append(tabs, left, right);
    live = { files: files, status: status, people: people, mount: mount, holder: holder, editor: null, file: null, build: build, buildStatus: buildStatus };

    function openFile(file) {
      if (live.editor) { live.editor.destroy(); live.editor = null; }
      mount.textContent = "";
      live.file = file;
      var wsBase = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + base + "/ws";
      live.editor = window.ThinkerGuestEditor.openFile(mount, {
        wsBase: wsBase, file: file, name: myName, readOnly: !info.canEdit,
        onStatus: function (s) { status.textContent = s === "synced" ? (info.canEdit ? "Editing live" : "Watching live") : s === "connected" ? "Loading…" : s === "connecting" ? "Connecting…" : "Reconnecting…"; status.classList.toggle("bad", s === "disconnected"); },
        onPeople: function (list) {
          people.hidden = !list.length;
          people.textContent = list.length ? "With " + list.map(function (p) { return p.name; }).slice(0, 3).join(", ") + (list.length > 3 ? " +" + (list.length - 3) : "") : "";
        }
      });
    }
    files.addEventListener("change", function () { openFile(files.value); });
    live.openFile = openFile;

    build.addEventListener("click", function () {
      build.disabled = true;
      buildStatus.textContent = "Building…";
      api("/api/compile", { method: "POST" }).then(function (res) { return res.json().then(function (b) { return { status: res.status, body: b }; }); })
        .then(function (r) {
          if (r.status !== 200) { buildStatus.textContent = r.body.error || "Could not build."; return; }
          if (r.body.notReady) { buildStatus.textContent = "The host has not set up the LaTeX compiler yet."; buildStatus.classList.add("bad"); return; }
          var errors = (r.body.problems || []).filter(function (p) { return p.severity === "error"; });
          buildStatus.textContent = r.body.ok ? "Built" : errors.length + " error" + (errors.length === 1 ? "" : "s") + (errors[0] ? ": " + errors[0].message : "");
          buildStatus.classList.toggle("bad", !r.body.ok);
        })
        .catch(function () { buildStatus.textContent = "Could not build."; })
        .then(function () { setTimeout(function () { build.disabled = false; }, 3000); });
    });

    return api("/api/files").then(function (res) { return res.json(); }).then(function (body) {
      var list = body.files || [];
      list.forEach(function (f) { files.appendChild(new Option(f, f)); });
      var first = list.indexOf("main.tex") >= 0 ? "main.tex" : list[0];
      if (first) { files.value = first; openFile(first); } else { status.textContent = "No text files"; }
      refreshPdf(holder);
    });
  }

  function load() {
    return api("/api/content").then(function (res) {
      if (res.status === 401) { showGate(); return; }
      var isPdf = (res.headers.get("content-type") || "").indexOf("application/pdf") === 0;
      if (info.live) {
        show("");
        view.hidden = false;
        if (!live) return buildLive();
        refreshPdf(live.holder);
        return;
      }
      if (res.status === 404 || res.status === 502) {
        return res.json().then(function (b) { view.hidden = true; show(b.error || "Nothing to show yet."); });
      }
      show("");
      view.hidden = false;
      if (isPdf) {
        frame = null;
        if (!view.querySelector("iframe.pdf")) { view.textContent = ""; pdfFrame(view); }
        else view.querySelector("iframe.pdf").src = base + "/api/content?t=" + Date.now();
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
      if (live && live.editor) { live.editor.destroy(); live.editor = null; }
      live = null;
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
        $("role").textContent = body.canEdit ? "Can edit" : "View only";
        $("role").classList.toggle("can-edit", Boolean(body.canEdit));
        if (body.live) {
          var who = $("who");
          who.hidden = false;
          $("me").value = myName;
          $("me").addEventListener("change", function () {
            myName = $("me").value.trim().slice(0, 24) || myName;
            try { localStorage.setItem("thinker-guest-name", myName); } catch (e) { /* private mode */ }
            if (live && live.file) live.openFile(live.file);
          });
          var script = document.createElement("script");
          script.src = base + "/editor.js";
          return new Promise(function (resolve, reject) { script.onload = resolve; script.onerror = reject; document.head.appendChild(script); })
            .then(function () { return load(); }).then(watch);
        }
        return load().then(watch);
      });
    });
  }

  start().catch(function () { show("Could not reach the person sharing this."); });
})();
