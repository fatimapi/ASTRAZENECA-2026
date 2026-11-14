// Apply appearance before styles load. Theme changes preserve in-progress forms.
(() => {
  'use strict';
  const KEY = 'candex-theme';
  const valid = value => value === 'light' || value === 'dark';
  const FI = {'Dark mode':'Tumma tila','Switch to dark mode':'Vaihda tummaan tilaan','Switch to light mode':'Vaihda vaaleaan tilaan'};
  // Light by default, whatever the operating system uses; dark only when chosen.
  const DEFAULT = 'light';
  let preference = null;
  try { const saved = localStorage.getItem(KEY); if (valid(saved)) preference = saved; } catch {}
  let mode = preference || DEFAULT;
  const tr = value => window.candexI18n?.lang === 'fi' ? FI[value] || value : value;
  function sync() {
    const dark = mode === 'dark';
    document.documentElement.setAttribute('data-theme', mode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#18121f' : '#674287');
    for (const control of document.querySelectorAll('[data-theme-toggle]')) {
      control.setAttribute('aria-pressed', String(dark));
      control.setAttribute('aria-label', tr('Dark mode'));
      control.setAttribute('title', tr(dark ? 'Switch to light mode' : 'Switch to dark mode'));
      const label = control.querySelector('[data-theme-label]');
      if (label) label.textContent = tr('Dark mode');
    }
    const checkbox = document.querySelector('#dark-mode');
    if (checkbox) checkbox.checked = dark;
  }
  function setTheme(next) {
    if (!valid(next)) return;
    preference = mode = next;
    try { localStorage.setItem(KEY, next); } catch { /* Retain the in-memory choice. */ }
    sync();
  }
  function button() {
    const dark = mode === 'dark';
    return `<button type="button" class="theme-toggle" data-theme-toggle aria-pressed="${dark}" aria-label="${tr('Dark mode')}" title="${tr(dark ? 'Switch to light mode' : 'Switch to dark mode')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 13A9 9 0 0 1 11 3.3 9 9 0 1 0 20.7 13Z"/></svg><span data-theme-label>${tr('Dark mode')}</span></button>`;
  }
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-theme-toggle]')) { event.preventDefault(); setTheme(mode === 'dark' ? 'light' : 'dark'); }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'dark-mode') setTheme(event.target.checked ? 'dark' : 'light');
  });
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    preference = valid(event.newValue) ? event.newValue : null;
    mode = preference || DEFAULT; sync();
  });
  window.CandexTheme = Object.freeze({get mode() { return mode; }, setTheme, toggle: () => setTheme(mode === 'dark' ? 'light' : 'dark'), button});
  sync();
})();
