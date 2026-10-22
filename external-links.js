// Only a short list of known HTTPS pages may be opened in the user's browser from the app.
// A compromised page or a hostile document must not be able to open arbitrary addresses.
const ALLOWED_HOSTS = new Set(['aistudio.google.com', 'ollama.com', 'openrouter.ai']);

function isAllowedExternalUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && ALLOWED_HOSTS.has(url.hostname);
}

module.exports = { isAllowedExternalUrl, ALLOWED_HOSTS };
