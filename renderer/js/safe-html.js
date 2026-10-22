// Single entry point for turning untrusted text (model output, PDF text, user notes)
// into HTML. Everything that reaches innerHTML from those sources goes through here.

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'link', 'meta'],
  FORBID_ATTR: ['style'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeHtml(html) {
  if (!window.DOMPurify) return escapeHtml(html);
  return window.DOMPurify.sanitize(String(html ?? ""), PURIFY_CONFIG);
}

export function renderMarkdown(text) {
  const source = String(text ?? "");
  const html = window.marked ? window.marked.parse(source) : escapeHtml(source).replace(/\n/g, "<br>");
  return sanitizeHtml(html);
}
