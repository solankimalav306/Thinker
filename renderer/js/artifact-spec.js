// What an interactive artifact is made of. The model does not write a page for these: it describes the content as small data
// (a list of tasks, the questions of a quiz, the nodes of a diagram) and Thinker's own code draws and runs it. That is cheaper
// to produce, always looks the same, can be checked before it is shown, and needs no code from the model.
//
// This file is a plain script so that the sandboxed frame, the app and the tests can all use it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TKSpec = factory();
})(globalThis, function () {
  "use strict";

  // The small list of kinds. "live" kinds are drawn from data; "html" kinds are written as a page.
  var TYPES = {
    checklist: { label: "Checklist", icon: "fa-list-check", live: true, hint: "things to do, with progress" },
    steps: { label: "Steps", icon: "fa-shoe-prints", live: true, hint: "a plan or guide to follow, one step at a time" },
    quiz: { label: "Quiz", icon: "fa-circle-question", live: true, hint: "questions with answers and a score" },
    flashcards: { label: "Flashcards", icon: "fa-clone", live: true, hint: "cards to flip and review" },
    table: { label: "Table", icon: "fa-table", live: true, hint: "rows and columns, sortable" },
    chart: { label: "Chart", icon: "fa-chart-simple", live: true, hint: "bar, line or pie chart" },
    diagram: { label: "Diagram", icon: "fa-diagram-project", live: true, hint: "flowchart or mind map" },
    timeline: { label: "Timeline", icon: "fa-timeline", live: true, hint: "events in order" },
    document: { label: "Document", icon: "fa-file-lines", live: true, hint: "a written report or summary" },
    slides: { label: "Slides", icon: "fa-display", live: false, hint: "a slide deck" },
    page: { label: "Web page", icon: "fa-globe", live: false, hint: "any page: a calculator, a game, anything else" }
  };

  var LIMITS = { title: 160, text: 1200, longText: 6000, cite: 200, items: 80, options: 6, columns: 12, rows: 200, series: 6, labels: 60, nodes: 60, edges: 120 };

  function str(v, max) {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return "";
    return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max || LIMITS.text);
  }
  function cite(v) {
    var c = str(v, LIMITS.cite);
    return /\|\s*\d+\s*$/.test(c) ? c : "";
  }
  function arr(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function id(v, fallback) { var s = str(v, 40).replace(/[^\w.-]/g, ""); return s || fallback; }

  // Each cleaner takes whatever the model wrote and returns the clean version, or null when nothing usable is left.
  var CLEAN = {
    checklist: function (raw) {
      var groups = [];
      var source = Array.isArray(raw.groups) ? raw.groups : [{ title: "", items: raw.items }];
      source.slice(0, 12).forEach(function (g) {
        var items = arr(g && g.items, LIMITS.items).map(function (it) {
          if (typeof it === "string") it = { text: it };
          var text = str(it && (it.text || it.title || it.task), LIMITS.text);
          return text ? { text: text, note: str(it.note || it.detail, LIMITS.text), cite: cite(it.cite) } : null;
        }).filter(Boolean);
        if (items.length) groups.push({ title: str(g && g.title, LIMITS.title), items: items });
      });
      return groups.length ? { groups: groups } : null;
    },
    steps: function (raw) {
      var steps = arr(raw.steps || raw.items, LIMITS.items).map(function (s) {
        if (typeof s === "string") s = { title: s };
        var title = str(s && (s.title || s.text || s.name), LIMITS.title);
        return title ? { title: title, detail: str(s.detail || s.description || s.body, LIMITS.longText), cite: cite(s.cite), due: str(s.due || s.when, 60) } : null;
      }).filter(Boolean);
      return steps.length ? { intro: str(raw.intro || raw.summary, LIMITS.text), steps: steps } : null;
    },
    quiz: function (raw) {
      var questions = arr(raw.questions || raw.items, 40).map(function (q) {
        var text = str(q && (q.q || q.question || q.text), LIMITS.text);
        var options = arr(q && q.options, LIMITS.options).map(function (o) { return str(o, 400); }).filter(Boolean);
        if (!text) return null;
        if (options.length < 2 && q && typeof q.answer === "boolean") options = ["True", "False"];
        if (options.length < 2) return null;
        var answer = q.answer;
        if (typeof answer === "boolean") answer = answer ? 0 : 1;
        answer = Math.round(Number(answer));
        if (!(answer >= 0 && answer < options.length)) return null;
        return { q: text, options: options, answer: answer, why: str(q.why || q.explanation, LIMITS.text), cite: cite(q.cite) };
      }).filter(Boolean);
      return questions.length ? { questions: questions } : null;
    },
    flashcards: function (raw) {
      var cards = arr(raw.cards || raw.items, 100).map(function (c) {
        var front = str(c && (c.front || c.q || c.term), LIMITS.text);
        var back = str(c && (c.back || c.a || c.definition || c.answer), LIMITS.longText);
        return front && back ? { front: front, back: back, cite: cite(c.cite) } : null;
      }).filter(Boolean);
      return cards.length ? { cards: cards } : null;
    },
    table: function (raw) {
      var columns = arr(raw.columns || raw.headers, LIMITS.columns).map(function (c) { return str(c, 120); });
      if (!columns.length || columns.every(function (c) { return !c; })) return null;
      var rows = arr(raw.rows, LIMITS.rows).map(function (r) {
        var cells = Array.isArray(r) ? r : (r && typeof r === "object" ? columns.map(function (c) { return r[c]; }) : []);
        return columns.map(function (_c, i) { return str(cells[i], 600); });
      }).filter(function (r) { return r.some(Boolean); });
      return rows.length ? { caption: str(raw.caption, LIMITS.text), columns: columns, rows: rows } : null;
    },
    chart: function (raw) {
      var labels = arr(raw.labels, LIMITS.labels).map(function (l) { return str(l, 60); });
      var series = arr(raw.series, LIMITS.series).map(function (s, i) {
        var values = arr(s && s.values, LIMITS.labels).map(num);
        return { name: str(s && s.name, 60) || ("Series " + (i + 1)), values: values };
      }).filter(function (s) { return s.values.some(function (v) { return v !== null; }); });
      if (!series.length) return null;
      if (!labels.length) labels = series[0].values.map(function (_v, i) { return String(i + 1); });
      var kind = ["bar", "line", "pie"].indexOf(raw.kind) >= 0 ? raw.kind : "bar";
      return { kind: kind, labels: labels, series: series, unit: str(raw.unit, 20), caption: str(raw.caption, LIMITS.text) };
    },
    diagram: function (raw) {
      var seen = {};
      var nodes = arr(raw.nodes, LIMITS.nodes).map(function (n, i) {
        if (typeof n === "string") n = { label: n };
        var label = str(n && (n.label || n.title || n.text), 120);
        var nodeId = id(n && n.id, "n" + (i + 1));
        if (!label || seen[nodeId]) return null;
        seen[nodeId] = true;
        return { id: nodeId, label: label, detail: str(n.detail || n.description, 400), group: str(n.group, 30) };
      }).filter(Boolean);
      if (nodes.length < 2) return null;
      var edges = arr(raw.edges || raw.links, LIMITS.edges).map(function (e) {
        var from = id(e && (e.from || e.source), "");
        var to = id(e && (e.to || e.target), "");
        return seen[from] && seen[to] && from !== to ? { from: from, to: to, label: str(e.label, 60) } : null;
      }).filter(Boolean);
      return { kind: raw.kind === "mindmap" ? "mindmap" : "flow", direction: raw.direction === "TB" ? "TB" : "LR", nodes: nodes, edges: edges };
    },
    timeline: function (raw) {
      var events = arr(raw.events || raw.items, LIMITS.items).map(function (e) {
        var title = str(e && (e.title || e.what || e.text), LIMITS.title);
        return title ? { when: str(e.when || e.date, 80), title: title, detail: str(e.detail || e.description, LIMITS.text), cite: cite(e.cite) } : null;
      }).filter(Boolean);
      return events.length ? { events: events } : null;
    },
    document: function (raw) {
      var sections = arr(raw.sections, 50).map(function (s) {
        if (typeof s === "string") s = { text: s };
        var text = str(s && (s.text || s.body), LIMITS.longText);
        var heading = str(s && s.heading, LIMITS.title);
        return text || heading ? { heading: heading, text: text, cite: cite(s.cite) } : null;
      }).filter(Boolean);
      return sections.length ? { sections: sections } : null;
    }
  };

  // Whether a kind is drawn from data (and so arrives as JSON) or written as a page.
  function isLive(type) { return Boolean(TYPES[type] && TYPES[type].live); }
  function isKnown(type) { return Boolean(TYPES[type]); }

  // text from the model -> { ok, spec } or { ok: false, error }. Accepts a fenced block or text around the JSON.
  function parse(type, text) {
    if (!isLive(type)) return { ok: false, error: "That kind is written as a page." };
    var body = String(text == null ? "" : text).trim();
    body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    var start = body.indexOf("{");
    var end = body.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, error: "No data found." };
    var raw;
    try { raw = JSON.parse(body.slice(start, end + 1)); } catch (e) { return { ok: false, error: "The data could not be read." }; }
    return validate(type, raw);
  }

  function validate(type, raw) {
    if (!isLive(type)) return { ok: false, error: "That kind is written as a page." };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "The data is not an object." };
    var spec = CLEAN[type](raw);
    return spec ? { ok: true, spec: spec } : { ok: false, error: "There was nothing usable in the data." };
  }

  // Every citation a spec carries, so the app can check them against the sources the answer was given.
  function citations(type, spec) {
    var found = [];
    function add(c) { if (c && found.indexOf(c) < 0) found.push(c); }
    if (!spec) return found;
    if (type === "checklist") spec.groups.forEach(function (g) { g.items.forEach(function (i) { add(i.cite); }); });
    else if (type === "steps") spec.steps.forEach(function (s) { add(s.cite); });
    else if (type === "quiz") spec.questions.forEach(function (q) { add(q.cite); });
    else if (type === "flashcards") spec.cards.forEach(function (c) { add(c.cite); });
    else if (type === "timeline") spec.events.forEach(function (e) { add(e.cite); });
    else if (type === "document") spec.sections.forEach(function (s) { add(s.cite); });
    return found;
  }

  return { TYPES: TYPES, LIMITS: LIMITS, isLive: isLive, isKnown: isKnown, parse: parse, validate: validate, citations: citations };
});
