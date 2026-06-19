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
  if (feat.showMarquee !== false && site.marquee?.enabled !== false) {
    const mw = q('marquee-wrap');
    const mt = q('marquee-text');
    if (mw) mw.style.display = '';
    if (mt) mt.textContent = site.marquee?.text || '';
    document.documentElement.style.setProperty('--marquee-h', '34px');
  }

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
    status:            q('status'),
    lastUpdated:       q('lastUpdated'),
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
const PAGE_META = {
  gold:   { label: 'Gold Rates',   bnav: 'Gold',   icon: '⚜' },
  silver: { label: 'Silver Rates', bnav: 'Silver', icon: '◈' },
  coins:  { label: 'Coin Rates',   bnav: 'Coins',  icon: '🪙' },
};

function buildDesktopNav(pages) {
  const inner = q('desktop-nav-inner');
  if (!inner) return;
  inner.innerHTML = pages.map((id, i) => {
    const m = PAGE_META[id] || { label: id, icon: '•' };
    return `<button class="dnav-btn${i===0?' active':''}" id="dnav-${id}"
      aria-pressed="${i===0}" onclick="switchPage('${id}')">
      <span class="dnav-icon">${m.icon}</span> ${m.label}
    </button>`;
  }).join('');
}

function buildBottomNav(pages) {
  const inner = q('bottom-nav-inner');
  if (!inner) return;
  inner.innerHTML = pages.map((id, i) => {
    const m = PAGE_META[id] || { label: id, bnav: id, icon: '•' };
    return `<button class="bnav-btn${i===0?' active':''}" id="bnav-${id}"
      aria-label="${m.label}" onclick="switchPage('${id}')">
      <span class="bnav-icon">${m.icon}</span>
      <span class="bnav-label">${m.bnav}</span>
    </button>`;
  }).join('');
}

/* ================================================================
   PAGE BUILDERS — HTML generated from admin-config.json
   ================================================================ */
function buildPages(pages, admin, site) {
  const root = q('pages-root');
  if (!root) return;
  const secs = admin.sections || {};

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

  /* Karat Rates — driven by admin-config.goldRates.karats[] */
  if (secs.karatRates !== false && gr.karats?.length) {
    const cards = gr.karats.map(k => `
      <div class="karat-card" id="karat-card-${kid(k.name)}">
        <div class="karat-label">${esc(k.name)}</div>
        <div class="karat-purity">${esc(k.purity || '')}</div>
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

  /* Gold Products table */
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

  /* Market Rates slider — future + spot */
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

/* ── Coins page — tabs + panels driven by config ── */
function buildCoinsPage(admin) {
  const gc = admin.goldCoins   || {};
  const sc = admin.silverCoins || {};
  const hasGold   = (gc.rows?.length  || 0) > 0;
  const hasSilver = (sc.rows?.length  || 0) > 0;

  let h = `<h1 class="page-title">Coin Rates</h1>`;
  if (!hasGold && !hasSilver) return h + '<p class="empty-msg">No coin rows configured in admin-config.json</p>';

  /* Tab bar */
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

  /* Gold coin panel */
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

  /* Silver coin panel */
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
   CONTACT BAR — sticky phone + WhatsApp from config
   ================================================================ */
function buildContactBar(biz, footerCfg) {
  const bar = q('contact-bar');
  if (!bar) return;

  const showPhone = footerCfg?.showPhone    !== false && biz?.phone;
  const showWA    = footerCfg?.showWhatsapp !== false && biz?.whatsapp;
  if (!showPhone && !showWA) return;

  let html = '';
  if (showPhone) {
    html += `<a href="tel:${biz.phone}" class="contact-btn phone-btn" aria-label="Call us">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4
          1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4
          0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6
          3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
      </svg>
      Call
    </a>`;
  }
  if (showWA) {
    const num = String(biz.whatsapp).replace(/[^0-9]/g, '');
    html += `<a href="https://wa.me/${num}" target="_blank" rel="noopener noreferrer"
      class="contact-btn whatsapp-btn" aria-label="WhatsApp">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15
          -.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463
          -2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606
          .134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371
          -.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51
          -.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016
          -1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077
          4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085
          1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198
          -.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214
          -3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45
          4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825
          0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297
          A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547
          4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683
          1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0
          00-3.48-8.413z"/>
      </svg>
      WhatsApp
    </a>`;
  }

  bar.innerHTML = html;
  bar.style.display = 'flex';
  /* Expand body bottom padding to clear contact bar + bottom nav */
  document.documentElement.style.setProperty('--contact-h', '60px');
}

/* ================================================================
   FOOTER — built from config
   ================================================================ */
function buildFooter(biz, footerCfg, socials) {
  const el = q('site-footer');
  if (!el) return;

  let html = `<p>${esc(footerCfg?.copyright || `© ${biz?.name || 'Jewellers'}`)}</p>`;

  if (footerCfg?.showPhone !== false && biz?.phone) {
    html += `<p class="footer-contact">
      📞 <a href="tel:${biz.phone}">${esc(biz.phone)}</a>
    </p>`;
  }
  if (footerCfg?.showWhatsapp !== false && biz?.whatsapp) {
    const num = String(biz.whatsapp).replace(/[^0-9]/g, '');
    html += `<p class="footer-contact">
      <a href="https://wa.me/${num}" target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>
    </p>`;
  }
  if (footerCfg?.showEmail && biz?.email) {
    html += `<p class="footer-contact"><a href="mailto:${biz.email}">${esc(biz.email)}</a></p>`;
  }
  if (footerCfg?.showAddress && biz?.address) {
    html += `<p class="footer-address">${esc(biz.address)}</p>`;
  }

  const links = [];
  if (socials?.instagram) links.push(`<a href="${esc(socials.instagram)}" target="_blank" rel="noopener noreferrer">Instagram</a>`);
  if (socials?.facebook)  links.push(`<a href="${esc(socials.facebook)}"  target="_blank" rel="noopener noreferrer">Facebook</a>`);
  if (socials?.website)   links.push(`<a href="${esc(socials.website)}"   target="_blank" rel="noopener noreferrer">Website</a>`);
  if (links.length) html += `<p class="footer-socials">${links.join(' &nbsp;·&nbsp; ')}</p>`;

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

/* Sanitise karat name to a safe CSS id fragment */
function kid(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '-');
}

/* ================================================================
   CHANGE DETECTION — 3-second linger highlight
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
   TABLE RENDERING — incremental, no full rebuilds
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
   KARAT RENDERER — driven by admin-config.goldRates.karats[]
   goldBase = 999 IMP RTGS Sell (per 10g)
   price    = Math.round(goldBase × multiplier)
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
   COIN TABLE RENDERER — config-driven rows, incremental updates
   containerId  : id of the table-wrap div
   configRows   : admin-config.goldCoins.rows or silverCoins.rows
   baseVal      : goldCoinBase or silverCoinBase from server payload
   divisor      : from admin-config (10 for gold, 1000 for silver)
   prevKey      : key in the prev{} object for base tracking
   ================================================================ */
function renderCoinTable(containerId, configRows, baseVal, divisor, prevKey) {
  const container = q(containerId);
  if (!container || !configRows?.length) return;

  const baseRaw = toNum(baseVal);
  const base1u  = baseRaw !== null ? baseRaw / divisor : null;

  const table = container.querySelector('.coin-table');
  const tbody = table?.querySelector('tbody');

  if (!table || !tbody) {
    /* First render — build full table */
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
    /* Incremental update */
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
   MASTER RENDER — called on every rates:update socket event
   ================================================================ */
function renderAll(data) {
  if (!CFG) return;
  const admin = CFG.admin || {};

  /* Product tables */
  renderTable(dom.goldProductsBox,   data?.goldProducts,   prev.goldProducts,   'mini');
  renderTable(dom.silverProductsBox, data?.silverProducts, prev.silverProducts, 'mini');

  /* Market rates (future + spot) */
  renderTable(dom.futureBox, data?.futureRows, prev.future, 'rate');
  renderTable(dom.spotBox,   data?.spotRows,   prev.spot,   'rate');

  /* Karat rates — goldBase from server (999 IMP RTGS Sell) */
  renderKaratRates(data?.goldBase);

  /* Coin tables — divisor comes from admin-config */
  const goldDiv   = admin.goldCoins?.divisor   || 10;
  const silverDiv = admin.silverCoins?.divisor || 1000;
  renderCoinTable('goldCoinBox',   admin.goldCoins?.rows,   data?.goldCoinBase,   goldDiv,   'goldCoinBase');
  renderCoinTable('silverCoinBox', admin.silverCoins?.rows, data?.silverCoinBase, silverDiv, 'silverCoinBase');

  /* Update prev maps */
  prev.goldProducts   = updatePrevMap(data?.goldProducts);
  prev.silverProducts = updatePrevMap(data?.silverProducts);
  prev.future         = updatePrevMap(data?.futureRows);
  prev.spot           = updatePrevMap(data?.spotRows);

  /* Timestamp */
  const ts = data?.updatedAt ? new Date(data.updatedAt) : null;
  if (dom.lastUpdated) {
    dom.lastUpdated.textContent = ts
      ? ts.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
      : '—';
  }

  /* Connection status */
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
   SOCKET — websocket only, no polling overhead
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
   SLIDER — swipe + dot sync
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
