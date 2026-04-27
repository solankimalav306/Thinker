const { desktopCapturer, ipcRenderer } = require('electron');
const selection = document.getElementById('selection');

let isDragging = false;
let startX = 0, startY = 0;

window.addEventListener('mousedown', e => {
  // Start drag only on left mouse button
  if (e.button !== 0) return;

  isDragging = true;
  startX = e.clientX;
  startY = e.clientY;

  selection.style.left = startX + 'px';
  selection.style.top = startY + 'px';
  selection.style.width = '0px';
  selection.style.height = '0px';
  selection.style.display = 'block';
});

window.addEventListener('mousemove', e => {
  if (!isDragging) return;

  const currentX = e.clientX;
  const currentY = e.clientY;

  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  selection.style.width = width + 'px';
  selection.style.height = height + 'px';

  // Adjust top-left corner of selection div for dragging in any direction
  selection.style.left = Math.min(currentX, startX) + 'px';
  selection.style.top = Math.min(currentY, startY) + 'px';
});

window.addEventListener('mouseup', async e => {
  if (!isDragging) return;
  isDragging = false;

  const x = Math.min(e.clientX, startX);
  const y = Math.min(e.clientY, startY);
  const width = Math.abs(e.clientX - startX);
  const height = Math.abs(e.clientY - startY);

  selection.style.display = 'none';

  // Now capture the screen snippet using desktopCapturer
  const sources = await desktopCapturer.getSources({ types: ['screen'] });

  // For simplicity, take the first screen source (adjust if you want to handle multi-screen)
  const screenSource = sources[0];

  // Get the full screen image as a nativeImage
  const image = screenSource.thumbnail;

  // Create a canvas to crop the selected area
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Draw the cropped part
  ctx.drawImage(
    image.toBitmap ? image.toBitmap() : image, // fallback if toBitmap exists
    x * window.devicePixelRatio, // account for scaling
    y * window.devicePixelRatio,
    width * window.devicePixelRatio,
    height * window.devicePixelRatio,
    0,
    0,
    width,
    height
  );

  // Convert cropped image to data URL
  const croppedDataUrl = canvas.toDataURL();

  // Send the snip back to main process or wherever
  ipcRenderer.send('snip-complete', croppedDataUrl);

  // Close snipper window
  window.close();
});
