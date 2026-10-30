// Pure helpers for the chat list: grouping, searching and friendly times.

const DAY = 24 * 60 * 60 * 1000;

export function timeAgo(timestamp, now = Date.now()) {
  const diff = Math.max(0, now - timestamp);
  if (diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / 3600000)} h ago`;
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

function startOfDay(timestamp) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Pinned chats first, then Today / Yesterday / Earlier. Empty groups are dropped.
// The query matches the title and the last answer's preview, case-insensitively.
export function groupConversations(conversations, query = "", now = Date.now()) {
  const needle = String(query || "").trim().toLowerCase();
  const matches = conversations.filter((c) =>
    !needle || `${c.title} ${c.preview || ""}`.toLowerCase().includes(needle)
  );

  const today = startOfDay(now);
  const groups = [
    { label: "Pinned", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] }
  ];

  for (const conversation of matches) {
    if (conversation.pinned) groups[0].items.push(conversation);
    else if (conversation.updatedAt >= today) groups[1].items.push(conversation);
    else if (conversation.updatedAt >= today - DAY) groups[2].items.push(conversation);
    else groups[3].items.push(conversation);
  }

  const byRecent = (a, b) => b.updatedAt - a.updatedAt;
  groups.forEach((group) => group.items.sort(byRecent));
  return groups.filter((group) => group.items.length > 0);
}

export function messageCountLabel(count) {
  const n = Number(count) || 0;
  return n === 1 ? "1 message" : `${n} messages`;
}

// Turns what a model provider or the backend threw into one plain sentence, with the next step.
export function friendlyAgentError(raw) {
  const text = String(raw || "").trim();
  if (!text) return "The AI did not send an answer. Please try again.";
  if (/api key (not valid|could not be unlocked)|API_KEY_INVALID|\b(401|403)\b|permission.?denied|unauthori[sz]ed/i.test(text)) {
    return "The AI service rejected your key. Open Settings, check the key for this model, and try again.";
  }
  if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit|too many requests/i.test(text)) {
    return "You have hit the usage limit for this model. Wait a minute, or pick another model in the chat box.";
  }
  if (/\b404\b|NOT_FOUND|model.*(not found|does not exist|no longer)/i.test(text)) {
    return "This model is not available any more. Choose another model in Settings.";
  }
  if (/\b(500|502|503)\b|UNAVAILABLE|overloaded|high demand|internal error/i.test(text)) {
    return "The AI service is busy right now. Please try again in a moment.";
  }
  if (/\b504\b|DEADLINE_EXCEEDED|timed? ?out|took too long|ECONNABORTED/i.test(text)) {
    return "The AI service took too long to answer. Please try again.";
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|network|offline|fetch failed/i.test(text)) {
    return "Thinker could not reach the AI service. Check your internet connection, or that your local model is running.";
  }
  return `The AI request failed: ${text.slice(0, 200)}`;
}

// Splits an answer into text and citation parts: "[Handbook, page 3; Notes, page 1]" becomes two citations.
export function splitCitations(text, docs) {
  const byTitle = (title) => {
    const wanted = title.trim().toLowerCase();
    return docs.find((d) => d.title.toLowerCase() === wanted) || docs.find((d) => d.title.toLowerCase().startsWith(wanted) || wanted.startsWith(d.title.toLowerCase()));
  };
  const parts = [];
  let last = 0;
  const group = /\[([^\[\]]*?\b(?:pages?|pp?\.)\s*\d+[^\[\]]*?)\]/gi;
  for (const match of text.matchAll(group)) {
    const cites = [];
    let ok = true;
    for (const piece of match[1].split(";")) {
      const m = /^\s*(.+?),\s*(?:pages?|pp?\.)\s*(\d+)/i.exec(piece);
      const doc = m ? byTitle(m[1]) : null;
      if (!doc) { ok = false; break; }
      cites.push({ doc, page: Number(m[2]), label: `${doc.title}, p. ${m[2]}` });
    }
    if (!ok) continue; // not one of ours (for example "[Page 3]"): leave it as plain text
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    cites.forEach((c) => parts.push({ cite: c }));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
