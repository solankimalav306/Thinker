// Synchronous key-value bridge used by the renderer (window.electronAPI.getItem/setItem).
// Backed by the SQLite store; per-page annotation keys are routed by document hash there.
const { PROFILES_STORAGE_KEY, protectProfiles } = require('./secrets');

let store = null;

function initStorage(activeStore) {
  store = activeStore;
}

function getItemSync(event, key) {
  try {
    event.returnValue = store.getItem(key);
  } catch (error) {
    console.error('storage:getItem failed for', key, error);
    event.returnValue = null;
  }
}

function setItemSync(event, key, value) {
  try {
    if (key === PROFILES_STORAGE_KEY && typeof value === 'string') value = protectProfiles(value);
    store.setItem(key, value);
    event.returnValue = true;
  } catch (error) {
    console.error('storage:setItem failed for', key, error);
    event.returnValue = false;
  }
}

function removeItemSync(event, key) {
  try {
    store.removeItem(key);
    event.returnValue = true;
  } catch (error) {
    console.error('storage:removeItem failed for', key, error);
    event.returnValue = false;
  }
}

function getItemDirect(key) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

// Rewrites any plain-text keys saved by older versions into the encrypted store.
function migrateProfileSecrets() {
  const current = getItemDirect(PROFILES_STORAGE_KEY);
  if (typeof current !== 'string') return;
  const protectedValue = protectProfiles(current);
  if (protectedValue !== current) store.setItem(PROFILES_STORAGE_KEY, protectedValue);
}

module.exports = { initStorage, migrateProfileSecrets, getItemSync, setItemSync, removeItemSync, getItemDirect };
