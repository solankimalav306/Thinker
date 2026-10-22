(function () {
  const params = new URLSearchParams(window.location.search);
  document.documentElement.setAttribute('data-theme', params.get('theme') === 'light' ? 'light' : 'dark');

  // A custom accent colour (hex) overrides the brand yellow for the progress bar.
  const accent = params.get('customAccent') || '';
  if (/^#[0-9a-f]{6}$/i.test(accent)) document.documentElement.style.setProperty('--primary', accent);
})();
