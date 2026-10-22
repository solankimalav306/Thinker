const MAX_GRAPH_POINTS = 20;

// Chart colours come from the active theme so they stay readable in light and dark.
function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function palette() {
  return {
    context: cssVar("--accent", "#4f46e5"),
    history: "#38bdf8",
    selected: cssVar("--primary-press", "#e8b400"),
    prompt: cssVar("--accent", "#4f46e5"),
    response: cssVar("--primary", "#ffd23f"),
    bg: cssVar("--sunken", "rgba(128,128,128,0.15)"),
    label: cssVar("--text-2", "#888"),
    value: cssVar("--text", "#222")
  };
}

function formatNum(n) {
  const val = Number(n) || 0;
  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
  return String(val);
}

export async function recordTokenUsage({ profileId, profileLabel, usage, pdfId }) {
  if (!usage || !window.electronAPI?.appendTokenUsage) return;

  const entry = {
    profileId: profileId || "default",
    profileLabel: profileLabel || "Unknown",
    prompt_tokens: usage.prompt_tokens || 0,
    response_tokens: usage.response_tokens || 0,
    total_tokens: usage.total_tokens || 0,
    breakdown: usage.breakdown || {},
    pdfId: pdfId || "",
  };

  await window.electronAPI.appendTokenUsage(entry);
}

export async function getTokenHistory() {
  if (!window.electronAPI?.getTokenUsageHistory) return [];
  const rows = await window.electronAPI.getTokenUsageHistory();
  return Array.isArray(rows) ? rows : [];
}

export function filterHistoryByProfile(history, profileId) {
  if (!profileId || profileId === "all") return history;
  return history.filter((row) => row.profileId === profileId);
}

export function aggregateStats(history) {
  return history.reduce(
    (acc, row) => {
      acc.prompt += row.prompt_tokens || 0;
      acc.response += row.response_tokens || 0;
      acc.total += row.total_tokens || 0;
      acc.requests += 1;
      acc.breakdown.context += row.breakdown?.context || 0;
      acc.breakdown.history += row.breakdown?.history || 0;
      acc.breakdown.selected_text += row.breakdown?.selected_text || 0;
      acc.breakdown.prompt += row.breakdown?.prompt || 0;
      return acc;
    },
    {
      prompt: 0,
      response: 0,
      total: 0,
      requests: 0,
      breakdown: { context: 0, history: 0, selected_text: 0, prompt: 0 },
    }
  );
}
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  
  // Set display size
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  
  // Set actual internal resolution
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

export function renderTokenDashboard(elements, history, profileId = "all") {
  const filtered = filterHistoryByProfile(history, profileId);
  const stats = aggregateStats(filtered);
  const last = filtered[filtered.length - 1];

  const emptyEl = elements.tokenUsageEmpty;
  const statsEl = elements.tokenUsageStats;
  if (!emptyEl || !statsEl) return;

  if (elements.usageSummary) {
    elements.usageSummary.textContent = filtered.length === 0
      ? "Nothing yet"
      : `${formatNum(stats.total)} tokens \u00b7 ${stats.requests} ${stats.requests === 1 ? "question" : "questions"}`;
  }

  if (filtered.length === 0) {
    emptyEl.style.display = "";
    statsEl.style.display = "none";
    return;
  }

  emptyEl.style.display = "none";
  statsEl.style.display = "flex";

  if (elements.statPromptTokens) elements.statPromptTokens.textContent = formatNum(stats.prompt);
  if (elements.statResponseTokens) elements.statResponseTokens.textContent = formatNum(stats.response);
  if (elements.statTotalTokens) elements.statTotalTokens.textContent = formatNum(stats.total);
  if (elements.statTotalRequests) elements.statTotalRequests.textContent = String(stats.requests);
  if (elements.statLastTokens) {
    elements.statLastTokens.textContent = last
      ? `${formatNum(last.prompt_tokens)} in / ${formatNum(last.response_tokens)} out`
      : "-";
  }

  const promptPct = stats.total > 0 ? (stats.prompt / stats.total) * 100 : 50;
  const responsePct = stats.total > 0 ? (stats.response / stats.total) * 100 : 50;
  if (elements.barPrompt) elements.barPrompt.style.width = `${promptPct}%`;
  if (elements.barResponse) elements.barResponse.style.width = `${responsePct}%`;

  renderBreakdownChart(elements.tokenBreakdownChart, stats.breakdown);
  renderUsageGraph(elements.tokenUsageGraph, filtered.slice(-MAX_GRAPH_POINTS));
}

function renderBreakdownChart(canvas, breakdown) {
  if (!canvas) return;
  const colors = palette();
  const ctx = setupCanvas(canvas);
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;

  const items = [
    { label: "Context", value: breakdown.context, color: colors.context },
    { label: "History", value: breakdown.history, color: colors.history },
    { label: "Selected", value: breakdown.selected_text, color: colors.selected },
    { label: "Prompt", value: breakdown.prompt, color: colors.prompt },
  ];

  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const barHeight = 8;
  const rowGap = 18;
  let y = 5;

  items.forEach((item) => {
    // 1. Draw Label
    ctx.font = "500 11px 'Figtree Variable', sans-serif";
    ctx.fillStyle = colors.label;
    ctx.textAlign = "left";
    ctx.fillText(item.label, 0, y + 8);

    // 2. Draw Value
    ctx.textAlign = "right";
    ctx.fillStyle = colors.value;
    ctx.fillText(formatNum(item.value), w, y + 8);

    // 3. Draw Progress Track
    const barY = y + 14;
    const barWidth = w;
    ctx.fillStyle = colors.bg;
    roundRect(ctx, 0, barY, barWidth, barHeight, 4, true);

    // 4. Draw Progress Fill
    const fillWidth = Math.max(4, (item.value / total) * barWidth);
    ctx.fillStyle = item.color;
    roundRect(ctx, 0, barY, fillWidth, barHeight, 4, true);

    y += barHeight + rowGap;
  });
}

function renderUsageGraph(canvas, points) {
  if (!canvas) return;
  const colors = palette();
  const ctx = setupCanvas(canvas);
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;

  if (!points.length) return;

  const maxVal = Math.max(...points.map((p) => p.total_tokens || 1), 1);
  const padding = 2;
  const barGap = 6;
  const barW = (w - (barGap * (points.length - 1))) / points.length;

  points.forEach((point, i) => {
    const promptRatio = point.prompt_tokens / maxVal;
    const respRatio = point.response_tokens / maxVal;
    
    const x = i * (barW + barGap);
    const availableH = h - 10;
    
    const pHeight = promptRatio * availableH;
    const rHeight = respRatio * availableH;

    // Background track (optional, for "hollow" look)
    ctx.fillStyle = colors.bg;
    roundRect(ctx, x, 0, barW, h, 3, true);

    // Response (Bottom part)
    ctx.fillStyle = colors.response;
    roundRect(ctx, x, h - rHeight, barW, rHeight, 3, true);

    // Prompt (Top part)
    ctx.fillStyle = colors.prompt;
    roundRect(ctx, x, h - rHeight - pHeight - 2, barW, pHeight, 3, true);
  });
}
function roundRect(ctx, x, y, width, height, radius, fill) {
  if (width < 0) width = 0;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
}

export function updateTokenTracker(trackerEl, usage) {
  if (!trackerEl || !usage) return;
  const total = usage.total_tokens || 0;
  const prompt = usage.prompt_tokens || 0;
  const response = usage.response_tokens || 0;
  trackerEl.textContent = `Tokens: ${formatNum(total)} (${formatNum(prompt)} in, ${formatNum(response)} out)`;
  trackerEl.title = `Last request — Prompt: ${prompt}, Response: ${response}`;
}

export async function refreshTokenDashboard(elements, profileId = "all") {
  const history = await getTokenHistory();
  renderTokenDashboard(elements, history, profileId);
  return history;
}
