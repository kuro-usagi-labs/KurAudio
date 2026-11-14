/* Apply a validated saved appearance before the stylesheet's first paint. */
(() => {
  let choice = 'dark';
  try {
    const value = JSON.parse(localStorage.getItem('kuraudio.preferences.v1') || 'null');
    if (value && value.version === 1 && ['light', 'dark', 'system'].includes(value.appearance)) choice = value.appearance;
  } catch { /* Storage denial must never prevent the editor from starting. */ }
  const resolved = choice === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : choice;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
})();
