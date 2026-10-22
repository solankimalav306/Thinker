// API keys live here, encrypted with the OS credential store (Electron safeStorage).
// The renderer and the JSONL profile store only ever see "secret:<profileId>" placeholders;
// the main process swaps in the real key right before a request leaves the machine.
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILES_STORAGE_KEY = 'smartpdf.apiProfiles';
const PREFIX = 'secret:';

const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');

function canEncrypt() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(secretsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  fs.writeFileSync(secretsFile(), JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
}

function isPlaceholder(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

// Replaces real keys in a serialized profile list with placeholders, storing them encrypted.
function protectProfiles(serialized) {
  if (!canEncrypt()) return serialized;
  let profiles;
  try {
    profiles = JSON.parse(serialized);
  } catch {
    return serialized;
  }
  if (!Array.isArray(profiles)) return serialized;

  const store = readStore();
  const keep = new Set();
  for (const profile of profiles) {
    if (!profile || !profile.id) continue;
    const id = String(profile.id);
    if (profile.key && !isPlaceholder(profile.key)) {
      store[id] = safeStorage.encryptString(String(profile.key)).toString('base64');
      profile.key = PREFIX + id;
    }
    if (isPlaceholder(profile.key)) keep.add(id);
  }
  for (const id of Object.keys(store)) {
    if (!keep.has(id)) delete store[id];
  }
  writeStore(store);
  return JSON.stringify(profiles);
}

function revealSecret(placeholder) {
  if (!isPlaceholder(placeholder) || !canEncrypt()) return placeholder;
  const cipher = readStore()[placeholder.slice(PREFIX.length)];
  if (!cipher) return placeholder;
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
  } catch {
    return placeholder;
  }
}

// Deep-copies a request payload with every placeholder replaced by its real key.
function resolveSecrets(value) {
  if (typeof value === 'string') return revealSecret(value);
  if (Array.isArray(value)) return value.map(resolveSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveSecrets(v);
    return out;
  }
  return value;
}

// True if a key field still holds a placeholder after resolveSecrets, meaning the stored key could
// not be decrypted (for example the OS credential data was cleared or moved to another machine).
function hasUnresolvedSecret(value) {
  if (Array.isArray(value)) return value.some(hasUnresolvedSecret);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([name, v]) => ((name === 'key' || name === 'apiKey') && isPlaceholder(v)) || hasUnresolvedSecret(v)
    );
  }
  return false;
}

const KEY_UNLOCK_ERROR = 'Your saved API key could not be unlocked on this computer. Open Settings and enter it again.';

module.exports = { PROFILES_STORAGE_KEY, KEY_UNLOCK_ERROR, protectProfiles, resolveSecrets, hasUnresolvedSecret };
