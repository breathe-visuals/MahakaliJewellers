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
  whatsapp: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
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
        <span class="dnav-icon">${m.icon}</span> ${m.label}
      </button>`;
    }).join('');
  }
  
  if (right) {
    right.innerHTML = `
      <button class="dnav-btn dnav-action" onclick="showCallModal()">
        <span class="dnav-icon">${ICONS.phone}</span> Call
      </button>
      <button class="dnav-btn dnav-action" onclick="shareRates()">
        <span class="dnav-icon">${ICONS.whatsapp}</span> Share
      </button>`;
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
        <span class="section-title">Karat Rates</span>
        <span class="section-subtitle">Base: ${esc(gr.baseRow || '999 IMP RTGS')} &nbsp;·&nbsp; Sell</span>
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

  let html = `<p>${esc(footerCfg?.copyright || `\u00a9 ${biz?.name || 'Jewellers'}`)}</p>`;
  let contactsHtml = '';

  if (footerCfg?.showPhone !== false && biz?.phone) {
    contactsHtml += `<span class="footer-contact">${ICONS.phone} <a href="tel:${String(biz.phone).replace(/\\s/g,'')}">${esc(biz.phone)}</a></span>`;
  }
  if (footerCfg?.showPhone !== false && biz?.phone2) {
    contactsHtml += `<span class="footer-contact">${ICONS.phone} <a href="tel:${String(biz.phone2).replace(/\\s/g,'')}">${esc(biz.phone2)}</a></span>`;
  }
  if (footerCfg?.showWhatsapp !== false && biz?.whatsapp) {
    contactsHtml += `<span class="footer-contact">${ICONS.whatsapp} <a href="https://wa.me/${String(biz.whatsapp).replace(/[^0-9]/g,'')}">${esc(biz.whatsapp)}</a></span>`;
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

  el.innerHTML = html;
}

/* ================================================================
   SERVICE WORKER
   ================================================================ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
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
  const trs      = tbody?.querySelectorAll('tr');
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
   COIN TABLE RENDERER
   ================================================================ */
function renderCoinTable(containerId, configRows, baseVal, divisor, prevKey) {
  const container = q(containerId);
  if (!container || !configRows?.length) return;

  const baseRaw = toNum(baseVal);
  const base1u  = baseRaw !== null ? baseRaw / divisor : null;

  const table = container.querySelector('.coin-table');
  const tbody = table?.querySelector('tbody');

  if (!table || !tbody) {
    const rows = configRows.map((c, i) => {
      const price = base1u !== null ? Math.round(base1u * c.grams + c.premium) : null;
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

      const price    = base1u !== null ? Math.round(base1u * c.grams + c.premium) : null;
      const prevBase = prev[prevKey];
      const prevU    = prevBase !== null ? prevBase / divisor : null;
      const prevP    = prevU   !== null ? Math.round(prevU * c.grams + c.premium) : null;

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
  renderTable(dom.silverProductsBox, data?.silverProducts, prev.silverProducts, 'mini');

  renderTable(dom.futureBox, data?.futureRows, prev.future, 'rate');
  renderTable(dom.spotBox,   data?.spotRows,   prev.spot,   'rate');

  renderKaratRates(data?.goldBase);

  const goldDiv   = admin.goldCoins?.divisor   || 10;
  const silverDiv = admin.silverCoins?.divisor || 1000;
  renderCoinTable('goldCoinBox',   admin.goldCoins?.rows,   data?.goldCoinBase,   goldDiv,   'goldCoinBase');
  renderCoinTable('silverCoinBox', admin.silverCoins?.rows, data?.silverCoinBase, silverDiv, 'silverCoinBase');

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
   ================================================================ */
async function generateRateImage(pageId) {
  const site  = CFG?.site  || {};
  const admin = CFG?.admin || {};
  const biz   = site.business || {};
  const theme = site.theme   || {};
  const data  = lastRatesData || {};
  const BRAND = theme.primaryColor || '#003336';
  const GOLD  = theme.accentColor  || '#D9B25F';
  const W=900, PAD=36, RLINE=44;

  const isGold=pageId==='gold', isSilver=pageId==='silver', isCoins=pageId==='coins';
  const karats   = isGold   ? (admin.goldRates?.karats||[]) : [];
  const goldBase = isGold   ? toNum(data.goldBase)          : null;
  const goldProds= isGold   ? (data.goldProducts  ||[]).slice(0,8) : [];
  const silvProds= isSilver ? (data.silverProducts||[]).slice(0,8) : [];
  const gcRows   = isCoins  ? (admin.goldCoins?.rows  ||[]) : [];
  const scRows   = isCoins  ? (admin.silverCoins?.rows||[]) : [];
  const gcBase   = isCoins  ? toNum(data.goldCoinBase)   : null;
  const scBase   = isCoins  ? toNum(data.silverCoinBase) : null;
  const gcDiv    = admin.goldCoins?.divisor   || 10;
  const scDiv    = admin.silverCoins?.divisor || 1000;

  let H=170;
  if(karats.length&&goldBase!==null) H+=55+Math.ceil(karats.length/4)*104+20;
  if(goldProds.length) H+=55+(goldProds.length+1)*RLINE;
  if(silvProds.length) H+=55+(silvProds.length+1)*RLINE;
  if(gcRows.length)    H+=55+(gcRows.length+1)*RLINE;
  if(scRows.length)    H+=55+(scRows.length+1)*RLINE;
  H+=96; H=Math.max(H,600);

  const canvas=document.createElement('canvas');
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle=BRAND; ctx.fillRect(0,0,W,H);
  ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.022)'; ctx.lineWidth=1;
  for(let d=-H;d<W+H;d+=38){ctx.beginPath();ctx.moveTo(d,0);ctx.lineTo(d+H,H);ctx.stroke();}
  ctx.restore();
  let y=PAD;

  let logoImg=null;
  if(biz.logo){
    try{
      logoImg=await Promise.race([
        new Promise((res,rej)=>{const i=new Image();i.crossOrigin='anonymous';i.onload=()=>res(i);i.onerror=rej;i.src=biz.logo;}),
        new Promise((_,rej)=>setTimeout(rej,3000)),
      ]);
    }catch{}
  }

  if(logoImg){
    const lh=90,lw=Math.min((logoImg.naturalWidth/logoImg.naturalHeight)*lh,240);
    ctx.drawImage(logoImg,PAD,y,lw,lh);
  }else{
    ctx.fillStyle=GOLD;ctx.font='bold 40px Inter,Arial,sans-serif';
    ctx.fillText(biz.name||'Live Rates',PAD,y+52);
    ctx.fillStyle='rgba(255,255,255,0.48)';ctx.font='16px Inter,Arial,sans-serif';
    ctx.fillText(biz.tagline||'Live Bullion Rates',PAD,y+80);
  }

  const now=new Date();
  ctx.textAlign='right';
  ctx.fillStyle='rgba(255,255,255,0.42)';ctx.font='14px Inter,Arial,sans-serif';
  ctx.fillText(now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),W-PAD,y+32);
  ctx.fillStyle=GOLD;ctx.font='bold 28px Inter,Arial,sans-serif';
  ctx.fillText(now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),W-PAD,y+68);
  ctx.textAlign='left'; y+=112;

  const grd=ctx.createLinearGradient(PAD,0,W-PAD,0);
  grd.addColorStop(0,'transparent');grd.addColorStop(0.18,GOLD);grd.addColorStop(0.82,GOLD);grd.addColorStop(1,'transparent');
  ctx.fillStyle=grd;ctx.fillRect(PAD,y,W-PAD*2,2);y+=20;

  if(karats.length&&goldBase!==null){
    ctx.fillStyle=GOLD;ctx.font='bold 18px Inter,Arial,sans-serif';
    ctx.fillText('KARAT RATES  (per 10g)',PAD,y+22);
    ctx.fillStyle='rgba(255,255,255,0.32)';ctx.font='13px Inter,Arial,sans-serif';
    ctx.textAlign='right';
    ctx.fillText('Base: '+(admin.goldRates?.baseRow||'999 IMP')+' Sell',W-PAD,y+22);
    ctx.textAlign='left';y+=36;
    const cols=Math.min(karats.length,4);
    const cardW=Math.floor((W-PAD*2-(cols-1)*10)/cols),cardH=96;
    karats.forEach((k,i)=>{
      const col=i%cols,row=Math.floor(i/cols);
      const cx=PAD+col*(cardW+10),cy=y+row*(cardH+10);
      ctx.fillStyle='rgba(255,255,255,0.07)';imgRoundRect(ctx,cx,cy,cardW,cardH,10);ctx.fill();
      ctx.fillStyle=GOLD;imgRoundRect(ctx,cx,cy,cardW,5,10);ctx.fill();
      const price=Math.round(goldBase*k.multiplier);
      ctx.textAlign='center';
      ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.font='bold 28px Inter,Arial,sans-serif';
      ctx.fillText(k.name, cx+cardW/2, cy+40);
      ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='14px Inter,Arial,sans-serif';
      ctx.fillText(k.purity||'', cx+cardW/2, cy+58);
      ctx.fillStyle=GOLD; ctx.font='bold 26px Inter,Arial,sans-serif';
      ctx.fillText('\u20b9'+price.toLocaleString('en-IN'), cx+cardW/2, cy+84);
      ctx.textAlign='left';
    });
    y+=Math.ceil(karats.length/cols)*(cardH+10)+16;
    ctx.fillStyle='rgba(255,255,255,0.07)';ctx.fillRect(PAD,y,W-PAD*2,1);y+=18;
  }

  function drawProdTable(title,titleCol,rows){
    if(!rows.length)return;
    ctx.fillStyle=titleCol;ctx.font='bold 17px Inter,Arial,sans-serif';
    ctx.fillText(title,PAD,y+22);y+=36;
    ctx.fillStyle='rgba(255,255,255,0.12)';ctx.fillRect(PAD,y,W-PAD*2,RLINE);
    const C={nm:PAD+10,buy:PAD+360,sell:PAD+510,high:PAD+660,low:W-PAD-15};
    ctx.fillStyle='rgba(255,255,255,0.55)';ctx.font='bold 12px Inter,Arial,sans-serif';
    ctx.fillText('PRODUCT',C.nm,y+28);ctx.textAlign='right';
    ctx.fillText('BUY',C.buy,y+28);ctx.fillText('SELL',C.sell,y+28);
    ctx.fillText('HIGH',C.high,y+28);ctx.fillText('LOW',C.low,y+28);
    ctx.textAlign='left';y+=RLINE;
    rows.forEach((p,i)=>{
      if(i%2===1){ctx.fillStyle='rgba(255,255,255,0.03)';ctx.fillRect(PAD,y,W-PAD*2,RLINE);}
      ctx.fillStyle='rgba(255,255,255,0.82)'; ctx.font='16px Inter,Arial,sans-serif';
      ctx.fillText(String(p.name||p.symbol||'').substring(0,26),C.nm,y+30);
      ctx.textAlign='right'; ctx.font='bold 19px Inter,Arial,sans-serif';
      if(p.bid !=null){ctx.fillStyle='#86efac';ctx.fillText(String(p.bid), C.buy, y+30);}
      if(p.ask !=null){ctx.fillStyle='#fca5a5';ctx.fillText(String(p.ask), C.sell,y+30);}
      if(p.high!=null){ctx.fillStyle='#86efac';ctx.fillText(String(p.high),C.high,y+30);}
      if(p.low !=null){ctx.fillStyle='#fca5a5';ctx.fillText(String(p.low), C.low, y+30);}
      ctx.textAlign='left'; y+=RLINE;
    });
    ctx.fillStyle='rgba(255,255,255,0.06)';ctx.fillRect(PAD,y,W-PAD*2,1);y+=18;
  }

  function drawCoinTable(title,titleCol,rows,baseVal,divisor){
    if(!rows.length||baseVal===null)return;
    const base1u=baseVal/divisor;
    ctx.fillStyle=titleCol;ctx.font='bold 17px Inter,Arial,sans-serif';
    ctx.fillText(title,PAD,y+22);y+=36;
    ctx.fillStyle='rgba(255,255,255,0.12)';ctx.fillRect(PAD,y,W-PAD*2,RLINE);
    ctx.fillStyle='rgba(255,255,255,0.55)';ctx.font='bold 12px Inter,Arial,sans-serif';
    ctx.fillText('PRODUCT',PAD+10,y+28);
    ctx.textAlign='right';ctx.fillText('PRICE (\u20b9)',W-PAD,y+28);ctx.textAlign='left';y+=RLINE;
    rows.forEach((c,i)=>{
      if(i%2===1){ctx.fillStyle='rgba(255,255,255,0.03)';ctx.fillRect(PAD,y,W-PAD*2,RLINE);}
      const price=Math.round(base1u*c.grams+c.premium);
      ctx.fillStyle='rgba(255,255,255,0.85)';ctx.font='16px Inter,Arial,sans-serif';
      ctx.fillText(String(c.name||'').substring(0,32),PAD+10,y+30);
      ctx.textAlign='right';ctx.fillStyle=GOLD;ctx.font='bold 24px Inter,Arial,sans-serif';
      ctx.fillText('\u20b9'+price.toLocaleString('en-IN'),W-PAD,y+30);
      ctx.textAlign='left';y+=RLINE;
    });
    ctx.fillStyle='rgba(255,255,255,0.06)';ctx.fillRect(PAD,y,W-PAD*2,1);y+=18;
  }

  drawProdTable('GOLD PRODUCTS',   GOLD,     goldProds);
  drawProdTable('SILVER PRODUCTS', '#94a3b8', silvProds);
  drawCoinTable('GOLD COINS',   GOLD,     gcRows, gcBase, gcDiv);
  drawCoinTable('SILVER COINS', '#94a3b8', scRows, scBase, scDiv);

  const fy=Math.max(y+14,H-82);
  ctx.fillStyle=GOLD;ctx.fillRect(PAD,fy,W-PAD*2,1.5);
  ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='14px Inter,Arial,sans-serif';
  ctx.textAlign='center';
  ctx.fillText('Rates are for reference only. Contact office for booking.',W/2,fy+26);
  if(biz.phone || biz.phone2 || biz.whatsapp){
    ctx.fillStyle=GOLD;ctx.font='bold 20px Inter,Arial,sans-serif';
    ctx.fillText(`${biz.phone || ''}  ${biz.phone2 ? ' / '+biz.phone2 : ''}  ${biz.whatsapp ? ' \u2022 '+biz.whatsapp : ''}`,W/2,fy+54);
  }
  ctx.fillStyle='rgba(255,255,255,0.17)';ctx.font='12px Inter,Arial,sans-serif';
  ctx.textAlign='right';ctx.fillText('Generated by Live Rates Platform',W-PAD,H-10);ctx.textAlign='left';

  return new Promise(resolve=>canvas.toBlob(resolve,'image/png',0.95));
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
