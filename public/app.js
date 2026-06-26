/* ================================================================
   JEWELLERY LIVE RATES — app.js  v3
   Config-driven platform.
   ─ Boot:    fetch /api/config → build entire UI → connect socket
   ─ Render:  socket rates:update → incremental DOM updates only
   ─ Socket architecture: unchanged from Reference (no polling)
   ================================================================ */

'use strict';

/* ── Global config & socket ─────────────────────────────────── */
let CFG    = null;   /* { site:{}, admin:{} } */
let socket = null;

/* ── Previous-state maps for change detection ───────────────── */
const prev = {
  future:         {},
  spot:           {},
  goldProducts:   {},
  silverProducts: {},
  karatBase:      null,
  goldCoinBase:   null,
  silverCoinBase: null,
};

/* ── Highlight linger store (3-second green/red) ─────────────── */
const highlights = {};

/* ── Latest rates snapshot — used by share-image generator ─────── */
let lastRatesData = null;

/* ── DOM refs — populated after buildUI() ───────────────────── */
let dom = {};

/* ================================================================
   BOOT SEQUENCE
   1. Fetch config   → applyTheme + buildUI
   2. Connect socket → renderAll on every rates:update
   ================================================================ */
(async function boot() {
  try {
    const res = await fetch('/api/config');
    CFG = await res.json();
  } catch (e) {
    console.error('[boot] Config fetch failed:', e);
    CFG = { site: {}, admin: {} };
  }

  applyTheme(CFG.site?.theme);
  buildUI(CFG);
  initSocket();
  if (CFG.admin?.features?.enablePWA !== false) registerSW();
})();

/* ================================================================
   THEME — inject CSS variables from site-config.json
   ================================================================ */
function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  if (theme.primaryColor) {
    root.style.setProperty('--brand',     theme.primaryColor);
    root.style.setProperty('--brand-mid', lighten(theme.primaryColor, 0.12));
    root.style.setProperty('--brand-bg',  lighten(theme.primaryColor, 0.96));
    document.getElementById('meta-theme-color')?.setAttribute('content', theme.primaryColor);
  }
  if (theme.accentColor) {
    root.style.setProperty('--gold',       theme.accentColor);
    root.style.setProperty('--gold-dark',  darken(theme.accentColor, 0.18));
    root.style.setProperty('--gold-shine', lighten(theme.accentColor, 0.18));
  }
}

/* Hex color helpers */
function hexRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? { r: parseInt(r[1],16), g: parseInt(r[2],16), b: parseInt(r[3],16) } : null;
}
function rgbHex(r, g, b) {
  return '#' + [r,g,b].map(v => Math.min(255,Math.max(0,Math.round(v))).toString(16).padStart(2,'0')).join('');
}
function lighten(hex, amt) {
  const c = hexRgb(hex); if (!c) return hex;
  return rgbHex(c.r+(255-c.r)*amt, c.g+(255-c.g)*amt, c.b+(255-c.b)*amt);
}
function darken(hex, amt) {
  const c = hexRgb(hex); if (!c) return hex;
  return rgbHex(c.r*(1-amt), c.g*(1-amt), c.b*(1-amt));
}

/* ================================================================
   UI BUILDER — called once after config is fetched
   ================================================================ */
function buildUI(cfg) {
  const site  = cfg.site  || {};
  const admin = cfg.admin || {};
  const biz   = site.business || {};
  const feat  = admin.features || {};
  const pages = admin.pages    || {};
  const secs  = admin.sections || {};

  /* ── Meta & title ── */
  const title = biz.name ? `${biz.name} – Live Rates` : 'Live Rates';
  document.title = title;
  q('meta-apple-title')?.setAttribute('content', biz.name || '');
  q('meta-description')?.setAttribute('content',
    `${biz.name || 'Jewellers'} – Live gold and silver bullion rates, updated instantly.`);

  /* ── Logo ── */
  const logo = q('header-logo');
  if (logo) { logo.src = biz.logo || '/Media/mahakali-logo.png'; logo.alt = biz.name || 'Jewellers'; }

  /* ── Favicon (dynamic from config) ── */
  if (biz.favicon) q('favicon-ico')?.setAttribute('href', biz.favicon);

  /* ── Marquee ── */
  /* ── Ticker bar (always shown, scroll text optional) ── */
  const track = q('ticker-track');
  const mt    = q('marquee-text');
  if (feat.showMarquee !== false && site.marquee?.enabled !== false) {
    const raw = site.marquee?.text || '';
    /* Duplicate text for seamless CSS animation loop */
    if (mt) mt.textContent = raw + '\u00a0\u00a0\u00a0\u2022\u00a0\u00a0\u00a0' + raw;
    if (track) track.style.display = '';
  }
  /* marquee-wrap is always visible (holds clock + status) */
  const mw = q('marquee-wrap');
  if (mw) mw.style.display = '';

  startLiveClock();

  /* ── Connection status visibility ── */
  if (feat.showConnectionStatus === false) q('status')?.style?.setProperty?.('display','none');
  if (feat.showLastUpdated      === false) q('lastUpdated')?.style?.setProperty?.('display','none');

  /* ── Determine enabled pages ── */
  const enabledPages = [];
  if (pages.gold   !== false) enabledPages.push('gold');
  if (pages.silver !== false) enabledPages.push('silver');
  if (pages.coins  !== false) enabledPages.push('coins');

  /* ── Build all parts ── */
  buildDesktopNav(enabledPages);
  buildBottomNav(enabledPages);
  buildPages(enabledPages, admin, site);
  buildContactBar(biz, site.footer);
  buildFooter(biz, site.footer, site.socials);

  /* ── Bind DOM refs after pages are in the DOM ── */
  dom = {
    clock:        q('live-clock'),
    status:       q('status'),
    marqueeWrap:  q('marquee-wrap'),
    tickerTrack:  q('ticker-track'),
    marqueeText:  q('marquee-text'),
    futureBox:         q('futureBox'),
    spotBox:           q('spotBox'),
    goldProductsBox:   q('goldProductsBox'),
    silverProductsBox: q('silverProductsBox'),
    goldCoinBox:       q('goldCoinBox'),
    silverCoinBox:     q('silverCoinBox'),
    slider:            q('rateSlider'),
  };

  /* ── Activate first page ── */
  if (enabledPages.length > 0) switchPage(enabledPages[0]);
  initSlider();
}

/* ================================================================
   NAV BUILDERS
   ================================================================ */
const ICONS = {
  gold:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="20" height="12" rx="2"/><path d="M6 9V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><line x1="2" y1="14" x2="22" y2="14"/></svg>`,
  silver: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  coins:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><line x1="9.68" y1="14.68" x2="11.41" y2="12.97"/></svg>`,
  phone:  `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.97-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 17z"/></svg>`,
  share:  `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
  whatsapp: `<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>`,
  instagram: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`,
  facebook: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>`,
  globe: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  options: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
};

const PAGE_META = {
  gold:   { label: 'Gold Rates',   bnav: 'Gold',   icon: ICONS.gold   },
  silver: { label: 'Silver Rates', bnav: 'Silver', icon: ICONS.silver },
  coins:  { label: 'Coin Rates',   bnav: 'Coins',  icon: ICONS.coins  },
};

function buildDesktopNav(pages) {
  const left = q('desktop-nav-left');
  const right = q('desktop-nav-right');

  if (left) {
    left.innerHTML = pages.map((id, i) => {
      const m = PAGE_META[id] || { label: id, icon: '' };
      return `<button class="dnav-btn${i===0?' active':''}" id="dnav-${id}"
        aria-pressed="${i===0}" onclick="switchPage('${id}')">
        <span class="dnav-icon">${m.icon}</span>${m.label}
      </button>`;
    }).join('');
  }

  if (right) {
    right.innerHTML = `
      <div class="dnav-actions">
        <button class="dnav-btn dnav-action" onclick="showCallModal()">
          <span class="dnav-icon">${ICONS.phone}</span>Call
        </button>
        <button class="dnav-btn dnav-action dnav-share" onclick="shareRates()">
          <span class="dnav-icon">${ICONS.whatsapp}</span>Share
        </button>
      </div>`;
  }
}

function buildBottomNav(pages) {
  const inner = q('bottom-nav-inner');
  if (!inner) return;
  let html = pages.map((id, i) => {
    const m = PAGE_META[id] || { label: id, bnav: id, icon: '' };
    return `<button class="bnav-btn${i===0?' active':''}" id="bnav-${id}"
      aria-label="${m.label}" onclick="switchPage('${id}')">
      <span class="bnav-icon">${m.icon}</span>
      <span class="bnav-label">${m.bnav}</span>
    </button>`;
  }).join('');

  html += `<button class="bnav-btn bnav-action" onclick="showOptionsMenu()">
      <span class="bnav-icon">${ICONS.options}</span>
      <span class="bnav-label">Menu</span>
    </button>`;

  inner.innerHTML = html;
}

/* ================================================================
   PAGE BUILDERS — HTML generated from admin-config.json
   ================================================================ */
function buildPages(pages, admin, site) {
  const root = q('pages-root');
  if (!root) return;

  const builders = {
    gold:   () => buildGoldPage(admin),
    silver: () => buildSilverPage(admin),
    coins:  () => buildCoinsPage(admin),
  };

  root.innerHTML = '';
  pages.forEach((id, i) => {
    const div = document.createElement('main');
    div.className = 'page' + (i > 0 ? ' hidden' : '');
    div.id = 'page-' + id;
    div.setAttribute('aria-label', PAGE_META[id]?.label || id);
    div.innerHTML = (builders[id] || (() => ''))();
    root.appendChild(div);
  });
}

/* ── Gold page ── */
function buildGoldPage(admin) {
  const secs = admin.sections  || {};
  const gr   = admin.goldRates || {};
  let h = `<h1 class="page-title">Gold Rates</h1>`;

  if (secs.karatRates !== false && gr.karats?.length) {
    const cards = gr.karats.map(k => `
      <div class="karat-card" id="karat-card-${kid(k.name)}">
        <div class="karat-label">${esc(k.name)}</div>
        <div class="karat-purity">${esc(k.purity || '').replace(/‰/g, '%')}</div>
        <div class="karat-price" id="kp-${kid(k.name)}">—</div>
        <div class="karat-unit">per 10g</div>
      </div>`).join('');

    h += `
    <section class="section" aria-label="Karat Rates">
      <div class="section-label">
        <span class="section-title">Karat Rates <span class="karat-wogst-badge">BEFORE GST</span></span>
        <span class="section-subtitle">Base: BEFORE GST &nbsp;·&nbsp; Sell</span>
      </div>
      <div class="karat-grid" id="karatGrid">${cards}</div>
    </section>`;
  }

  if (secs.goldProducts !== false) {
    h += `
    <section class="section" aria-label="Gold Products">
      <div class="section-label">
        <span class="section-title">Gold Products</span>
        <span class="live-pill"><span class="live-dot"></span>Live</span>
      </div>
      <article class="rate-card">
        <div class="table-wrap" id="goldProductsBox">
          <p class="empty-msg">Connecting to live feed…</p>
        </div>
      </article>
    </section>`;
  }

  const showF = secs.futureRates !== false;
  const showS = secs.spotRates   !== false;
  if (showF || showS) {
    const dotCount = [showF, showS].filter(Boolean).length;
    const dots = dotCount > 1
      ? `<div class="slider-dots" aria-hidden="true">
          <span class="dot active" data-index="0"></span>
          <span class="dot"        data-index="1"></span>
        </div>`
      : '';

    let cards = '';
    if (showF) cards += `
      <section class="slider-card" aria-label="Future Rates">
        <div class="card-header">
          <h2 class="card-title">Future Rates</h2>
          <span class="live-pill"><span class="live-dot"></span>Live</span>
        </div>
        <div class="table-wrap" id="futureBox"><p class="empty-msg">Connecting…</p></div>
      </section>`;
    if (showS) cards += `
      <section class="slider-card" aria-label="Spot Rates">
        <div class="card-header">
          <h2 class="card-title">Spot Rates</h2>
          <span class="live-pill"><span class="live-dot"></span>Live</span>
        </div>
        <div class="table-wrap" id="spotBox"><p class="empty-msg">Connecting…</p></div>
      </section>`;

    h += `
    <section class="section" aria-label="Market Rates">
      <div class="section-label">
        <span class="section-title">Market Rates</span>
        ${dots}
      </div>
      <div class="slider-track" id="rateSlider">${cards}</div>
    </section>`;
  }

  return h;
}

/* ── Silver page ── */
function buildSilverPage(admin) {
  const secs = admin.sections || {};
  let h = `<h1 class="page-title">Silver Rates</h1>`;

  if (secs.silverProducts !== false) {
    h += `
    <section class="section" aria-label="Silver Products">
      <div class="section-label">
        <span class="section-title">Silver Products</span>
        <span class="live-pill"><span class="live-dot"></span>Live</span>
      </div>
      <article class="rate-card">
        <div class="table-wrap" id="silverProductsBox">
          <p class="empty-msg">Connecting to live feed…</p>
        </div>
      </article>
    </section>`;
  }

  return h;
}

/* ── Coins page ── */
function buildCoinsPage(admin) {
  const gc = admin.goldCoins   || {};
  const sc = admin.silverCoins || {};
  const hasGold   = (gc.rows?.length  || 0) > 0;
  const hasSilver = (sc.rows?.length  || 0) > 0;

  let h = `<h1 class="page-title">Coin Rates</h1>`;
  if (!hasGold && !hasSilver) return h + '<p class="empty-msg">No coin rows configured in admin-config.json</p>';

  const tabs = [];
  if (hasGold)   tabs.push({ id: 'goldcoin',   label: 'Gold Coin',   icon: '⚜' });
  if (hasSilver) tabs.push({ id: 'silvercoin', label: 'Silver Coin', icon: '◈' });

  h += `<div class="coin-tabs" role="tablist" aria-label="Coin types">
    ${tabs.map((t, i) => `
      <button class="coin-tab${i===0?' active':''}" id="tab-${t.id}" role="tab"
        aria-selected="${i===0}" aria-controls="panel-${t.id}"
        onclick="switchCoinTab('${t.id}')">
        <span class="coin-tab-icon">${t.icon}</span> ${t.label}
      </button>`).join('')}
  </div>`;

  if (hasGold) {
    h += `
    <div class="coin-panel" id="panel-goldcoin" role="tabpanel" aria-labelledby="tab-goldcoin">
      <section class="section" aria-label="Gold Coin Rates">
        <div class="section-label">
          <span class="section-title">Gold Coin 999</span>
          <span class="live-pill"><span class="live-dot"></span>Live</span>
        </div>
        <article class="rate-card">
          <div class="table-wrap" id="goldCoinBox"><p class="empty-msg">Connecting…</p></div>
        </article>
        <p class="coin-note">Rates are inclusive of making charges and exclusive of packing charges.*</p>
      </section>
    </div>`;
  }

  if (hasSilver) {
    h += `
    <div class="coin-panel${hasGold ? ' hidden' : ''}" id="panel-silvercoin" role="tabpanel" aria-labelledby="tab-silvercoin">
      <section class="section" aria-label="Silver Coin Rates">
        <div class="section-label">
          <span class="section-title">Silver Coin 999</span>
          <span class="live-pill"><span class="live-dot"></span>Live</span>
        </div>
        <article class="rate-card">
          <div class="table-wrap" id="silverCoinBox"><p class="empty-msg">Connecting…</p></div>
        </article>
        <p class="coin-note">Rates are inclusive of making charges and exclusive of packing charges.*</p>
      </section>
    </div>`;
  }

  return h;
}

/* ================================================================
   CONTACT BAR
   ================================================================ */
function buildContactBar(biz, footerCfg) {
  const bar = q('contact-bar');
  if (bar) {
    bar.innerHTML = `
      <button class="bnav-btn" onclick="showCallModal()">
        <span class="bnav-icon">${ICONS.phone}</span>
        <span class="bnav-label">Call</span>
      </button>
      <button class="bnav-btn" onclick="shareRates()">
        <span class="bnav-icon">${ICONS.whatsapp}</span>
        <span class="bnav-label">Share</span>
      </button>`;
  }
}

function showCallModal() {
  // Logic to show call modal
}

/* ================================================================
   FOOTER
   ================================================================ */
function buildFooter(biz, footerCfg, socials) {
  const el = q('site-footer');
  if (!el) return;

  let html = `<p class="footer-copyright">${esc(footerCfg?.copyright || `\u00a9 ${biz?.name || 'Jewellers'}`)}</p>`;
  let contactsHtml = '';

  if (footerCfg?.showPhone !== false && biz?.phone) {
    contactsHtml += `<span class="footer-contact"><a href="tel:${String(biz.phone).replace(/\\s/g,'')}">${ICONS.phone} ${esc(biz.phone)}</a></span>`;
  }
  if (footerCfg?.showPhone !== false && biz?.phone2) {
    contactsHtml += `<span class="footer-contact"><a href="tel:${String(biz.phone2).replace(/\\s/g,'')}">${ICONS.phone} ${esc(biz.phone2)}</a></span>`;
  }
  if (footerCfg?.showWhatsapp !== false && biz?.whatsapp) {
    contactsHtml += `<span class="footer-contact"><a href="https://wa.me/${String(biz.whatsapp).replace(/[^0-9]/g,'')}">${ICONS.whatsapp} WhatsApp</a></span>`;
  }

  if (contactsHtml) {
    html += `<div class="footer-contacts-wrap">${contactsHtml}</div>`;
  }
  
  if (footerCfg?.showAddress !== false && biz?.address) {
    html += `<p class="footer-address">${esc(biz.address)}</p>`;
  }

  // Socials
  const socialsHtml = [];
  if (socials?.instagram) socialsHtml.push(`<a href="${esc(socials.instagram)}" target="_blank" aria-label="Instagram">${ICONS.instagram}</a>`);
  if (socials?.facebook)  socialsHtml.push(`<a href="${esc(socials.facebook)}"  target="_blank" aria-label="Facebook">${ICONS.facebook}</a>`);
  if (socials?.website)   socialsHtml.push(`<a href="${esc(socials.website)}"   target="_blank" aria-label="Website">${ICONS.globe}</a>`);
  
  if (socialsHtml.length > 0) {
    html += `<div class="footer-socials">${socialsHtml.join('')}</div>`;
  }

  // Developer Info
  if (footerCfg?.developer) {
    html += `
      <div class="footer-developer">
        ${footerCfg.developer.link ? `<a href="${esc(footerCfg.developer.link)}" target="_blank">${esc(footerCfg.developer.text)}</a>` : esc(footerCfg.developer.text)}
      </div>`;
  }

  el.innerHTML = html;
}

/* ================================================================
   SERVICE WORKER — auto-update: new SW activates & page reloads
   ================================================================ */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js').then(reg => {
    /* If an updated SW is found, skip waiting & reload */
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });

    /* When the new SW has taken control, reload once */
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });

    /* Also check for updates right now (catches the case where SW
       is already waiting from a previous navigation) */
    reg.update().catch(() => {});
  }).catch(() => {});
}

/* ================================================================
   UTILITIES
   ================================================================ */
function q(id) { return document.getElementById(id); }

function toNum(val) {
  if (val == null) return null;
  const n = Number(String(val).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function fmt(val) {
  const n = toNum(val);
  return n === null ? '—' : String(n);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function itemKey(row) {
  return String(row?.symbol || row?.name || '').toLowerCase();
}

function rowToPlain(row) {
  return {
    symbol: String(row?.symbol || '').toLowerCase(),
    name:   row?.name   || '',
    bid:    toNum(row?.bid),
    ask:    toNum(row?.ask),
    high:   toNum(row?.high),
    low:    toNum(row?.low),
  };
}

function symbolLabel(sym, fallback) {
  const s = String(sym || '').toLowerCase();
  const map = {
    gold:'Gold', silver:'Silver', goldnext:'Gold Next', silvernext:'Silver Next',
    xauusd:'XAU/USD', xagusd:'XAG/USD', inrspot:'INR Spot',
  };
  return map[s] || fallback || s.toUpperCase();
}

function kid(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '-');
}

/* ================================================================
   CHANGE DETECTION
   ================================================================ */
function dirClass(cur, prv, key) {
  const c = toNum(cur), p = toNum(prv);
  const now = Date.now();
  if (c !== null && p !== null) {
    if (c > p) highlights[key] = { dir: 'up',   expiresAt: now + 3000 };
    else if (c < p) highlights[key] = { dir: 'down', expiresAt: now + 3000 };
  }
  const h = highlights[key];
  return (h && now < h.expiresAt) ? h.dir : 'same';
}

/* ================================================================
   TABLE RENDERING
   ================================================================ */
function updateCell(el, current, previous, key, fixedClass = '') {
  if (!el) return;
  const chip = el.querySelector('.chip-val');
  if (!chip) return;
  const cf = fmt(current);
  if (chip.textContent !== cf) chip.textContent = cf;
  const nc = fixedClass ? `chip-val ${fixedClass}` : `chip-val ${dirClass(current, previous, key)}`;
  if (chip.className !== nc) chip.className = nc;
}

function buildTableHTML(rows, prevMap, colLabel) {
  const trs = rows.map(row => {
    const cur = rowToPlain(row);
    const prv = prevMap[itemKey(cur)] || {};
    const k   = itemKey(cur);
    return `<tr data-key="${k}">
      <td class="rowhead">${esc(symbolLabel(cur.symbol, cur.name))}</td>
      <td class="cell-bid"><span class="chip-val ${dirClass(cur.bid, prv.bid, k+'-bid')}">${fmt(cur.bid)}</span></td>
      <td class="cell-ask"><span class="chip-val ${dirClass(cur.ask, prv.ask, k+'-ask')}">${fmt(cur.ask)}</span></td>
      <td class="cell-high"><span class="chip-val always-green">${fmt(cur.high)}</span></td>
      <td class="cell-low"><span class="chip-val always-red">${fmt(cur.low)}</span></td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr><th>${esc(colLabel)}</th><th>Buy</th><th>Sell</th><th>High</th><th>Low</th></tr></thead>
    <tbody>${trs}</tbody>
  </table>`;
}

function renderTable(container, rows, prevMap, type) {
  if (!container) return;
  if (!rows?.length) {
    container.innerHTML = '<p class="empty-msg">No data yet.</p>';
    return;
  }

  const colLabel = type === 'mini' ? 'Product' : 'Symbol';
  const table    = container.querySelector('table');
  const tbody    = table?.querySelector('tbody');
  /* Exclude injected .apx-tr rows from the count to avoid spurious rebuilds */
  const trs      = tbody ? Array.from(tbody.querySelectorAll('tr:not(.apx-tr)')) : [];
  let rebuild    = !table || trs.length !== rows.length;

  if (!rebuild) {
    for (let i = 0; i < rows.length; i++) {
      if (trs[i].getAttribute('data-key') !== itemKey(rowToPlain(rows[i]))) { rebuild = true; break; }
    }
  }

  if (rebuild) {
    container.innerHTML = buildTableHTML(rows, prevMap, colLabel);
  } else {
    rows.forEach((row, i) => {
      const cur = rowToPlain(row);
      const prv = prevMap[itemKey(cur)] || {};
      const k   = itemKey(cur);
      const tr  = trs[i];
      updateCell(tr.querySelector('.cell-bid'),  cur.bid,  prv.bid,  k+'-bid');
      updateCell(tr.querySelector('.cell-ask'),  cur.ask,  prv.ask,  k+'-ask');
      updateCell(tr.querySelector('.cell-high'), cur.high, null, null, 'always-green');
      updateCell(tr.querySelector('.cell-low'),  cur.low,  null, null, 'always-red');
    });
  }
}

function updatePrevMap(rows) {
  const map = {};
  (rows || []).forEach(r => { const k = itemKey(r); if (k) map[k] = rowToPlain(r); });
  return map;
}

/* ================================================================
   APX TABLE ROW INJECTOR
   Appends (or updates) an APX W/O GST row at the bottom of a
   products table. Values go in Sell, High, Low columns; Buy = —.
   ================================================================ */
function renderApxTableRow(containerId, label, apxData) {
  const container = q(containerId);
  if (!container) return;
  const table = container.querySelector('table');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  const sell = apxData?.sell ?? null;
  const high = apxData?.high ?? null;
  const low  = apxData?.low  ?? null;
  const sellTxt = sell !== null ? String(sell) : '—';
  const highTxt = high !== null ? String(high) : '—';
  const lowTxt  = low  !== null ? String(low)  : '—';
  const rowId   = containerId + '-apx';

  let tr = document.getElementById(rowId);
  if (!tr) {
    tr = document.createElement('tr');
    tr.className = 'apx-tr';
    tr.id = rowId;
    tr.innerHTML = `
      <td class="rowhead apx-tr-name">${esc(label)}</td>
      <td class="cell-bid"><span class="chip-val">—</span></td>
      <td class="cell-ask"><span class="chip-val apx-chip" id="${rowId}-sell">${sellTxt}</span></td>
      <td class="cell-high"><span class="chip-val always-green" id="${rowId}-high">${highTxt}</span></td>
      <td class="cell-low"><span class="chip-val always-red" id="${rowId}-low">${lowTxt}</span></td>
    `;
    tbody.appendChild(tr);
  } else {
    const elSell = q(rowId + '-sell');
    const elHigh = q(rowId + '-high');
    const elLow  = q(rowId + '-low');
    if (elSell && elSell.textContent !== sellTxt) elSell.textContent = sellTxt;
    if (elHigh && elHigh.textContent !== highTxt) elHigh.textContent = highTxt;
    if (elLow  && elLow.textContent  !== lowTxt)  elLow.textContent  = lowTxt;
  }
}


/* ================================================================
   KARAT RENDERER
   ================================================================ */
function renderKaratRates(goldBase) {
  const base   = toNum(goldBase);
  const karats = CFG?.admin?.goldRates?.karats || [];

  karats.forEach(k => {
    const el = q(`kp-${kid(k.name)}`);
    if (!el) return;

    const price     = base !== null ? Math.round(base * k.multiplier) : null;
    const prevBase  = prev.karatBase;
    const prevPrice = prevBase !== null ? Math.round(prevBase * k.multiplier) : null;

    const text = price !== null ? price.toLocaleString('en-IN') : '—';
    if (el.textContent !== text) el.textContent = text;

    el.className = (price !== null && prevPrice !== null)
      ? price > prevPrice ? 'karat-price up' : price < prevPrice ? 'karat-price down' : 'karat-price'
      : 'karat-price';
  });

  prev.karatBase = base;
}

/* ================================================================
   COIN TABLE RENDERER  (per-gram premium)
   ================================================================ */
function renderCoinTable(containerId, configRows, baseVal, divisor, premiumPerGram, premiumPercent, prevKey) {
  const container = q(containerId);
  if (!container || !configRows?.length) return;

  const baseRaw   = toNum(baseVal);
  const base1u    = baseRaw !== null ? baseRaw / divisor : null;
  const pctFactor = 1 + (premiumPercent || 0) / 100;

  const table = container.querySelector('.coin-table');
  const tbody = table?.querySelector('tbody');

  if (!table || !tbody) {
    const rows = configRows.map((c, i) => {
      const price = base1u !== null
        ? Math.round((base1u * c.grams + premiumPerGram * c.grams) * pctFactor)
        : null;
      return `<tr data-coin="${esc(c.name)}">
        <td class="rowhead">${esc(c.name)}</td>
        <td><span class="coin-price" id="${containerId}-r${i}">${price !== null ? price.toLocaleString('en-IN') : '—'}</span></td>
      </tr>`;
    }).join('');

    container.innerHTML = `<table class="coin-table">
      <thead><tr><th>Product</th><th>Price (₹)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  } else {
    configRows.forEach((c, i) => {
      const el = q(`${containerId}-r${i}`);
      if (!el) return;

      const price    = base1u !== null
        ? Math.round((base1u * c.grams + premiumPerGram * c.grams) * pctFactor)
        : null;
      const prevBase = prev[prevKey];
      const prevU    = prevBase !== null ? prevBase / divisor : null;
      const prevP    = prevU   !== null
        ? Math.round((prevU * c.grams + premiumPerGram * c.grams) * pctFactor)
        : null;

      const text = price !== null ? price.toLocaleString('en-IN') : '—';
      if (el.textContent !== text) el.textContent = text;

      if (price !== null && prevP !== null) {
        el.className = price > prevP ? 'coin-price up' : price < prevP ? 'coin-price down' : 'coin-price';
      }
    });
  }

  prev[prevKey] = baseRaw;
}

/* ================================================================
   MASTER RENDER
   ================================================================ */
function renderAll(data) {
  if (!CFG) return;
  lastRatesData = data;
  const admin = CFG.admin || {};

  renderTable(dom.goldProductsBox,   data?.goldProducts,   prev.goldProducts,   'mini');
  renderApxTableRow('goldProductsBox',   'BEFORE GST',    data?.goldApxRow);

  renderTable(dom.silverProductsBox, data?.silverProducts, prev.silverProducts, 'mini');
  renderApxTableRow('silverProductsBox', 'BEFORE GST PETI', data?.silverApxRow);

  renderTable(dom.futureBox, data?.futureRows, prev.future, 'rate');
  renderTable(dom.spotBox,   data?.spotRows,   prev.spot,   'rate');

  renderKaratRates(data?.goldBase);

  const goldDiv   = admin.goldCoins?.divisor   || 10;
  const silverDiv = admin.silverCoins?.divisor || 1000;
  const goldPremiumPerGram    = admin.goldCoins?.premiumPerGram    ?? 100;
  const silverPremiumPerGram  = admin.silverCoins?.premiumPerGram  ?? 12;
  const goldPremiumPercent    = admin.goldCoins?.premiumPercent    ?? 0;
  const silverPremiumPercent  = admin.silverCoins?.premiumPercent  ?? 0;
  renderCoinTable('goldCoinBox',   admin.goldCoins?.rows,   data?.goldCoinBase,   goldDiv,   goldPremiumPerGram,   goldPremiumPercent,   'goldCoinBase');
  renderCoinTable('silverCoinBox', admin.silverCoins?.rows, data?.silverCoinBase, silverDiv, silverPremiumPerGram, silverPremiumPercent, 'silverCoinBase');



  prev.goldProducts   = updatePrevMap(data?.goldProducts);
  prev.silverProducts = updatePrevMap(data?.silverProducts);
  prev.future         = updatePrevMap(data?.futureRows);
  prev.spot           = updatePrevMap(data?.spotRows);

  const live = data?.connected?.gopnath || data?.connected?.swayam;
  setStatus(live ? 'live' : 'connecting');
}

/* ================================================================
   STATUS INDICATOR
   ================================================================ */
function setStatus(s) {
  if (!dom.status) return;
  dom.status.className = 'status-dot ' + s;
  dom.status.title     = s === 'live' ? 'Connected – live' : 'Connecting…';
}

/* ================================================================
   SOCKET
   ================================================================ */
function initSocket() {
  socket = io({
    transports:          ['websocket'],
    upgrade:             false,
    reconnectionDelay:    0,
    reconnectionDelayMax: 500,
  });
  socket.on('connect',       () => setStatus('live'));
  socket.on('disconnect',    () => setStatus('disconnected'));
  socket.on('connect_error', () => setStatus('disconnected'));
  socket.on('rates:update',  renderAll);
}

/* ================================================================
   PAGE NAVIGATION
   ================================================================ */
function switchPage(pageId) {
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('hidden', el.id !== 'page-' + pageId);
  });
  document.querySelectorAll('.dnav-btn').forEach(btn => {
    const on = btn.id === 'dnav-' + pageId;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on);
  });
  document.querySelectorAll('.bnav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'bnav-' + pageId);
  });
}

/* ================================================================
   COIN TAB SWITCHING
   ================================================================ */
function switchCoinTab(tabId) {
  document.querySelectorAll('.coin-panel').forEach(el => {
    el.classList.toggle('hidden', el.id !== 'panel-' + tabId);
  });
  document.querySelectorAll('.coin-tab').forEach(btn => {
    const on = btn.id === 'tab-' + tabId;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on);
  });
}

/* ================================================================
   SLIDER
   ================================================================ */
function initSlider() {
  const track = q('rateSlider');
  if (!track) return;

  const allDots = () => Array.from(document.querySelectorAll('.dot'));

  function updateDots(idx) {
    allDots().forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  allDots().forEach((dot, i) => {
    dot.addEventListener('click', () => {
      const cards = track.querySelectorAll('.slider-card');
      if (cards[i]) cards[i].scrollIntoView({ behavior:'smooth', block:'nearest', inline:'start' });
    });
  });

  let t;
  track.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const cards = Array.from(track.querySelectorAll('.slider-card'));
      const sl    = track.scrollLeft;
      let ci = 0, md = Infinity;
      cards.forEach((c, i) => { const d = Math.abs(c.offsetLeft - sl); if (d < md) { md = d; ci = i; } });
      updateDots(ci);
    }, 16);
  }, { passive: true });
}

/* ================================================================
   LIVE CLOCK
   ================================================================ */
function startLiveClock() {
  function tick() {
    const el = q('live-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
  }
  tick();
  setInterval(tick, 1000);
}

/* ================================================================
   SHARE RATES
   ================================================================ */
function shareRates() {
  document.querySelector('.share-overlay')?.remove();
  const pages = CFG?.admin?.pages || {};
  const opts  = [];
  if (pages.gold   !== false) opts.push({ id:'gold',   label:'Gold Rates',   icon: ICONS.gold   });
  if (pages.silver !== false) opts.push({ id:'silver', label:'Silver Rates', icon: ICONS.silver });
  if (pages.coins  !== false) opts.push({ id:'coins',  label:'Coin Rates',   icon: ICONS.coins  });

  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';
  overlay.innerHTML = `
    <div class="share-modal">
      <h3 class="share-modal-title">Share Rate Card</h3>
      <p class="share-modal-sub">Choose which rates to share as an image:</p>
      <div class="share-opts">
        ${opts.map(o => `
          <button class="share-opt-btn" id="sopt-${o.id}" onclick="doSharePage('${o.id}')">
            <span class="share-opt-icon">${o.icon}</span>
            <span>${o.label}</span>
          </button>`).join('')}
      </div>
      <button class="share-cancel-btn" onclick="document.querySelector('.share-overlay')?.remove()">Cancel</button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function showCallModal() {
  const biz = CFG?.site?.business || {};
  if (!biz.phone && !biz.phone2 && !biz.whatsapp) return;
  if (biz.phone && !biz.phone2 && !biz.whatsapp) {
    window.location.href = 'tel:' + biz.phone;
    return;
  }
  
  document.querySelector('.share-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'share-overlay call-overlay';
  overlay.innerHTML = `
    <div class="share-modal">
      <h3 class="share-modal-title">Contact Us</h3>
      <p class="share-modal-sub">Choose an option to contact us:</p>
      <div class="share-opts">
        ${biz.phone ? `
          <a href="tel:${biz.phone}" class="share-opt-btn" style="text-decoration:none;">
            <span class="share-opt-icon">${ICONS.phone}</span>
            <span>${esc(biz.phone)}</span>
          </a>` : ''}
        ${biz.phone2 ? `
          <a href="tel:${biz.phone2}" class="share-opt-btn" style="text-decoration:none;">
            <span class="share-opt-icon">${ICONS.phone}</span>
            <span>${esc(biz.phone2)}</span>
          </a>` : ''}
        ${biz.whatsapp ? `
          <a href="https://wa.me/${String(biz.whatsapp).replace(/[^0-9]/g,'')}" class="share-opt-btn" style="text-decoration:none;">
            <span class="share-opt-icon">${ICONS.whatsapp}</span>
            <span>WhatsApp</span>
          </a>` : ''}
      </div>
      <button class="share-cancel-btn" onclick="document.querySelector('.call-overlay')?.remove()">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);
}

function showOptionsMenu() {
  document.querySelector('.share-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'share-overlay call-overlay';
  overlay.innerHTML = `
    <div class="share-modal">
      <h3 class="share-modal-title">Menu</h3>
      <p class="share-modal-sub">More options</p>
      <div class="share-opts" style="flex-direction: column; gap: 10px;">
        <button class="share-opt-btn" onclick="showCallModal()" style="width: 100%; justify-content: center; text-decoration: none; border: none; background: rgba(0,0,0,0.05); font-family: Inter, sans-serif; font-size: 1rem; color: var(--text);">
          <span class="share-opt-icon">${ICONS.phone}</span>
          <span>Contact Us</span>
        </button>
        <button class="share-opt-btn" onclick="shareRates()" style="width: 100%; justify-content: center; text-decoration: none; border: none; background: rgba(0,0,0,0.05); font-family: Inter, sans-serif; font-size: 1rem; color: var(--text);">
          <span class="share-opt-icon">${ICONS.whatsapp}</span>
          <span>Share Rates</span>
        </button>
      </div>
      <button class="share-cancel-btn" onclick="document.querySelector('.call-overlay')?.remove()">Close</button>
    </div>`;
  document.body.appendChild(overlay);
}

async function doSharePage(pageId) {
  const btn = document.getElementById('sopt-' + pageId);
  const lbl = btn?.querySelector('span:last-child');
  if (btn) { btn.disabled = true; if (lbl) lbl.textContent = 'Generating…'; }
  try {
    const blob = await generateRateImage(pageId);
    if (!blob) throw new Error('empty');
    document.querySelector('.share-overlay')?.remove();
    const biz   = CFG?.site?.business || {};
    const fname = `${(biz.name||'rates').replace(/\s+/g,'-')}-${pageId}-${new Date().toISOString().slice(0,10)}.png`;
    const file  = new File([blob], fname, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `${biz.name||'Live Rates'} \u2013 ${pageId}` });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    }
  } catch(err) {
    if (err.name !== 'AbortError') document.querySelector('.share-overlay')?.remove();
  }
}

/* ================================================================
   GENERATE RATE IMAGE
   Clean layout: 1080px wide, no diagonal lines, clipped name columns
   ================================================================ */
async function generateRateImage(pageId) {
  const site  = CFG?.site  || {};
  const admin = CFG?.admin || {};
  const biz   = site.business || {};
  const theme = site.theme   || {};
  const data  = lastRatesData || {};
  const BRAND = theme.primaryColor || '#134258';
  const GOLD  = theme.accentColor  || '#D9B25F';

  const W     = 1080;  // wide enough for all numbers
  const PAD   = 52;
  const RLINE = 46;    // row height

  const isGold   = pageId === 'gold';
  const isSilver = pageId === 'silver';
  const isCoins  = pageId === 'coins';

  const karats    = isGold   ? (admin.goldRates?.karats || []) : [];
  const goldBase  = isGold   ? toNum(data.goldBase)            : null;
  const goldProds = isGold   ? (data.goldProducts  || [])      : [];
  const silvProds = isSilver ? (data.silverProducts || [])      : [];
  const gcRows    = isCoins  ? (admin.goldCoins?.rows   || []) : [];
  const scRows    = isCoins  ? (admin.silverCoins?.rows || []) : [];
  const gcBase    = isCoins  ? toNum(data.goldCoinBase)        : null;
  const scBase    = isCoins  ? toNum(data.silverCoinBase)      : null;
  const gcDiv     = admin.goldCoins?.divisor   || 10;
  const scDiv     = admin.silverCoins?.divisor || 1000;
  const gcPPG     = admin.goldCoins?.premiumPerGram   ?? 100;
  const scPPG     = admin.silverCoins?.premiumPerGram ?? 12;

  /* ── Accurate height calculation ── */
  const HDR_H  = 175;
  const SEC_H  = 36;
  const FOOT_H = 100;
  let H = HDR_H;

  if (isGold && karats.length && goldBase !== null) {
    H += SEC_H + Math.ceil(karats.length / 4) * 100 + 30;
  }
  if (goldProds.length) {
    H += SEC_H + RLINE + goldProds.length * RLINE + (data.goldApxRow ? RLINE : 0) + 26;
  }
  if (silvProds.length) {
    H += SEC_H + RLINE + silvProds.length * RLINE + (data.silverApxRow ? RLINE : 0) + 26;
  }
  if (gcRows.length && gcBase !== null) H += SEC_H + RLINE + gcRows.length * RLINE + 26;
  if (scRows.length && scBase !== null) H += SEC_H + RLINE + scRows.length * RLINE + 26;
  if (isCoins && (gcRows.length || scRows.length)) H += 46;
  H += FOOT_H;
  H = Math.max(H, 640);

  /* ── Canvas & background — clean gradient, no diagonal lines ── */
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bgGrd = ctx.createLinearGradient(0, 0, 0, H);
  bgGrd.addColorStop(0,   BRAND);
  bgGrd.addColorStop(0.6, '#0d2535');
  bgGrd.addColorStop(1,   '#081820');
  ctx.fillStyle = bgGrd;
  ctx.fillRect(0, 0, W, H);

  /* Subtle gold glow top-right */
  const cornerGrd = ctx.createRadialGradient(W, 0, 0, W, 0, 320);
  cornerGrd.addColorStop(0, 'rgba(217,178,95,0.09)');
  cornerGrd.addColorStop(1, 'transparent');
  ctx.fillStyle = cornerGrd;
  ctx.fillRect(0, 0, W, H);

  let y = PAD;

  /* ── Logo ── */
  let logoImg = null;
  if (biz.logo) {
    try {
      logoImg = await Promise.race([
        new Promise((res, rej) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload  = () => res(img);
          img.onerror = rej;
          img.src     = biz.logo;
        }),
        new Promise((_, rej) => setTimeout(rej, 3000)),
      ]);
    } catch {}
  }

  if (logoImg) {
    const lh = 86;
    const lw = Math.min((logoImg.naturalWidth / logoImg.naturalHeight) * lh, 260);
    ctx.drawImage(logoImg, PAD, y, lw, lh);
  } else {
    ctx.fillStyle = GOLD; ctx.font = 'bold 38px Inter,Arial,sans-serif';
    ctx.fillText(biz.name || 'Live Rates', PAD, y + 50);
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '15px Inter,Arial,sans-serif';
    ctx.fillText(biz.tagline || 'Live Bullion Rates', PAD, y + 74);
  }

  /* Date + time right-aligned */
  const now = new Date();
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.40)'; ctx.font = '13px Inter,Arial,sans-serif';
  ctx.fillText(
    now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    W - PAD, y + 28
  );
  ctx.fillStyle = GOLD; ctx.font = 'bold 26px Inter,Arial,sans-serif';
  ctx.fillText(
    now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    W - PAD, y + 62
  );
  ctx.textAlign = 'left';
  y += 110;

  /* Gold divider */
  const divGrd = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  divGrd.addColorStop(0, 'transparent'); divGrd.addColorStop(0.15, GOLD);
  divGrd.addColorStop(0.85, GOLD); divGrd.addColorStop(1, 'transparent');
  ctx.fillStyle = divGrd; ctx.fillRect(PAD, y, W - PAD * 2, 1.5); y += 22;

  /* ── Column x-positions for product tables (right-aligned numbers) ──
     W=1080, PAD=52 → usable=976
     BUY at 590, SELL at 730, HIGH at 870, LOW at 1028 (W-52)            */
  const NM_X        = PAD + 12;
  const BUY_X       = 590;
  const SELL_X      = 730;
  const HIGH_X      = 870;
  const LOW_X       = W - PAD - 4;
  const NAME_MAX_W  = BUY_X - NM_X - 24;   // clip boundary for names

  /* ── KARAT RATES section (gold only) ── */
  if (isGold && karats.length && goldBase !== null) {
    ctx.fillStyle = GOLD; ctx.font = 'bold 17px Inter,Arial,sans-serif';
    ctx.fillText('KARAT RATES  \u00b7  per 10g', PAD, y + 22);

    /* BEFORE GST badge */
    const titleW = ctx.measureText('KARAT RATES  \u00b7  per 10g').width;
    const bx = PAD + titleW + 12, by = y + 6, bw = 100, bh = 22;
    ctx.fillStyle = 'rgba(217,178,95,0.20)';
    imgRoundRect(ctx, bx, by, bw, bh, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(217,178,95,0.55)'; ctx.lineWidth = 1;
    imgRoundRect(ctx, bx, by, bw, bh, 5); ctx.stroke();
    ctx.fillStyle = GOLD; ctx.font = 'bold 10px Inter,Arial,sans-serif';
    ctx.fillText('BEFORE GST', bx + 7, by + 15);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.font = '12px Inter,Arial,sans-serif';
    ctx.fillText('Base: BEFORE GST  \u00b7  Sell', W - PAD, y + 22);
    ctx.textAlign = 'left';
    y += 34;

    const cols  = Math.min(karats.length, 4);
    const cardW = Math.floor((W - PAD * 2 - (cols - 1) * 10) / cols);
    const cardH = 88;
    karats.forEach((k, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = PAD + col * (cardW + 10), cy = y + row * (cardH + 10);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      imgRoundRect(ctx, cx, cy, cardW, cardH, 10); ctx.fill();
      ctx.fillStyle = GOLD; imgRoundRect(ctx, cx, cy, cardW, 4, 10); ctx.fill();
      const price = Math.round(goldBase * k.multiplier);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = 'bold 26px Inter,Arial,sans-serif';
      ctx.fillText(k.name, cx + cardW / 2, cy + 36);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '12px Inter,Arial,sans-serif';
      ctx.fillText(k.purity || '', cx + cardW / 2, cy + 52);
      ctx.fillStyle = GOLD; ctx.font = 'bold 23px Inter,Arial,sans-serif';
      ctx.fillText('\u20b9' + price.toLocaleString('en-IN'), cx + cardW / 2, cy + 76);
      ctx.textAlign = 'left';
    });
    y += Math.ceil(karats.length / cols) * (cardH + 10) + 14;
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(PAD, y, W - PAD * 2, 1); y += 20;
  }

  /* ── Product table: 5 columns + optional APX (BEFORE GST) row ── */
  function drawProdTable(title, titleCol, rows, apxLabel, apxData) {
    if (!rows.length) return;
    ctx.fillStyle = titleCol; ctx.font = 'bold 17px Inter,Arial,sans-serif';
    ctx.fillText(title, PAD, y + 22); y += 36;

    /* Header */
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 12px Inter,Arial,sans-serif';
    ctx.fillText('PRODUCT', NM_X, y + 30);
    ctx.textAlign = 'right';
    ctx.fillText('BUY',  BUY_X,  y + 30);
    ctx.fillText('SELL', SELL_X, y + 30);
    ctx.fillText('HIGH', HIGH_X, y + 30);
    ctx.fillText('LOW',  LOW_X,  y + 30);
    ctx.textAlign = 'left'; y += RLINE;

    rows.forEach((p, i) => {
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
      }
      /* Clip name so it never bleeds into number columns */
      ctx.save();
      ctx.beginPath(); ctx.rect(NM_X, y, NAME_MAX_W, RLINE); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '15px Inter,Arial,sans-serif';
      ctx.fillText(String(p.name || p.symbol || ''), NM_X, y + 30);
      ctx.restore();

      ctx.textAlign = 'right'; ctx.font = 'bold 18px Inter,Arial,sans-serif';
      if (p.bid  != null) { ctx.fillStyle = '#86efac'; ctx.fillText(String(p.bid),  BUY_X,  y + 30); }
      if (p.ask  != null) { ctx.fillStyle = '#fca5a5'; ctx.fillText(String(p.ask),  SELL_X, y + 30); }
      if (p.high != null) { ctx.fillStyle = '#86efac'; ctx.fillText(String(p.high), HIGH_X, y + 30); }
      if (p.low  != null) { ctx.fillStyle = '#fca5a5'; ctx.fillText(String(p.low),  LOW_X,  y + 30); }
      ctx.textAlign = 'left'; y += RLINE;
    });

    /* APX (BEFORE GST / BEFORE GST PETI) row */
    if (apxData) {
      const sell = apxData.sell ?? null;
      const high = apxData.high ?? null;
      const low  = apxData.low  ?? null;
      ctx.fillStyle = 'rgba(217,178,95,0.12)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
      ctx.fillStyle = GOLD; ctx.fillRect(PAD, y, 3, RLINE);          // accent bar
      ctx.fillStyle = GOLD; ctx.font = 'italic bold 14px Inter,Arial,sans-serif';
      ctx.fillText(apxLabel, NM_X + 4, y + 30);
      ctx.textAlign = 'right'; ctx.font = 'bold 18px Inter,Arial,sans-serif';
      if (sell != null) { ctx.fillStyle = GOLD;      ctx.fillText(String(sell), SELL_X, y + 30); }
      if (high != null) { ctx.fillStyle = '#86efac'; ctx.fillText(String(high), HIGH_X, y + 30); }
      if (low  != null) { ctx.fillStyle = '#fca5a5'; ctx.fillText(String(low),  LOW_X,  y + 30); }
      ctx.textAlign = 'left'; y += RLINE;
    }

    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(PAD, y, W - PAD * 2, 1); y += 24;
  }

  /* ── Coin table: Name + Price (per-gram premium) ── */
  function drawCoinTable(title, titleCol, rows, baseVal, divisor, premiumPerGram) {
    if (!rows.length || baseVal === null) return;
    const base1u      = baseVal / divisor;
    const COIN_NAME_W = (W - PAD * 2) * 0.65;

    ctx.fillStyle = titleCol; ctx.font = 'bold 17px Inter,Arial,sans-serif';
    ctx.fillText(title, PAD, y + 22); y += 36;

    /* Header */
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 12px Inter,Arial,sans-serif';
    ctx.fillText('PRODUCT', PAD + 12, y + 30);
    ctx.textAlign = 'right'; ctx.fillText('PRICE (\u20b9)', W - PAD, y + 30);
    ctx.textAlign = 'left'; y += RLINE;

    rows.forEach((c, i) => {
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
      }
      const price = Math.round(base1u * c.grams + premiumPerGram * c.grams);
      /* Clip name */
      ctx.save();
      ctx.beginPath(); ctx.rect(PAD + 12, y, COIN_NAME_W, RLINE); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.87)'; ctx.font = '15px Inter,Arial,sans-serif';
      ctx.fillText(String(c.name || ''), PAD + 12, y + 30);
      ctx.restore();
      ctx.textAlign = 'right'; ctx.fillStyle = GOLD; ctx.font = 'bold 22px Inter,Arial,sans-serif';
      ctx.fillText('\u20b9' + price.toLocaleString('en-IN'), W - PAD, y + 30);
      ctx.textAlign = 'left'; y += RLINE;
    });

    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(PAD, y, W - PAD * 2, 1); y += 24;
  }

  /* ── Draw content ── */
  drawProdTable('GOLD PRODUCTS',   GOLD,     goldProds, 'BEFORE GST',      data.goldApxRow);
  drawProdTable('SILVER PRODUCTS', '#94a3b8', silvProds, 'BEFORE GST PETI', data.silverApxRow);
  drawCoinTable('GOLD COINS',   GOLD,     gcRows, gcBase, gcDiv, gcPPG);
  drawCoinTable('SILVER COINS', '#94a3b8', scRows, scBase, scDiv, scPPG);

  /* Coin note */
  if (isCoins && (gcRows.length || scRows.length)) {
    ctx.fillStyle = 'rgba(255,255,255,0.40)'; ctx.font = 'italic 13px Inter,Arial,sans-serif';
    ctx.fillText(
      'Rates are inclusive of making charges and exclusive of packing charges.*',
      PAD, y + 22
    );
    y += 42;
  }

  /* ── Footer ── */
  const fy = Math.max(y + 10, H - FOOT_H);
  ctx.fillStyle = divGrd; ctx.fillRect(PAD, fy, W - PAD * 2, 1.5);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '14px Inter,Arial,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Rates are for reference only. Contact office for booking.', W / 2, fy + 28);
  if (biz.phone || biz.phone2 || biz.whatsapp) {
    ctx.fillStyle = GOLD; ctx.font = 'bold 19px Inter,Arial,sans-serif';
    const phones = [biz.phone || '', biz.phone2 ? '/ ' + biz.phone2 : '', biz.whatsapp ? '\u2022 ' + biz.whatsapp : '']
      .filter(Boolean).join('   ');
    ctx.fillText(phones, W / 2, fy + 56);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.font = '11px Inter,Arial,sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Generated by Live Rates Platform', W - PAD, H - 10);
  ctx.textAlign = 'left';

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
}


/* Rounded-rectangle path helper for Canvas (no ctx.roundRect needed) */
function imgRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,      y + h, x,       y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x,      y,     x + r,   y,         r);
  ctx.closePath();
}
