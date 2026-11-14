// Demo workspace selection only. This is not authentication or record authorisation.
// Keep just the selected fictional role in this browser tab, never credentials.
(() => {
  'use strict';
  const KEY = 'candex-demo-access-v1';
  const views = Object.freeze({
    patient: Object.freeze(['overview', 'health', 'pathway', 'records', 'messages', 'referrals', 'platform']),
    care: Object.freeze(['overview', 'patients', 'patient-records', 'scan', 'reports', 'referrals', 'cohort', 'analytics', 'agents', 'dicom', 'platform']),
    quality: Object.freeze(['overview', 'reports', 'analytics', 'agents', 'platform'])
  });
  const validRole = role => typeof role === 'string' && Object.hasOwn(views, role);
  let active = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved?.version === 1 && validRole(saved.role)) active = {version: 1, role: saved.role};
    else if (saved !== null) sessionStorage.removeItem(KEY);
  } catch { /* A blocked or unavailable store must not prevent the demo. */ }
  function enter(role) {
    if (!validRole(role)) throw new Error('Choose Patient, Doctor or Quality Administrator.');
    active = {version: 1, role};
    try { sessionStorage.setItem(KEY, JSON.stringify(active)); } catch { /* Memory-only session. */ }
    return {...active};
  }
  function leave() {
    active = null;
    try { sessionStorage.removeItem(KEY); } catch { /* Memory is already cleared. */ }
  }
  window.CandexDemoAccess = Object.freeze({
    current: () => active ? {...active} : null,
    enter, leave, validRole,
    allows: (role, view) => validRole(role) && views[role].includes(view)
  });
})();
