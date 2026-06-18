const { chromium } = require('playwright');

const URLS = [
  process.env.RIGHTGOLD_COIN_URL || 'https://chawlajewellers.com/coinrate-iframe',
  'https://chawlajewellers.com/coinrate',
  'https://chawlajewellers.com/',
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parsePrice(text) {
  const cleaned = normalize(text).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 100 ? n : null;
}

function classify(name) {
  return /silver/i.test(name) ? 'silver' : 'gold';
}

function splitCoins(rows) {
  const goldCoins = [];
  const silverCoins = [];
  const seen = new Set();

  for (const row of rows) {
    const name = normalize(row.name);
    const price = row.price;

    if (!name || price === null || !Number.isFinite(price)) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const item = { name, price };
    if (classify(name) === 'silver') silverCoins.push(item);
    else goldCoins.push(item);
  }

  return { goldCoins, silverCoins };
}

async function scrapeFromUrl(url) {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1600 },
    userAgent: USER_AGENT,
  });

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForTimeout(5000);

    await page.waitForSelector('tr.ligh-white, td.p-h.ph.product-rate', {
      timeout: 15000,
    });

    const rows = await page.$$eval('tr.ligh-white', (trs) =>
      trs.map((tr) => {
        const nameEl = tr.querySelector('h3');
        const priceEl = tr.querySelector('.product-rate .bgm, .bgm.e, .bgm');

        const name = nameEl ? nameEl.textContent : '';
        const priceText = priceEl ? priceEl.textContent : '';

        return { name, priceText };
      })
    );

    const parsedRows = rows
      .map((row) => ({
        name: normalize(row.name),
        price: parsePrice(row.priceText),
      }))
      .filter((row) => row.name && row.price !== null);

    const { goldCoins, silverCoins } = splitCoins(parsedRows);

    console.log(
      `[coins] url=${url} rows=${parsedRows.length} gold=${goldCoins.length} silver=${silverCoins.length}`
    );

    return {
      goldCoins,
      silverCoins,
      updatedAt: new Date().toISOString(),
      sourceUrl: url,
    };
  } finally {
    await page.close().catch(() => { });
  }
}

async function scrapeCoins() {
  let lastError = null;

  for (const url of URLS) {
    try {
      const result = await scrapeFromUrl(url);
      if (result.goldCoins.length || result.silverCoins.length) {
        return result;
      }
    } catch (err) {
      lastError = err;
      console.log(`[coins] scrape failed for ${url}:`, err?.message || err);
    }
  }

  throw lastError || new Error('No coin data found on any URL');
}

module.exports = { scrapeCoins };