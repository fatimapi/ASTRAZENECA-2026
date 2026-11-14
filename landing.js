// Candex's public entry screen. Session handling belongs to app.js.
// This intentionally collects no email, password or patient information.
(() => {
  'use strict';

  const FI = {
    'Cancer care, connected': 'Syöpähoito, yhdessä',
    'A shared view of care, from a first concern to the next appointment. Built around patients, clinicians and the teams improving access across Finland.': 'Yhteinen näkymä hoitoon ensimmäisestä huolesta seuraavaan vastaanottoon. Suunniteltu potilaille, ammattilaisille ja tiimeille, jotka parantavat hoitoon pääsyä Suomessa.',
    'No patient left behind.': 'Yhtäkään potilasta ei jätetä jälkeen.',
    'About Candex': 'Tietoa Candexista',
    'An all-cancer vision. A lung-care pilot.': 'Visio kaikille syöpätyypeille. Keuhkosyövän hoidon pilotti.',
    'Demo sign-in': 'Demokirjautuminen',
    'Welcome to Candex': 'Tervetuloa Candexiin',
    'Choose your Dashboard to continue.': 'Valitse koontinäkymäsi jatkaaksesi.',
    'Choose your Dashboard': 'Valitse koontinäkymäsi',
    'Patient': 'Potilas',
    'Understand your care and see your next step.': 'Ymmärrä hoitoasi ja näe seuraava vaihe.',
    'Doctor': 'Lääkäri',
    'Review patient information, imaging and follow-up.': 'Tarkastele potilastietoja, kuvantamista ja jatkohoitoa.',
    'Quality Administrator': 'Laadun ylläpitäjä',
    'Explore care quality, regional gaps and actions.': 'Tutki hoidon laatua, alueellisia eroja ja toimenpiteitä.',
    'Enter demo Dashboard': 'Avaa demon koontinäkymä',
    'Demo access uses fictional records. This does not verify a patient or professional identity.': 'Demossa käytetään kuvitteellisia tietoja. Tämä ei varmista potilaan tai ammattilaisen henkilöllisyyttä.',
    'Language': 'Kieli',
    'Accessibility': 'Saavutettavuus',
    'Interactive demo · Fictional data': 'Interaktiivinen demo · Kuvitteelliset tiedot',
    'Candex home': 'Candexin etusivu',
    'Choose a role to continue.': 'Valitse rooli jatkaaksesi.',
    'Switch Dashboard': 'Vaihda koontinäkymää',
    'Leave demo': 'Poistu demosta',
    'Back to demo sign-in': 'Takaisin demokirjautumiseen',
    'Choose Patient, Doctor or Quality Administrator.': 'Valitse potilas, lääkäri tai laadun ylläpitäjä.',
    'Demo entry could not load. Refresh the page.': 'Demokirjautumista ei voitu ladata. Päivitä sivu.'
  };
  window.candexI18n?.extend?.(FI);

  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const roles = [
    {id: 'patient', icon: 'user', title: 'Patient', description: 'Understand your care and see your next step.'},
    {id: 'care', icon: 'doctor', title: 'Doctor', description: 'Review patient information, imaging and follow-up.'},
    {id: 'quality', icon: 'chart', title: 'Quality Administrator', description: 'Explore care quality, regional gaps and actions.'}
  ];

  function view({wordmark = 'candex.', icon = () => '', role = '', language = window.candexI18n?.lang || 'en', error = ''} = {}) {
    const tr = text => language === 'fi' ? FI[text] || window.candexI18n?.lookup?.(text) || text : text;
    const t = text => escape(tr(text));
    const selected = roles.some(item => item.id === role) ? role : '';
    return `<div class="entry-page">
      <header class="entry-header">
        <a class="entry-brand" href="#" aria-label="${t('Candex home')}">${wordmark}</a>
        <div class="entry-header-actions">
          ${window.CandexTheme?.button() || ''}
          <div class="entry-language" role="group" aria-label="${t('Language')}">
            <button type="button" data-entry-lang="en" lang="en" translate="no" aria-pressed="${language !== 'fi'}" title="English">EN</button>
            <button type="button" data-entry-lang="fi" lang="fi" translate="no" aria-pressed="${language === 'fi'}" title="Suomi">FI</button>
          </div>
          <button type="button" class="entry-access" data-entry-action="access">${icon('access')}<span>${t('Accessibility')}</span></button>
        </div>
      </header>
      <main class="entry-main" id="main">
        <section class="entry-story" aria-labelledby="page-title">
          <p class="entry-eyebrow">${t('Cancer care, connected')}</p>
          <h1 id="page-title" tabindex="-1">${t('No patient left behind.')}</h1>
          <p class="entry-intro">${t('A shared view of care, from a first concern to the next appointment. Built around patients, clinicians and the teams improving access across Finland.')}</p>
          <button type="button" class="entry-about-link" data-entry-action="about">${t('About Candex')}${icon('arrow')}</button>
          <div class="entry-purpose"><img src="ribbon-upright.svg" alt="" width="60" height="74"><p>${t('An all-cancer vision. A lung-care pilot.')}</p></div>
        </section>
        <section class="entry-signin" aria-labelledby="entry-signin-title">
          <p class="entry-eyebrow">${t('Demo sign-in')}</p>
          <h2 id="entry-signin-title">${t('Welcome to Candex')}</h2>
          <p class="entry-signin-intro">${t('Choose your Dashboard to continue.')}</p>
          <form id="candex-entry-form">
            <fieldset class="entry-roles">
              <legend class="sr-only">${t('Choose your Dashboard')}</legend>
              ${roles.map(item => `<label class="entry-role${item.id === selected ? ' is-selected' : ''}">
                <input type="radio" name="entry-role" id="entry-role-${item.id}" value="${item.id}" ${item.id === selected ? 'checked' : ''} required aria-labelledby="entry-role-${item.id}-title" aria-describedby="entry-role-${item.id}-description">
                <span class="entry-role-icon" aria-hidden="true">${icon(item.icon)}</span>
                <span class="entry-role-copy"><strong id="entry-role-${item.id}-title">${t(item.title)}</strong><span id="entry-role-${item.id}-description">${t(item.description)}</span></span>
              </label>`).join('')}
            </fieldset>
            <p class="entry-error" id="entry-error" role="alert" tabindex="-1" ${error ? '' : 'hidden'}>${t(error)}</p>
            <button class="entry-submit" type="submit">${t('Enter demo Dashboard')}${icon('arrow')}</button>
            <p class="entry-disclosure">${icon('info')}<span>${t('Demo access uses fictional records. This does not verify a patient or professional identity.')}</span></p>
          </form>
        </section>
      </main>
      <footer class="entry-footer"><span translate="no">© 2026 Candex</span><span>${t('Interactive demo · Fictional data')}</span></footer>
    </div>`;
  }

  window.CandexLanding = {view};
})();
