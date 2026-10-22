const fill = document.getElementById('progressFill');
const statusEl = document.getElementById('statusText');

// Honest, friendly messages: the real work (starting the local AI engine) has no measurable steps.
const messages = [
  'Sharpening pencils...',
  'Warming up the highlighter...',
  'Dusting off the bookshelf...',
  'Almost ready...'
];

function setProgress(pct, message) {
  fill.style.width = pct + '%';
  if (message) statusEl.textContent = message;
}

let progress = 6;
let messageIndex = 0;
setProgress(progress, messages[0]);

const timer = setInterval(() => {
  progress = Math.min(progress + (progress > 70 ? Math.random() * 1.5 : Math.random() * 6), 92);
  const index = Math.min(Math.floor((progress / 92) * messages.length), messages.length - 1);
  if (index !== messageIndex) messageIndex = index;
  setProgress(progress, messages[messageIndex]);
}, 450);

// Called by the main process when the backend is ready.
window.onBackendReady = () => {
  clearInterval(timer);
  setProgress(100, 'Ready.');
};
