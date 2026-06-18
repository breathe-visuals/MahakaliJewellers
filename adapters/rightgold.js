const { chromium } = require('playwright');

function parseNumber(text) {
  if (text === null || text === undefined) return null;
  const cleaned = String(text).replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function clickByText(page, label) {
  const candidates = [
    page.getByText(label, { exact: true }),
    page.locator(`button:has-text("${label}")`),
    page.locator(`a:has-text("${label}")`),
    page.locator(`li:has-text("${label}")`),
    page.locator(`div:has-text("${label}")`),
    page.locator(`span:has-text("${label}")`),
  ];

  for (const locator of candidates) {
    try {
      if (await locator.first().count()) {
        await locator.first().click({ timeout: 3000 });
        return true;
      }
    } catch (_) {}
  }

  try {
    await page.evaluate((wanted) => {
      const elements = Array.from(document.querySelectorAll('button,a,li,div,span'));
      const el = elements.find((node) => (node.textContent || '').trim() === wanted);
      if (el && typeof el.click === 'function') el.click();
    }, label);
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureVisible(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
}

async function extractRows(page, coinType) {
  return page.evaluate((needle) => {
    const rows = Array.from(document.querySelectorAll('tr'))
      .filter((tr) => tr && tr.offsetParent !== null)
      .map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td,th'))
          .map((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        const priceEl = tr.querySelector('.product-rate .bgm, .bgm.e, .bgm');
        const price = priceEl ? (priceEl.textContent || priceEl.innerText || '').replace(/\s+/g, ' ').trim() : '';
        return { cells, price };
      })
      .filter(({ cells, price }) => {
        const joined = cells.join(' ').toUpperCase();
        return joined.includes(needle) && /\d/.test(joined) && !!price && !/^PRODUCT\s+PRICE$/i.test(joined);
      })
      .map(({ cells, price }) => {
        const name = cells.find((cell) => /COIN/i.test(cell) && !/^PRODUCT$/i.test(cell)) || cells[0] || '';
        return { name: name.trim(), price: price.trim() };
      })
      .filter((row) => row.name && row.price);

    const unique = [];
    const seen = new Set();
    for (const row of rows) {
      const key = `${row.name}|${row.price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }
    return unique;
  }, coinType.toUpperCase());
}

function parseRows(rows) {
  return (rows || []).map((row) => ({
    name: normalize(row.name),
    price: parseNumber(row.price),
  })).filter((row) => row.name && row.price !== null);
}

function createRightGoldCollector({ url, onResult, onError } = {}) {
  let browser = null;
  let launching = null;

  async function ensureBrowser() {
    if (browser) return browser;
    if (launching) return launching;

    launching = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }).then((b) => {
      browser = b;
      launching = null;
      return browser;
    }).catch((err) => {
      launching = null;
      throw err;
    });

    return launching;
  }

  async function scrape() {
    const browserInstance = await ensureBrowser();
    const page = await browserInstance.newPage({ viewport: { width: 1440, height: 1800 } });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await ensureVisible(page);

      // Gold tab is usually shown first; still click it explicitly.
      await clickByText(page, 'GOLD COIN');
      await page.waitForTimeout(1000);
      const goldRows = parseRows(await extractRows(page, 'GOLD COIN'));

      await clickByText(page, 'SILVER COIN');
      await page.waitForTimeout(1000);
      const silverRows = parseRows(await extractRows(page, 'SILVER COIN'));

      const payload = { gold: goldRows, silver: silverRows };
      onResult && onResult(payload);
      return payload;
    } catch (err) {
      onError && onError(err);
      throw err;
    } finally {
      try { await page.close(); } catch (_) {}
    }
  }

  return {
    scrape,
    stop: async () => {
      if (browser) {
        try { await browser.close(); } catch (_) {}
        browser = null;
      }
    },
  };
}

module.exports = { createRightGoldCollector };
