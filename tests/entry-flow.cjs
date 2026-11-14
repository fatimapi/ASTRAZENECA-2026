// Demo-entry routing checks. Explicit DOM/storage stubs do not claim browser
// execution or real authentication. These workspaces contain fictional data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const KEY = 'candex-demo-access-v1';
let checks = 0;
function check(value, message) { checks++; assert.ok(value, message); }
function equal(value, expected, message) { checks++; assert.equal(value, expected, message); }

function fixture({hash = '', saved, store = new Map(), blocked = false, withSession = true, withHistory = false, dicomLoader} = {}) {
  if (saved !== undefined) store.set(KEY, typeof saved === 'string' ? saved : JSON.stringify(saved));
  const documentListeners = {}, windowListeners = {}, nodes = new Map();
  const mounts = {map: 0, records: 0, referrals: 0, agentResets: 0};
  const timers = [];
  const historyCalls = [];
  let importRequests = 0;
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        innerHTML: '', textContent: '', value: '', dataset: {}, open: false, hidden: false,
        classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, on) { const next = on ?? !classes.has(x); next ? classes.add(x) : classes.delete(x); return next; }},
        focus() { this.focused = true; }, setAttribute(k, v) { this[k] = v; },
        showModal() { this.open = true; }, close() { this.open = false; }, click() {}
      });
    }
    return nodes.get(id);
  }
  const document = {
    querySelector(selector) {
      if (['#app', '#dialog', '#toast'].includes(selector)) return node(selector);
      if (selector.startsWith('#') && node('#app').innerHTML.includes(`id="${selector.slice(1)}"`)) return node(selector);
      return null;
    },
    querySelectorAll() { return []; },
    createElement() { return node('created'); },
    addEventListener(name, fn, options) { (documentListeners[name] ||= []).push({fn, capture: options === true || options?.capture === true}); },
    documentElement: node('html'), title: ''
  };
  let currentHash = hash;
  const location = {get hash() { return currentHash; }, set hash(value) { currentHash = value ? '#' + String(value).replace(/^#/, '') : ''; }};
  const sessionStorage = {
    getItem(key) { if (blocked) throw new Error('storage blocked'); return store.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('storage blocked'); store.set(key, String(value)); },
    removeItem(key) { if (blocked) throw new Error('storage blocked'); store.delete(key); }
  };
  const dictionary = {};
  let language = 'en';
  const i18n = {get lang() { return language; }, setLang(value) { language = value; }, extend(value) { Object.assign(dictionary, value); }, tr(value) { return language === 'fi' ? dictionary[value] || value : value; }, lookup: value => dictionary[value] || value};
  const window = {
    candexI18n: i18n, scrollTo() {},
    addEventListener(name, fn) { (windowListeners[name] ||= []).push(fn); },
    CandexRegionalMap: {mount() { mounts.map++; return () => {}; }},
    CandexPatientRecords: {mount() { mounts.records++; return () => {}; }},
    CandexReferrals: {mount() { mounts.referrals++; return () => {}; }},
    candexAgent: {resetSession() { mounts.agentResets++; }}
  };
  const FormData = class {
    constructor(form) { this.values = form.values || {}; }
    get(key) { return this.values[key] ?? null; }
    *[Symbol.iterator]() { yield* Object.entries(this.values); }
  };
  const context = vm.createContext({window, document, location, sessionStorage,
    ...(withHistory ? {history: {replaceState(state, title, url) { historyCalls.push(url); location.hash = url; }}} : {}),
    __testImportDicom() { importRequests++; return dicomLoader ? dicomLoader() : Promise.reject(new Error('Unexpected DICOM load in routing test')); },
    localStorage: {getItem() { return null; }, setItem() {}, removeItem() {}},
    FormData, Blob, URL: {createObjectURL() { return 'blob:test'; }, revokeObjectURL() {}},
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, console, Set, Map});
  if (withSession) vm.runInContext(read('entry-session.js'), context);
  vm.runInContext(read('landing.js'), context);
  // Only replace the platform module loader, so the real render revision and
  // role/entry guards run against a controllable delayed module response.
  const app = read('app.js').replace("import('./dicom.js')", '__testImportDicom()');
  vm.runInContext(app + `\nglobalThis.api={getRoute,render,enterDemo,leaveDemo,state,actions,
    get entryOpen(){return entryOpen},get entryRole(){return entryRole},get entryAbout(){return entryAbout}};`, context);
  function navigate(route) {
    location.hash = route;
    for (const fn of windowListeners.hashchange || []) fn();
  }
  function submit(role) {
    const event = {target: {id: 'candex-entry-form', values: role ? {'entry-role': role} : {}, closest() { return null; }},
      defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }};
    for (const listener of [...(documentListeners.submit || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      if (event.stopped) break;
      listener.fn(event);
    }
    return event;
  }
  return {api: context.api, access: window.CandexDemoAccess, node, document, window, location, store, mounts, navigate, submit, timers, historyCalls,
    get importRequests() { return importRequests; },
    html: () => node('#app').innerHTML};
}

// Fresh visits and deep links must reach entry before any feature mounts.
for (const hash of ['', '#welcome', '#care/dicom', '#care/patient-records', '#quality/analytics']) {
  const f = fixture({hash});
  check(f.api.entryOpen, `${hash || 'fresh URL'} stays at demo entry`);
  check(f.html().includes('id="candex-entry-form"'), `${hash || 'fresh URL'} renders entry form`);
  check(!f.html().includes('class="sidebar"'), `${hash || 'fresh URL'} does not render a workspace`);
  equal(f.mounts.map + f.mounts.records + f.mounts.referrals, 0, `${hash || 'fresh URL'} mounts no protected views`);
  equal(f.importRequests, 0, `${hash || 'fresh URL'} makes no DICOM import request`);
}

// Corrupt or unsupported stored roles cannot choose a workspace.
for (const saved of ['{broken', {version: 2, role: 'care'}, {version: 1, role: 'admin'}, {version: 1, role: '__proto__'}, {role: 'patient'}, null]) {
  const f = fixture({hash: '#care/overview', saved});
  equal(f.access.current(), null, 'Invalid stored session is rejected');
  check(f.api.entryOpen, 'Invalid stored session shows entry');
}

// A selected role enters its own overview and survives a same-tab refresh.
for (const role of ['patient', 'care', 'quality']) {
  const f = fixture();
  const event = f.submit(role);
  check(event.defaultPrevented && event.stopped, `${role} entry consumes submit before feature handlers`);
  equal(f.api.state.role, role, `${role} opens the selected role`);
  equal(f.api.state.view, 'overview', `${role} opens its overview`);
  check(!f.api.entryOpen && f.html().includes('class="sidebar"'), `${role} renders its workspace`);
  check(f.html().includes('data-action="leave-demo"') && f.html().includes('data-action="switch-workspace"'), `${role} offers leave/switch controls`);
  const stored = JSON.parse(f.store.get(KEY));
  equal(Object.keys(stored).sort().join(','), 'role,version', `${role} stores no identity or credentials`);
  const restored = fixture({hash: `#${role}/overview`, store: f.store});
  equal(restored.api.state.role, role, `${role} is restored within this tab`);
  check(!restored.api.entryOpen, `${role} refresh keeps the chosen workspace`);
  const detached = fixture({hash: `#${role}/overview`});
  check(detached.api.entryOpen, `${role} has no session in another storage context`);
}

// Returned session objects cannot mutate the stored choice by reference.
{
  const f = fixture(); f.api.enterDemo('patient');
  const copy = f.access.current(); copy.role = 'care';
  equal(f.access.current().role, 'patient', 'Mutating a session copy cannot change the selected role');
}

// A foreign role never silently opens. Restricted same-role views fall back.
{
  const f = fixture(); f.api.enterDemo('patient');
  f.navigate('#care/patient-records');
  check(f.api.entryOpen && !f.html().includes('id="patient-record-workspace"'), 'Patient-to-doctor URL asks for another demo selection');
  equal(f.access.current().role, 'patient', 'Foreign-role URL does not escalate the current session');
  equal(f.api.entryRole, 'care', 'Entry preselects the role requested by the link');
  equal(f.mounts.records, 0, 'Foreign-role entry mounts no record lookup');
  f.submit('care');
  equal(f.api.state.view, 'patient-records', 'Choosing the requested role resumes a permitted deep link');
  equal(f.mounts.records, 1, 'The lookup mounts once, only after Doctor selection');
}
for (const [role, view] of [['patient', 'patients'], ['patient', 'reports'], ['patient', 'agents'], ['quality', 'dicom'], ['quality', 'patient-records']]) {
  const f = fixture(); f.api.enterDemo(role); f.navigate(`#${role}/${view}`);
  equal(f.api.state.view, 'overview', `${role}/${view} falls back to the role overview`);
  equal(f.mounts.records, 0, `${role}/${view} does not mount doctor records`);
  check(!f.html().includes('id="dicom-workspace"'), `${role}/${view} does not open DICOM analysis`);
}

// Leaving/switching closes dialogs and makes browser-back routes hit entry.
for (const action of ['switch-workspace', 'leave-demo']) {
  const f = fixture(); f.api.enterDemo('care');
  f.api.state.health = {notes: 'Fictional handoff example'};
  f.node('#dialog').open = true;
  f.api.actions[action]();
  equal(f.access.current(), null, `${action} clears active access`);
  check(!f.store.has(KEY), `${action} removes tab selection`);
  check(f.api.entryOpen && !f.node('#dialog').open, `${action} returns to entry and closes dialogs`);
  equal(f.api.state.health.notes, 'Fictional handoff example', `${action} preserves shared fictional demo data`);
  check(f.mounts.agentResets > 0, `${action} clears clinical-agent session state`);
  f.navigate('#care/overview');
  check(f.api.entryOpen && !f.html().includes('class="sidebar"'), `${action} protects an old browser-history route`);
  f.navigate('#quality/analytics');
  check(f.api.entryOpen, `${action} protects another role's direct link`);
}

// Public About, skip links and failed modules do not grant demo access.
{
  const f = fixture({hash: '#about'});
  check(f.api.entryOpen && f.api.entryAbout, 'Public About is outside a workspace session');
  check(f.html().includes('class="entry-about"') && f.html().includes('Our services'), 'Public About renders the existing readable content');
  equal(f.access.current(), null, 'Public About creates no demo session');
  f.navigate('#welcome');
  check(f.html().includes('id="candex-entry-form"'), 'Public About can return to entry');
  f.api.enterDemo('care'); const before = f.html();
  f.navigate('#main');
  equal(f.api.state.role, 'care', 'Skip link does not change role');
  equal(f.html(), before, 'Skip link does not replace the current page');
}
{
  const f = fixture({withSession: false, hash: '#care/overview'});
  check(f.api.entryOpen, 'Missing session module fails closed at entry');
  check(!f.html().includes('class="sidebar"'), 'Missing session module exposes no workspace');
}

// Private browsing/storage restrictions still allow a temporary demo choice.
{
  const f = fixture({blocked: true});
  f.api.enterDemo('quality');
  check(!f.api.entryOpen && f.api.state.role === 'quality', 'Blocked storage allows memory-only selection');
  equal(f.store.size, 0, 'Memory-only choice is not written elsewhere');
  f.api.leaveDemo();
  check(f.api.entryOpen && f.access.current() === null, 'Blocked storage still allows Leave demo');
}

// No fake credential collection, clear demo disclosure and all three options.
{
  const f = fixture(), html = f.html();
  check(!/<input[^>]+(?:type="(?:email|password)"|name="(?:email|password)")/.test(html), 'Entry collects no email or password');
  check(html.includes('does not verify a patient or professional identity'), 'Entry discloses its demo identity limitation');
  equal((html.match(/type="radio" name="entry-role"/g) || []).length, 3, 'Entry offers exactly three role choices');
  check(html.includes('<fieldset') && html.includes('<legend'), 'Role choice has a labelled fieldset');
  check(html.includes('id="main"') && html.includes('id="page-title" tabindex="-1"'), 'Landing includes skip-link and heading focus targets');
  const event = f.submit('administrator');
  check(event.stopped && f.api.entryOpen, 'Invalid submitted role stays at entry');
  check(f.node('#entry-error').textContent.includes('Choose Patient'), 'Invalid role provides feedback');
  equal(f.access.current(), null, 'Invalid role does not create access');
  const fi = f.window.CandexLanding.view({language: 'fi'});
  check(fi.includes('Demokirjautuminen') && fi.includes('Laadun ylläpitäjä'), 'Landing has Finnish entry and role copy');
}

// Real browsers use history replacement rather than emitting two hash changes.
{
  const f = fixture({hash: '#care/patient-records', withHistory: true});
  f.submit('care');
  equal(f.historyCalls.join(','), '#care/patient-records', 'Entry replaces browser history with the requested workspace');
  equal(f.mounts.records, 1, 'History replacement mounts the selected workspace once');
  check(!f.api.entryOpen, 'History replacement enters the workspace synchronously');
  f.api.leaveDemo();
  equal(f.historyCalls.at(-1), '#welcome', 'Leave replaces the current history URL with entry');
  equal(f.location.hash, '#welcome', 'History replacement updates the visible URL');
  f.navigate('#care/patient-records');
  check(f.api.entryOpen, 'Old browser-history URL remains gated after history replacement');
}

(async () => {
  let resolveImport, mounted = 0, reset = 0;
  const pending = new Promise(resolve => { resolveImport = resolve; });
  const f = fixture({withHistory: true, dicomLoader: () => pending});
  f.api.enterDemo('care');
  f.navigate('#care/dicom');
  equal(f.importRequests, 1, 'Authorised Doctor opens a DICOM module request');
  check(f.html().includes('id="dicom-workspace"'), 'DICOM route has its mount target before leaving');
  f.api.leaveDemo();
  resolveImport({mountDicomPanel() { mounted++; return () => {}; }, resetDicomSession() { reset++; }});
  await pending;
  await Promise.resolve();
  equal(mounted, 0, 'Late DICOM import does not mount after Leave demo');
  equal(reset, 1, 'Late DICOM module clears any cached credentials after leaving');
  check(f.api.entryOpen && f.html().includes('id="candex-entry-form"'), 'Late module resolution cannot replace entry with a workspace');
  console.log(`PASS: ${checks} demo-entry checks (landing, role routes, session/history, leave/back, late imports, public About, storage restrictions and honest demo UI).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
