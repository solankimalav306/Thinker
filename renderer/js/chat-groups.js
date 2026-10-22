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
