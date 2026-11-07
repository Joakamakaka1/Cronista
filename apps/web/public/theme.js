// Applies the player's light or dark choice before the first paint, so the page never flashes the
// other mode. A same-origin file, not an inline script, because the CSP allows only 'self'. The key
// and colours repeat src/theme/theme.ts, and a test there keeps them equal.
(function () {
  var theme = 'dark';
  try {
    if (localStorage.getItem('cronista:tema') === 'light') theme = 'light';
  } catch {
    // Storage can be blocked: the default stands.
  }
  document.documentElement.dataset.theme = theme;
  var bar = document.querySelector('meta[name="theme-color"]');
  if (bar !== null) bar.setAttribute('content', theme === 'light' ? '#efede8' : '#111014');
})();
