const axios = require('axios');
const cheerio = require('cheerio');

const URLS = [
  process.env.RIGHTGOLD_COIN_URL || 'https://chawlajewellers.com/coinrate-iframe',
  'https://chawlajewellers.com/coinrate',
  'https://chawlajewellers.com/',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parsePrice(text) {
  const cleaned = normalize(text).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 100 ? n : null; // coin prices are always >100
}

function classify(name) {
  return /silver/i.test(name) ? 'silver' : 'gold';
}

function extractFromHTML(html) {
  const $ = cheerio.load(html);
  const goldCoins = [];
  const silverCoins = [];
  const seen = new Set();

  function push(name, price) {
    name = normalize(name);
    if (!name || price === null) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    (classify(name) === 'silver' ? silverCoins : goldCoins).push({ name, price });
  }

  // Strategy A: tr.ligh-white rows (chawla layout)
  $('tr.ligh-white').each((_, row) => {
    const name = $(row).find('h3').first().text() || $(row).find('td').first().text();
    const priceText = $(row).find('.product-rate .bgm, .bgm.e, .bgm').first().text();
    push(name, parsePrice(priceText));
  });

  // Strategy B: any table with "COIN" in it
  if (!goldCoins.length && !silverCoins.length) {
    $('table').each((_, table) => {
      const tableText = $(table).text().toUpperCase();
      if (!tableText.includes('COIN')) return;
      $(table).find('tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;
        const name = cells.eq(0).text();
        if (!/coin/i.test(name)) return;
        const price = parsePrice(cells.last().text()) || parsePrice(cells.eq(1).text());
        push(name, price);
      });
    });
  }

  // Strategy C: elements with class containing "coin" or "product"
  if (!goldCoins.length && !silverCoins.length) {
    $('[class]').each((_, node) => {
      const cls = ($(node).attr('class') || '').toLowerCase();
      if (!cls.includes('coin') && !cls.includes('product')) return;
      const text = normalize($(node).text());
      if (!/coin/i.test(text)) return;
      const nameMatch = text.match(/\b[\w\s]+coin[\w\s]*/i);
      const nums = text.match(/\d[\d,]+/g);
      if (!nameMatch || !nums) return;
      push(nameMatch[0], parsePrice(nums[nums.length - 1]));
    });
  }

  return { goldCoins, silverCoins };
}

async function scrapeCoins() {
  let lastError = null;

  for (const url of URLS) {
    try {
      const { data } = await axios.get(url, { timeout: 20000, headers: HEADERS });
      const { goldCoins, silverCoins } = extractFromHTML(data);

      // Log for debugging
      const bodySnippet = String(data).slice(0, 500).replace(/\s+/g, ' ');
      console.log(`[coins] url=${url} gold=${goldCoins.length} silver=${silverCoins.length}`);
      if (!goldCoins.length && !silverCoins.length) {
        console.log('[coins] snippet:', bodySnippet);
      }

      if (goldCoins.length || silverCoins.length) {
        return { goldCoins, silverCoins, updatedAt: new Date().toISOString(), sourceUrl: url };
      }
    } catch (err) {
      lastError = err;
      console.log(`[coins] fetch error url=${url}:`, err?.message);
    }
  }

  throw lastError || new Error('No coin data found on any URL');
}

module.exports = { scrapeCoins };