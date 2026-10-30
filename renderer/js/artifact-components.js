// Draws and runs the interactive artifacts (checklist, steps, quiz, flashcards, table, chart, diagram, timeline, document).
// It runs INSIDE the sandboxed artifact frame and is Thinker's own code: the model supplies data (see artifact-spec.js), never
// code. Everything is built from elements and text nodes; nothing here ever assigns model text to innerHTML.
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";

  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }
  function svg(tag, attrs, text) {
    var el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function btn(label, cls, onClick) {
    var b = h("button", cls, label);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  // ---- rich text: **bold**, *italic*, `code`, lists, and maths between dollar signs ----------------------------------
  var INLINE = /(\$\$[^$]+\$\$|\$[^$\n]+\$|\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/;

  function math(tex, display) {
    var el = h(display ? "div" : "span", display ? "tk-math tk-math-block" : "tk-math");
    if (window.katex && typeof window.katex.render === "function") {
      try {
        window.katex.render(tex, el, { throwOnError: false, displayMode: display, trust: false, strict: "ignore", maxExpand: 200, maxSize: 30 });
        return el;
      } catch (e) { /* fall through to the plain text */ }
    }
    el.textContent = tex;
    return el;
  }

  function inline(parent, text) {
    String(text).split(INLINE).forEach(function (part) {
      if (!part) return;
      if (part.slice(0, 2) === "$$" && part.length > 4) parent.appendChild(math(part.slice(2, -2), true));
      else if (part.charAt(0) === "$" && part.length > 2) parent.appendChild(math(part.slice(1, -1), false));
      else if (part.slice(0, 2) === "**" && part.length > 4) parent.appendChild(h("strong", "", part.slice(2, -2)));
      else if (part.charAt(0) === "*" && part.length > 2) parent.appendChild(h("em", "", part.slice(1, -1)));
      else if (part.charAt(0) === "`" && part.length > 2) parent.appendChild(h("code", "", part.slice(1, -1)));
      else parent.appendChild(document.createTextNode(part));
    });
  }

  // a block of text: paragraphs, bullet and numbered lists
  function rich(parent, text) {
    var blocks = String(text).split(/\n{2,}/);
    blocks.forEach(function (block) {
      var lines = block.split("\n").filter(function (l) { return l.trim(); });
      if (!lines.length) return;
      var bullets = lines.every(function (l) { return /^\s*[-*•]\s+/.test(l); });
      var numbers = lines.every(function (l) { return /^\s*\d+[.)]\s+/.test(l); });
      if (bullets || numbers) {
        var list = h(numbers ? "ol" : "ul", "tk-list");
        lines.forEach(function (l) { var li = h("li"); inline(li, l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")); list.appendChild(li); });
        parent.appendChild(list);
      } else {
        var p = h("p", "tk-p");
        lines.forEach(function (l, i) { if (i) p.appendChild(document.createElement("br")); inline(p, l); });
        parent.appendChild(p);
      }
    });
  }

  // a reference to a page of the source; one the answer was not given is shown dashed and does nothing
  function citeChip(ctx, c) {
    if (!c) return null;
    var at = c.lastIndexOf("|");
    var page = parseInt(c.slice(at + 1), 10);
    var a = h("a", "tk-cite", "Page " + (isNaN(page) ? "?" : page));
    a.setAttribute("role", "link");
    a.title = c.slice(0, at) + ", page " + page;
    if (ctx.cites && ctx.cites[c] === false) {
      a.setAttribute("data-cite-unverified", "1");
      a.title = "This reference could not be checked against the sources";
    } else {
      a.setAttribute("data-cite", c);
    }
    return a;
  }

  function progress(done, total, label) {
    var wrap = h("div", "tk-progress");
    var bar = h("div", "tk-progress-bar");
    var fill = h("span");
    fill.style.width = (total ? Math.round(done / total * 100) : 0) + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);
    wrap.appendChild(h("span", "tk-progress-text", label || (done + " of " + total + " done")));
    return wrap;
  }

  // ---- checklist -----------------------------------------------------------------------------------------------
  function checklist(root, spec, ctx) {
    var done = ctx.state.done = ctx.state.done || {};
    var total = 0;
    spec.groups.forEach(function (g) { total += g.items.length; });
    var head = h("div", "tk-head");
    var body = h("div", "tk-checklist");
    root.appendChild(head);
    root.appendChild(body);

    function count() { return Object.keys(done).filter(function (k) { return done[k]; }).length; }
    function paintHead() {
      head.textContent = "";
      head.appendChild(progress(count(), total));
      if (count() === total && total) head.appendChild(h("div", "tk-banner tk-good", "All done. Nice work."));
      if (count()) head.appendChild(btn("Start over", "tk-link", function () { ctx.state.done = done = {}; draw(); ctx.save(); }));
    }
    function draw() {
      body.textContent = "";
      spec.groups.forEach(function (g, gi) {
        var section = h("section", "tk-group");
        if (g.title) section.appendChild(h("h3", "tk-group-title", g.title));
        g.items.forEach(function (item, ii) {
          var key = gi + "." + ii;
          var row = h("label", "tk-task" + (done[key] ? " tk-done" : ""));
          var box = h("input");
          box.type = "checkbox";
          box.checked = Boolean(done[key]);
          box.addEventListener("change", function () { if (box.checked) done[key] = true; else delete done[key]; row.classList.toggle("tk-done", box.checked); paintHead(); ctx.save(); });
          var text = h("span", "tk-task-text");
          inline(text, item.text);
          row.appendChild(box);
          row.appendChild(text);
          var chip = citeChip(ctx, item.cite);
          if (chip) row.appendChild(chip);
          if (item.note) { var note = h("span", "tk-task-note"); inline(note, item.note); text.appendChild(note); }
          section.appendChild(row);
        });
        body.appendChild(section);
      });
    }
    draw();
    paintHead();
  }

  // ---- steps -------------------------------------------------------------------------------------------------
  function steps(root, spec, ctx) {
    var done = ctx.state.done = ctx.state.done || {};
    var head = h("div", "tk-head");
    root.appendChild(head);
    if (spec.intro) { var intro = h("div", "tk-intro"); rich(intro, spec.intro); root.appendChild(intro); }
    var list = h("ol", "tk-steps-live");
    root.appendChild(list);

    function count() { return Object.keys(done).filter(function (k) { return done[k]; }).length; }
    function firstOpen() { for (var i = 0; i < spec.steps.length; i += 1) if (!done[i]) return i; return -1; }
    function paintHead() {
      head.textContent = "";
      head.appendChild(progress(count(), spec.steps.length, count() + " of " + spec.steps.length + " steps done"));
      if (count()) head.appendChild(btn("Start over", "tk-link", function () { ctx.state.done = done = {}; draw(); ctx.save(); }));
    }
    function draw() {
      list.textContent = "";
      var current = firstOpen();
      paintHead();
      spec.steps.forEach(function (s, i) {
        var li = h("li", "tk-step" + (done[i] ? " tk-done" : "") + (i === current ? " tk-current" : ""));
        var mark = btn(done[i] ? "✓" : String(i + 1), "tk-step-mark", function () { if (done[i]) delete done[i]; else done[i] = true; draw(); ctx.save(); });
        mark.title = done[i] ? "Mark as not done" : "Mark as done";
        var main = h("div", "tk-step-main");
        var title = h("div", "tk-step-title");
        inline(title, s.title);
        if (s.due) title.appendChild(h("span", "tk-badge tk-info", s.due));
        var chip = citeChip(ctx, s.cite);
        if (chip) title.appendChild(chip);
        main.appendChild(title);
        if (s.detail) { var d = h("div", "tk-step-detail"); rich(d, s.detail); main.appendChild(d); }
        li.appendChild(mark);
        li.appendChild(main);
        list.appendChild(li);
      });
      if (current === -1) { var fin = h("li", "tk-banner tk-good", "Every step is done."); list.appendChild(fin); }
    }
    draw();
  }

  // ---- quiz --------------------------------------------------------------------------------------------------
  function quiz(root, spec, ctx) {
    var qs = spec.questions;
    var st = ctx.state;
    st.answers = Array.isArray(st.answers) ? st.answers.slice(0, qs.length) : [];
    st.index = Math.min(Number(st.index) || 0, qs.length);
    var box = h("div", "tk-quiz");
    root.appendChild(box);

    function score() { return qs.reduce(function (n, q, i) { return n + (st.answers[i] === q.answer ? 1 : 0); }, 0); }

    function draw() {
      box.textContent = "";
      if (st.index >= qs.length) return finish();
      var q = qs[st.index];
      var answered = typeof st.answers[st.index] === "number";
      box.appendChild(progress(st.index, qs.length, "Question " + (st.index + 1) + " of " + qs.length));
      var qt = h("div", "tk-question");
      inline(qt, q.q);
      box.appendChild(qt);
      var opts = h("div", "tk-options");
      q.options.forEach(function (o, i) {
        var b = btn("", "tk-option", function () {
          if (answered) return;
          st.answers[st.index] = i;
          ctx.save();
          draw();
        });
        b.appendChild(h("span", "tk-option-letter", String.fromCharCode(65 + i)));
        var t = h("span", "tk-option-text");
        inline(t, o);
        b.appendChild(t);
        if (answered) {
          b.disabled = true;
          if (i === q.answer) b.classList.add("tk-right");
          else if (i === st.answers[st.index]) b.classList.add("tk-wrong");
        }
        opts.appendChild(b);
      });
      box.appendChild(opts);
      if (answered) {
        var ok = st.answers[st.index] === q.answer;
        var fb = h("div", "tk-feedback " + (ok ? "tk-good" : "tk-bad"));
        fb.appendChild(h("strong", "", ok ? "Correct. " : "Not quite. "));
        if (q.why) { var w = h("span"); inline(w, q.why); fb.appendChild(w); }
        else if (!ok) { var r = h("span"); inline(r, "The answer is " + q.options[q.answer] + "."); fb.appendChild(r); }
        var chip = citeChip(ctx, q.cite);
        if (chip) fb.appendChild(chip);
        box.appendChild(fb);
        box.appendChild(btn(st.index + 1 < qs.length ? "Next question" : "See my score", "tk-primary", function () { st.index += 1; ctx.save(); draw(); }));
      }
    }

    function finish() {
      var s = score();
      var pct = Math.round(s / qs.length * 100);
      box.appendChild(h("div", "tk-score", s + " / " + qs.length));
      box.appendChild(h("div", "tk-score-text", pct >= 80 ? "Excellent." : pct >= 50 ? "Good effort. Review the ones you missed." : "Keep going: try again after a look at the sections cited."));
      var missed = qs.map(function (q, i) { return { q: q, i: i }; }).filter(function (x) { return st.answers[x.i] !== x.q.answer; });
      if (missed.length) {
        box.appendChild(h("h3", "tk-group-title", "To review"));
        missed.forEach(function (x) {
          var item = h("div", "tk-review");
          var qq = h("div", "tk-review-q"); inline(qq, x.q.q); item.appendChild(qq);
          var aa = h("div", "tk-review-a"); inline(aa, "Answer: " + x.q.options[x.q.answer]); item.appendChild(aa);
          var chip = citeChip(ctx, x.q.cite); if (chip) item.appendChild(chip);
          box.appendChild(item);
        });
      }
      box.appendChild(btn("Try again", "tk-primary", function () { st.answers = []; st.index = 0; ctx.save(); draw(); }));
    }
    draw();
  }

  // ---- flashcards --------------------------------------------------------------------------------------------
  function flashcards(root, spec, ctx) {
    var st = ctx.state;
    st.known = st.known || {};
    st.index = Math.min(Number(st.index) || 0, spec.cards.length - 1);
    var box = h("div", "tk-cards");
    root.appendChild(box);
    var flipped = false;

    function known() { return Object.keys(st.known).filter(function (k) { return st.known[k]; }).length; }
    function go(delta) { st.index = (st.index + delta + spec.cards.length) % spec.cards.length; flipped = false; ctx.save(); draw(); }

    function draw() {
      box.textContent = "";
      box.appendChild(progress(known(), spec.cards.length, "Known " + known() + " of " + spec.cards.length));
      var card = spec.cards[st.index];
      var face = btn("", "tk-card-face" + (flipped ? " tk-flipped" : ""), function () { flipped = !flipped; draw(); });
      face.setAttribute("aria-label", flipped ? "Answer. Press to see the question" : "Question. Press to see the answer");
      face.appendChild(h("span", "tk-card-side", flipped ? "Answer" : "Question " + (st.index + 1) + " of " + spec.cards.length));
      var t = h("span", "tk-card-text");
      rich(t, flipped ? card.back : card.front);
      face.appendChild(t);
      box.appendChild(face);
      if (flipped) { var chip = citeChip(ctx, card.cite); if (chip) box.appendChild(chip); }
      var row = h("div", "tk-card-controls");
      row.appendChild(btn("Previous", "tk-ghost", function () { go(-1); }));
      if (flipped) {
        row.appendChild(btn("Again", "tk-ghost", function () { delete st.known[st.index]; go(1); }));
        row.appendChild(btn("Got it", "tk-primary", function () { st.known[st.index] = true; go(1); }));
      } else {
        row.appendChild(btn("Show answer", "tk-primary", function () { flipped = true; draw(); }));
      }
      row.appendChild(btn("Next", "tk-ghost", function () { go(1); }));
      box.appendChild(row);
    }
    draw();
  }

  // ---- table ---------------------------------------------------------------------------------------------------
  function table(root, spec, ctx) {
    var st = ctx.state;
    var rows = spec.rows.slice();
    if (spec.caption) { var cap = h("div", "tk-intro"); inline(cap, spec.caption); root.appendChild(cap); }
    var tools = h("div", "tk-table-tools");
    var filter = h("input", "tk-filter");
    filter.type = "search";
    filter.placeholder = "Filter rows";
    filter.setAttribute("aria-label", "Filter rows");
    filter.value = st.filter || "";
    tools.appendChild(filter);
    var count = h("span", "tk-muted");
    tools.appendChild(count);
    root.appendChild(tools);
    var wrap = h("div", "tk-table-wrap");
    root.appendChild(wrap);

    var numeric = spec.columns.map(function (_c, i) { return rows.every(function (r) { return r[i] === "" || /^-?[\d.,]+%?$/.test(r[i].trim()); }); });
    function value(r, i) { return numeric[i] ? parseFloat(String(r[i]).replace(/,/g, "")) || 0 : String(r[i]).toLowerCase(); }

    function draw() {
      var q = (st.filter || "").toLowerCase();
      var shown = rows.filter(function (r) { return !q || r.some(function (c) { return c.toLowerCase().indexOf(q) >= 0; }); });
      if (typeof st.sort === "number") {
        shown.sort(function (a, b) { var x = value(a, st.sort), y = value(b, st.sort); return (x < y ? -1 : x > y ? 1 : 0) * (st.desc ? -1 : 1); });
      }
      count.textContent = shown.length + " of " + rows.length + " rows";
      wrap.textContent = "";
      var t = h("table", "tk-live-table");
      var thead = h("thead");
      var hr = h("tr");
      spec.columns.forEach(function (c, i) {
        var th = h("th");
        var b = btn(c + (st.sort === i ? (st.desc ? " ▾" : " ▴") : ""), "tk-th", function () {
          if (st.sort === i) st.desc = !st.desc; else { st.sort = i; st.desc = false; }
          ctx.save();
          draw();
        });
        b.title = "Sort by " + c;
        th.appendChild(b);
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      t.appendChild(thead);
      var tb = h("tbody");
      shown.forEach(function (r) {
        var tr = h("tr");
        r.forEach(function (cell, i) { var td = h("td", numeric[i] ? "tk-num" : ""); inline(td, cell); tr.appendChild(td); });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      wrap.appendChild(t);
      if (!shown.length) wrap.appendChild(h("p", "tk-muted", "No rows match."));
    }
    filter.addEventListener("input", function () { st.filter = filter.value; draw(); });
    draw();
  }

  // ---- chart ---------------------------------------------------------------------------------------------------
  function niceMax(max) {
    if (max <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(max)));
    var f = max / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }
  function fmt(n, unit) {
    var a = Math.abs(n);
    var s = a >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : a >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(Math.round(n * 100) / 100);
    return s + (unit || "");
  }

  // how wide the frame is, so drawings are made at a size that can be read there
  function avail() { return Math.max(260, (document.documentElement.clientWidth || window.innerWidth || 600) - 36); }

  function chart(root, spec) {
    if (spec.caption) { var cap = h("div", "tk-intro"); inline(cap, spec.caption); root.appendChild(cap); }
    var W = Math.max(300, Math.min(820, avail())), H = W < 480 ? 270 : 330, L = 46, R = 12, T = 14, B = 44;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, class: "tk-chart", role: "img", "aria-label": spec.caption || "Chart" });
    var all = [];
    spec.series.forEach(function (x) { x.values.forEach(function (v) { if (v !== null) all.push(v); }); });
    var color = function (i) { return "var(--tk-chart-" + ((i % 6) + 1) + ")"; };

    if (spec.kind === "pie") {
      var values = spec.series[0].values.map(function (v) { return Math.max(0, v || 0); });
      var total = values.reduce(function (a, b) { return a + b; }, 0) || 1;
      var cx = 130, cy = 130, r = 110, angle = -Math.PI / 2;
      s.setAttribute("viewBox", "0 0 260 260");
      s.setAttribute("width", 260);
      s.setAttribute("height", 260);
      values.forEach(function (v, i) {
        var a2 = angle + v / total * Math.PI * 2;
        var large = a2 - angle > Math.PI ? 1 : 0;
        var d = v / total >= 0.9999
          ? "M " + (cx - r) + " " + cy + " a " + r + " " + r + " 0 1 0 " + (2 * r) + " 0 a " + r + " " + r + " 0 1 0 " + (-2 * r) + " 0"
          : "M " + cx + " " + cy + " L " + (cx + r * Math.cos(angle)) + " " + (cy + r * Math.sin(angle)) + " A " + r + " " + r + " 0 " + large + " 1 " + (cx + r * Math.cos(a2)) + " " + (cy + r * Math.sin(a2)) + " Z";
        var slice = svg("path", { d: d, fill: color(i), class: "tk-slice" });
        slice.appendChild(svg("title", {}, spec.labels[i] + ": " + fmt(v, spec.unit) + " (" + Math.round(v / total * 100) + "%)"));
        s.appendChild(slice);
        angle = a2;
      });
      var pieBox = h("div", "tk-pie");
      pieBox.appendChild(s);
      var key = h("div", "tk-legend tk-legend-col");
      values.forEach(function (v, i) {
        var item = h("span", "tk-legend-item");
        var sw = h("i", "tk-swatch");
        sw.style.background = color(i);
        item.appendChild(sw);
        item.appendChild(document.createTextNode((spec.labels[i] || "") + " \u2014 " + fmt(v, spec.unit) + " (" + Math.round(v / total * 100) + "%)"));
        key.appendChild(item);
      });
      pieBox.appendChild(key);
      root.appendChild(pieBox);
      return;
    }

    var min = Math.min.apply(null, all.concat([0]));
    var max = niceMax(Math.max.apply(null, all.concat([0])));
    var range = (max - min) || 1;
    var plotW = W - L - R, plotH = H - T - B;
    var y = function (v) { return T + plotH - (v - min) / range * plotH; };
    for (var t = 0; t <= 4; t += 1) {
      var v = min + range * t / 4;
      s.appendChild(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "tk-grid" }));
      s.appendChild(svg("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "tk-axis-text" }, fmt(v, spec.unit)));
    }
    var n = spec.labels.length;
    var step = plotW / n;
    spec.labels.forEach(function (lab, i) {
      var label = lab.length > 12 ? lab.slice(0, 11) + "…" : lab;
      if (n > 14 && i % Math.ceil(n / 14)) return;
      s.appendChild(svg("text", { x: L + step * (i + 0.5), y: H - B + 18, "text-anchor": "middle", class: "tk-axis-text" }, label));
    });

    if (spec.kind === "line") {
      spec.series.forEach(function (ser, si) {
        var pts = [];
        ser.values.forEach(function (val, i) { if (val !== null) pts.push([L + step * (i + 0.5), y(val), val, i]); });
        s.appendChild(svg("polyline", { points: pts.map(function (p) { return p[0] + "," + p[1]; }).join(" "), fill: "none", stroke: color(si), "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        pts.forEach(function (p) {
          var dot = svg("circle", { cx: p[0], cy: p[1], r: 4, fill: color(si), class: "tk-dot" });
          dot.appendChild(svg("title", {}, ser.name + " — " + spec.labels[p[3]] + ": " + fmt(p[2], spec.unit)));
          s.appendChild(dot);
        });
      });
    } else {
      var group = spec.series.length;
      var bw = Math.min(46, step * 0.8 / group);
      spec.series.forEach(function (ser, si) {
        ser.values.forEach(function (val, i) {
          if (val === null) return;
          var x = L + step * (i + 0.5) - bw * group / 2 + si * bw;
          var top = y(Math.max(val, 0)), base = y(Math.min(0, Math.max(min, 0)));
          var rect = svg("rect", { x: x, y: Math.min(top, y(Math.min(val, 0))), width: Math.max(2, bw - 2), height: Math.max(1, Math.abs(y(val) - base)), rx: 3, fill: color(si), class: "tk-bar-rect" });
          rect.appendChild(svg("title", {}, ser.name + " — " + spec.labels[i] + ": " + fmt(val, spec.unit)));
          s.appendChild(rect);
        });
      });
    }
    root.appendChild(s);
    if (spec.series.length > 1) {
      var legend = h("div", "tk-legend");
      spec.series.forEach(function (ser, si) {
        var item = h("span", "tk-legend-item");
        var sw = h("i", "tk-swatch");
        sw.style.background = color(si);
        item.appendChild(sw);
        item.appendChild(document.createTextNode(ser.name));
        legend.appendChild(item);
      });
      root.appendChild(legend);
    }
  }

  // ---- diagram -------------------------------------------------------------------------------------------------
  function wrapLabel(text, per) {
    var words = text.split(/\s+/), lines = [], line = "";
    words.forEach(function (w) {
      if ((line + " " + w).trim().length > per && line) { lines.push(line); line = w; } else line = (line + " " + w).trim();
    });
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  function diagram(root, spec, ctx) {
    var nodes = spec.nodes.map(function (n) {
      var lines = wrapLabel(n.label, 22);
      var longest = lines.reduce(function (m, l) { return Math.max(m, l.length); }, 4);
      return { n: n, lines: lines, w: Math.max(80, Math.min(190, longest * 7.4 + 28)), h: 22 + lines.length * 17, x: 0, y: 0 };
    });
    var byId = {};
    nodes.forEach(function (x) { byId[x.n.id] = x; });

    function bounds() {
      var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      nodes.forEach(function (x) { b.minX = Math.min(b.minX, x.x - x.w / 2); b.maxX = Math.max(b.maxX, x.x + x.w / 2); b.minY = Math.min(b.minY, x.y - x.h / 2); b.maxY = Math.max(b.maxY, x.y + x.h / 2); });
      return b;
    }
    var direction = spec.direction;
    if (spec.kind === "mindmap") layoutMind(nodes, byId, spec); else layoutFlow(nodes, byId, spec, direction);
    var box = bounds();
    // a left-to-right flow that is wider than the room is laid out top to bottom when that fits better
    if (spec.kind !== "mindmap" && direction !== "TB" && box.maxX - box.minX > avail()) {
      layoutFlow(nodes, byId, spec, "TB");
      var tall = bounds();
      if (tall.maxX - tall.minX < box.maxX - box.minX) { direction = "TB"; box = tall; } else { layoutFlow(nodes, byId, spec, "LR"); box = bounds(); }
    }
    spec = Object.assign({}, spec, { direction: direction });
    var minX = box.minX, minY = box.minY, maxX = box.maxX, maxY = box.maxY;
    var pad = 24;
    var s = svg("svg", { viewBox: (minX - pad) + " " + (minY - pad) + " " + (maxX - minX + pad * 2) + " " + (maxY - minY + pad * 2), class: "tk-diagram", role: "img" });
    var natural = maxX - minX + pad * 2;
    s.style.maxWidth = Math.round(natural * 1.25) + "px";
    s.style.minWidth = Math.min(natural, 480) + "px"; // never shrunk until the writing is too small; the frame scrolls instead
    var defs = svg("defs");
    var marker = svg("marker", { id: "tk-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    marker.appendChild(svg("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "tk-arrow-head" }));
    defs.appendChild(marker);
    s.appendChild(defs);

    var groups = [];
    nodes.forEach(function (x) { if (x.n.group && groups.indexOf(x.n.group) < 0) groups.push(x.n.group); });
    var tone = function (x) { var gi = groups.indexOf(x.n.group); return gi < 0 ? 0 : (gi % 6) + 1; };

    var arrows = spec.kind !== "mindmap";
    spec.edges.forEach(function (e) {
      var a = byId[e.from], b = byId[e.to];
      if (!a || !b) return;
      var d;
      if (spec.kind === "mindmap") {
        var mx = (a.x + b.x) / 2;
        d = "M " + a.x + " " + a.y + " C " + mx + " " + a.y + " " + mx + " " + b.y + " " + b.x + " " + b.y;
      } else if (spec.direction === "TB") {
        var sx = a.x, sy = a.y + a.h / 2, ex = b.x, ey = b.y - b.h / 2, my = (sy + ey) / 2;
        d = "M " + sx + " " + sy + " C " + sx + " " + my + " " + ex + " " + my + " " + ex + " " + ey;
      } else {
        var x1 = a.x + a.w / 2, y1 = a.y, x2 = b.x - b.w / 2, y2 = b.y, mx2 = (x1 + x2) / 2;
        d = "M " + x1 + " " + y1 + " C " + mx2 + " " + y1 + " " + mx2 + " " + y2 + " " + x2 + " " + y2;
      }
      var path = svg("path", { d: d, class: "tk-edge", fill: "none" });
      if (arrows) path.setAttribute("marker-end", "url(#tk-arrow)");
      s.appendChild(path);
      if (e.label) {
        var lx = (a.x + b.x) / 2, ly = (a.y + b.y) / 2 - 5;
        var tx = svg("text", { x: lx, y: ly, "text-anchor": "middle", class: "tk-edge-label" }, e.label);
        s.appendChild(tx);
      }
    });

    var detail = h("div", "tk-diagram-detail");
    detail.hidden = true;
    nodes.forEach(function (x) {
      var g = svg("g", { class: "tk-node tk-tone-" + tone(x) + (x.n.detail ? " tk-clickable" : ""), tabindex: x.n.detail ? "0" : "-1" });
      g.appendChild(svg("rect", { x: x.x - x.w / 2, y: x.y - x.h / 2, width: x.w, height: x.h, rx: spec.kind === "mindmap" ? x.h / 2 : 10 }));
      x.lines.forEach(function (line, i) {
        g.appendChild(svg("text", { x: x.x, y: x.y - (x.lines.length - 1) * 8.5 + i * 17 + 4.5, "text-anchor": "middle" }, line));
      });
      if (x.n.detail) {
        var show = function () { detail.hidden = false; detail.textContent = ""; detail.appendChild(h("strong", "", x.n.label)); var p = h("div"); rich(p, x.n.detail); detail.appendChild(p); };
        g.addEventListener("click", show);
        g.addEventListener("keydown", function (e) { if (e.key === "Enter") show(); });
      }
      s.appendChild(g);
    });
    root.appendChild(s);
    if (nodes.some(function (x) { return x.n.detail; })) root.appendChild(h("p", "tk-muted", "Select a box to read more."));
    root.appendChild(detail);
    if (groups.length > 1) {
      var legend = h("div", "tk-legend");
      groups.forEach(function (gname, gi) {
        var item = h("span", "tk-legend-item");
        var sw = h("i", "tk-swatch");
        sw.style.background = "var(--tk-chart-" + ((gi % 6) + 1) + ")";
        item.appendChild(sw);
        item.appendChild(document.createTextNode(gname));
        legend.appendChild(item);
      });
      root.appendChild(legend);
    }
  }

  // layers by the longest path from a node with no incoming edges; cycles are cut where they come back
  function layoutFlow(nodes, byId, spec, dir) {
    var out = {}, incoming = {};
    nodes.forEach(function (x) { out[x.n.id] = []; incoming[x.n.id] = 0; });
    spec.edges.forEach(function (e) { if (out[e.from] && byId[e.to]) { out[e.from].push(e.to); incoming[e.to] += 1; } });
    var layer = {}, state = {};
    function visit(id, depth) {
      if (state[id] === 1) return; // back edge: ignore
      layer[id] = Math.max(layer[id] || 0, depth);
      if (state[id] === 2 && (layer[id] || 0) > depth) return;
      state[id] = 1;
      out[id].forEach(function (to) { visit(to, depth + 1); });
      state[id] = 2;
    }
    var roots = nodes.filter(function (x) { return !incoming[x.n.id]; });
    (roots.length ? roots : [nodes[0]]).forEach(function (x) { visit(x.n.id, 0); });
    nodes.forEach(function (x) { if (layer[x.n.id] === undefined) layer[x.n.id] = 0; });

    var columns = [];
    nodes.forEach(function (x) { (columns[layer[x.n.id]] = columns[layer[x.n.id]] || []).push(x); });
    var tb = (dir || spec.direction) === "TB";
    var gapMain = tb ? 70 : 90, gapCross = tb ? 30 : 22;
    var pos = 0;
    columns.forEach(function (col) {
      if (!col) return;
      var mainSize = col.reduce(function (m, x) { return Math.max(m, tb ? x.h : x.w); }, 0);
      var cross = col.reduce(function (sum, x) { return sum + (tb ? x.w : x.h) + gapCross; }, -gapCross);
      var cursor = -cross / 2;
      col.forEach(function (x) {
        var size = tb ? x.w : x.h;
        if (tb) { x.x = cursor + size / 2; x.y = pos + mainSize / 2; } else { x.x = pos + mainSize / 2; x.y = cursor + size / 2; }
        cursor += size + gapCross;
      });
      pos += mainSize + gapMain;
    });
  }

  function layoutMind(nodes, byId, spec) {
    var adj = {};
    nodes.forEach(function (x) { adj[x.n.id] = []; });
    spec.edges.forEach(function (e) { if (adj[e.from] && adj[e.to]) { adj[e.from].push(e.to); adj[e.to].push(e.from); } });
    var root = nodes[0].n.id, parent = {}, kids = {}, order = [root];
    parent[root] = null;
    for (var qi = 0; qi < order.length; qi += 1) {
      var id = order[qi];
      kids[id] = [];
      adj[id].forEach(function (to) { if (!(to in parent)) { parent[to] = id; kids[id].push(to); order.push(to); } });
    }
    nodes.forEach(function (x) { if (!(x.n.id in parent)) { parent[x.n.id] = root; kids[root].push(x.n.id); kids[x.n.id] = []; } });
    var leaves = {};
    (function count(id) { leaves[id] = kids[id].length ? kids[id].reduce(function (s, k) { return s + count(k); }, 0) : 1; return leaves[id]; })(root);
    byId[root].x = 0; byId[root].y = 0;
    (function place(id, a0, a1, depth) {
      var cursor = a0;
      kids[id].forEach(function (k) {
        var span = (a1 - a0) * leaves[k] / leaves[id];
        var mid = cursor + span / 2;
        var radius = depth * 190;
        byId[k].x = Math.cos(mid) * radius * 1.25;
        byId[k].y = Math.sin(mid) * radius * 0.85;
        place(k, cursor, cursor + span, depth + 1);
        cursor += span;
      });
    })(root, -Math.PI, Math.PI, 1);
  }

  // ---- timeline ------------------------------------------------------------------------------------------------
  function timeline(root, spec, ctx) {
    var list = h("ol", "tk-timeline-live");
    spec.events.forEach(function (e) {
      var li = h("li", "tk-moment");
      if (e.when) li.appendChild(h("div", "tk-when", e.when));
      var t = h("div", "tk-moment-title"); inline(t, e.title);
      var chip = citeChip(ctx, e.cite);
      if (chip) t.appendChild(chip);
      li.appendChild(t);
      if (e.detail) { var d = h("div", "tk-moment-detail"); rich(d, e.detail); li.appendChild(d); }
      list.appendChild(li);
    });
    root.appendChild(list);
  }

  // ---- document ------------------------------------------------------------------------------------------------
  function documentView(root, spec, ctx) {
    var doc = h("article", "tk-doc-live");
    spec.sections.forEach(function (s) {
      var sec = h("section", "tk-doc-section");
      if (s.heading) sec.appendChild(h("h3", "tk-doc-heading", s.heading));
      if (s.text) rich(sec, s.text);
      var chip = citeChip(ctx, s.cite);
      if (chip) sec.appendChild(chip);
      doc.appendChild(sec);
    });
    root.appendChild(doc);
  }

  var RENDERERS = { checklist: checklist, steps: steps, quiz: quiz, flashcards: flashcards, table: table, chart: chart, diagram: diagram, timeline: timeline, document: documentView };

  // Draws `spec` of kind `kind` into `root`. ctx: { state, save(), cites }
  function render(root, kind, spec, ctx) {
    root.textContent = "";
    if (!RENDERERS[kind]) { root.appendChild(h("p", "tk-muted", "This kind of artifact is not supported.")); return false; }
    ctx.state = ctx.state && typeof ctx.state === "object" ? ctx.state : {};
    var box = h("div", "tk-live tk-live-" + kind);
    root.appendChild(box);
    RENDERERS[kind](box, spec, ctx);
    return true;
  }

  // Maths in a page the model wrote as HTML: $...$ and $$...$$ in ordinary text, never inside code.
  function mathify(root) {
    if (!window.katex) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!/\$/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        for (var p = n.parentNode; p && p !== root; p = p.parentNode) if (/^(CODE|PRE|SCRIPT|STYLE)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      var frag = document.createDocumentFragment();
      inline(frag, n.nodeValue);
      // inline() also turns *x* into emphasis, which a page's text should not lose its asterisks to: keep only the maths
      if (frag.querySelector && !frag.querySelector(".tk-math")) return;
      n.parentNode.replaceChild(frag, n);
    });
  }

  window.TKComponents = { render: render, mathify: mathify, rich: rich, kinds: Object.keys(RENDERERS) };
})();
