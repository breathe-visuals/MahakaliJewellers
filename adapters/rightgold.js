const { chromium } = require('playwright');

function parseNumber(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function clickTab(page, text) {
  const locators = [
    page.getByText(text, { exact: true }),
    page.locator(`button:has-text("${text}")`),
    page.locator(`a:has-text("${text}")`),
    page.locator(`li:has-text("${text}")`),
    page.locator(`div:has-text("${text}")`),
    page.locator(`span:has-text("${text}")`)
  ];

  for (const loc of locators) {
    try {
      if (await loc.first().count()) {
        await loc.first().click({ timeout: 2500 });
        return true;
      }
    } catch (_) {}
  }

  try {
    await page.evaluate((wanted) => {
      const els = Array.from(document.querySelectorAll('button,a,li,div,span'));
      const el = els.find((node) => (node.textContent || '').trim() === wanted);
      if (el) el.click();
    }, text);
    return true;
  } catch (_) {
    return false;
  }
}

async function readRows(page, coinKeyword) {
  return page.evaluate((needle) => {
    const rows = Array.from(document.querySelectorAll('tr'))
      .filter((tr) => tr.offsetParent !== null)
      .map((tr) => Array.from(tr.querySelectorAll('td,th')).map((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))
      .filter((cells) => cells.length >= 2 && cells.join(' ').toUpperCase().includes(needle));

    return rows;
  }, coinKeyword.toUpperCase());
}

function parseRows(rows, keyword) {
  const out = [];
  const seen = new Set();

  for (const cells of rows) {
    const joined = cells.join(' ').toUpperCase();
    if (!joined.includes(keyword.toUpperCase())) continue;

    const name = normalize(cells.find((c) => /COIN/i.test(c) && !/^(PRODUCT|PRICE|BUY|SELL)$/i.test(c)) || cells[0]);
    const priceCell = [...cells].reverse().find((c) => /[\d,]+/.test(c) && /\d/.test(c));
    const price = parseNumber(priceCell);

    const key = `${name}|${price}`;
    if (!name || price == null || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, price });
  }

  return out;
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
    let page;
    try {
      const b = await ensureBrowser();
      page = await b.newPage({ viewport: { width: 1440, height: 1800 } });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5000);

      const bodyText = await page.evaluate(() => document.body.innerText || '');
      if (!/COIN/i.test(bodyText)) {
        await page.waitForTimeout(2000);
      }

      await clickTab(page, 'GOLD COIN');
      await page.waitForTimeout(1200);
      const goldRows = await readRows(page, 'GOLD COIN');
      const gold = parseRows(goldRows, 'GOLD COIN');

      await clickTab(page, 'SILVER COIN');
      await page.waitForTimeout(1200);
      const silverRows = await readRows(page, 'SILVER COIN');
      const silver = parseRows(silverRows, 'SILVER COIN');

      onResult && onResult({ gold, silver });
      return { gold, silver };
    } catch (err) {
      onError && onError(err);
      throw err;
    } finally {
      if (page) {
        try { await page.close(); } catch (_) {}
      }
    }
  }

  return {
    start: scrape,
    scrape,
    stop: async () => {
      if (browser) {
        await browser.close();
        browser = null;
      }
    }
  };
}

module.exports = { createRightGoldCollector };
