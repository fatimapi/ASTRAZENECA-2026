// Appearance behavior with explicit DOM/storage stubs. No browser rendering is
// claimed here; the checks protect saved choices and in-progress form content.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'theme.js'), 'utf8');
const KEY = 'candex-theme';
let checks = 0;
const equal = (actual, expected, message) => { checks++; assert.equal(actual, expected, message); };
const check = (value, message) => { checks++; assert.ok(value, message); };

function fixture({stored, dark = false, blocked = false, dom = true, mediaAPI = 'modern', store = new Map()} = {}) {
  if (stored !== undefined) store.set(KEY, stored);
  const root = {attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }};
  const meta = {attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }};
  const checkbox = {id: 'dark-mode', checked: false};
  const controls = [0, 1].map(() => ({
    attributes: {}, label: {textContent: ''},
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector(selector) { assert.equal(selector, '[data-theme-label]'); return this.label; }
  }));
  const form = {value: 'Unsaved clinical review draft', checked: true};
  const documentListeners = {}, windowListeners = {}, mediaListeners = [], writes = [];
  let activeDOM = dom;
  const document = {
    documentElement: root, activeElement: form,
    querySelector(selector) {
      if (selector === 'meta[name="theme-color"]') return activeDOM ? meta : null;
      if (selector === '#dark-mode') return activeDOM ? checkbox : null;
      throw new Error('Unexpected element access: ' + selector);
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-theme-toggle]');
      return activeDOM ? controls : [];
    },
    addEventListener(event, callback) { (documentListeners[event] ||= []).push(callback); }
  };
  Object.defineProperty(document, 'body', {get() { throw new Error('Appearance must not rebuild the page or read form values.'); }});
  const media = {matches: dark};
  if (mediaAPI === 'modern') media.addEventListener = (event, callback) => { assert.equal(event, 'change'); mediaListeners.push(callback); };
  if (mediaAPI === 'legacy') media.addListener = callback => mediaListeners.push(callback);
  const window = {
    candexI18n: {lang: 'en'},
    matchMedia(query) {
      assert.equal(query, '(prefers-color-scheme: dark)');
      if (mediaAPI === 'missing') throw new Error('No matchMedia');
      return media;
    },
    addEventListener(event, callback) { (windowListeners[event] ||= []).push(callback); },
    render() { throw new Error('Appearance must not rerender the application.'); }
  };
  const localStorage = {
    getItem(key) { if (blocked) throw new Error('Storage unavailable'); return store.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('Storage unavailable'); writes.push([key, value]); store.set(key, value); }
  };
  vm.runInNewContext(source, {window, document, localStorage});
  function click(isToggle = true) {
    const event = {prevented: false, target: {closest: selector => { assert.equal(selector, '[data-theme-toggle]'); return isToggle ? controls[0] : null; }}, preventDefault() { this.prevented = true; }};
    for (const callback of documentListeners.click || []) callback(event);
    return event;
  }
  return {
    api: window.CandexTheme, root, meta, checkbox, controls, form, document, window, store, writes, click,
    mount() { activeDOM = true; },
    changeCheckbox(checked) { checkbox.checked = checked; for (const callback of documentListeners.change || []) callback({target: checkbox}); },
    system(next) { media.matches = next; for (const callback of mediaListeners) callback({matches: next}); },
    storage(value, key = KEY) {
      if (value === null) store.delete(key); else store.set(key, value);
      for (const callback of windowListeners.storage || []) callback({key, newValue: value});
    }
  };
}

for (const [stored, systemDark, expected] of [
  ['dark', false, 'dark'], ['light', true, 'light'],
  [undefined, false, 'light'], [undefined, true, 'dark'],
  ['unexpected', true, 'dark'], ['__proto__', false, 'light']
]) {
  const f = fixture({stored, dark: systemDark});
  equal(f.api.mode, expected, 'Valid saved choice overrides system; absent/invalid choice follows system');
  equal(f.root.attributes['data-theme'], expected, 'Initial HTML appearance is set before UI render');
  equal(f.meta.attributes.content, expected === 'dark' ? '#18121f' : '#674287', 'Browser theme colour follows appearance');
  equal(f.writes.length, 0, 'Reading initial appearance does not create an explicit user preference');
}

// It is safe to run from <head>, before body, controls or metadata are present.
{
  const f = fixture({dom: false, dark: true});
  equal(f.root.attributes['data-theme'], 'dark', 'Dark appearance is applied without a body');
  f.mount();
  check(f.api.button().includes('aria-pressed="true"'), 'Newly rendered controls reflect the initial dark mode');
  f.api.setTheme('light');
  equal(f.meta.attributes.content, '#674287', 'Controls mounted later can receive subsequent appearance changes');
}

// Button and accessibility controls stay in sync without destroying active work.
{
  const f = fixture();
  const focused = f.document.activeElement;
  const event = f.click();
  check(event.prevented, 'Appearance button prevents a default form action');
  equal(f.api.mode, 'dark', 'A button click enables dark appearance');
  equal(f.store.get(KEY), 'dark', 'Button choice persists');
  equal(f.checkbox.checked, true, 'Accessibility checkbox reflects the header button');
  for (const control of f.controls) {
    equal(control.attributes['aria-pressed'], 'true', 'Every appearance button exposes the active state');
    equal(control.attributes['aria-label'], 'Dark mode', 'Toggle keeps a stable accessible label');
    equal(control.attributes.title, 'Switch to light mode', 'Tooltip explains the next action');
  }
  f.changeCheckbox(false);
  equal(f.api.mode, 'light', 'Accessibility checkbox can restore light appearance');
  equal(f.store.get(KEY), 'light', 'Accessibility choice persists');
  check(f.controls.every(c => c.attributes['aria-pressed'] === 'false'), 'Checkbox changes update every header button');
  equal(f.form.value, 'Unsaved clinical review draft', 'Changing appearance preserves draft text');
  equal(f.form.checked, true, 'Changing appearance preserves other form choices');
  equal(f.document.activeElement, focused, 'Changing appearance preserves focus');
  const unrelated = f.click(false);
  check(!unrelated.prevented && f.api.mode === 'light', 'Unrelated clicks do not toggle appearance');
  equal(fixture({store: f.store, dark: true}).api.mode, 'light', 'Reload restores an explicit light preference over a dark system');
  f.api.setTheme('invalid');
  equal(f.api.mode, 'light', 'Invalid theme names do not alter the active choice');
  check(f.writes.every(([key, value]) => key === KEY && ['light', 'dark'].includes(value)), 'Stored appearance contains only the theme, never form data');
  check(!/<input|password|email|token|credential/i.test(f.api.button()), 'Appearance control collects no credentials');
}

// Automatic changes follow the operating system until a user makes a choice.
{
  const f = fixture();
  f.system(true);
  equal(f.api.mode, 'dark', 'An unconfigured preference follows a system change');
  f.system(false);
  equal(f.api.mode, 'light', 'System appearance can switch in either direction');
  f.api.setTheme('dark');
  f.system(false);
  equal(f.api.mode, 'dark', 'System changes cannot override an explicit user choice');
  f.storage('light');
  equal(f.api.mode, 'light', 'A change in another tab updates appearance');
  f.system(true);
  equal(f.api.mode, 'light', 'Cross-tab explicit choice also overrides the system');
  f.storage(null);
  equal(f.api.mode, 'dark', 'Removing the preference returns to the current system appearance');
  f.system(false);
  equal(f.api.mode, 'light', 'System tracking resumes after clearing the preference');
  f.storage('dark', 'unrelated-key');
  equal(f.api.mode, 'light', 'Other storage events do not affect appearance');
  f.storage('invalid');
  equal(f.api.mode, 'light', 'Invalid cross-tab values fall back to system appearance');
}

{
  const f = fixture({blocked: true});
  f.api.toggle();
  equal(f.api.mode, 'dark', 'Blocked storage still permits a memory-only appearance choice');
  f.system(false);
  equal(f.api.mode, 'dark', 'Memory-only explicit choice is respected');
  f.changeCheckbox(false);
  equal(f.api.mode, 'light', 'Blocked storage permits switching back');
  const legacy = fixture({mediaAPI: 'legacy'});
  legacy.system(true);
  equal(legacy.api.mode, 'dark', 'Older media-query change listeners remain supported');
  equal(fixture({mediaAPI: 'missing'}).api.mode, 'light', 'Without system detection, the initial appearance remains usable');
}

{
  const f = fixture();
  f.window.candexI18n.lang = 'fi';
  check(f.api.button().includes('Tumma tila') && f.api.button().includes('Vaihda tummaan tilaan'), 'Fresh Finnish controls show the correct action');
  f.click();
  for (const control of f.controls) {
    equal(control.label.textContent, 'Tumma tila', 'Existing control labels update in Finnish');
    equal(control.attributes.title, 'Vaihda vaaleaan tilaan', 'Finnish tooltip follows the current state');
  }
  f.window.candexI18n.lang = 'en';
  check(f.api.button().includes('Switch to light mode'), 'A rerender in English uses the current state and language');
}

console.log(`PASS: ${checks} appearance checks (system/saved preferences, persistence, controls, form preservation, cross-tab changes, storage failures and Finnish labels).`);
