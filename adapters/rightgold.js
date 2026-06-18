const axios = require('axios');
const cheerio = require('cheerio');

const DEFAULT_COIN_URL =
  process.env.RIGHTGOLD_COIN_URL ||
  'https://chawlajewellers.com/coinrate-iframe';

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parsePrice(text) {
  const cleaned = normalize(text).replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function scrapeCoins() {
  const { data } = await axios.get(DEFAULT_COIN_URL, {
    timeout: 25000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://chawlajewellers.com/',
    },
  });

  const $ = cheerio.load(data);
  const goldCoins = [];
  const silverCoins = [];
  const seen = new Set();

  // Strategy 1: rows with class ligh-white (original selector)
  $('tr.ligh-white').each((_, row) => {
    const name = normalize($(row).find('h3').first().text()) ||
                 normalize($(row).find('td').first().text());
    const priceText = $(row).find('.product-rate .bgm, .bgm, .bgm.e').first().text();
    const price = parsePrice(priceText);

    if (!name || price === null) return;

    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const item = { name, price };
    if (/silver/i.test(name)) {
      silverCoins.push(item);
    } else {
      goldCoins.push(item);
    }
  });

  // Strategy 2: generic table rows if Strategy 1 found nothing
  if (!goldCoins.length && !silverCoins.length) {
    $('table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 2) return;

      const name  = normalize(cells.eq(0).text());
      const price = parsePrice(cells.eq(cells.length - 1).text()) ||
                    parsePrice(cells.eq(1).text());

      if (!name || price === null || !/coin/i.test(name)) return;

      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      const item = { name, price };
      if (/silver/i.test(name)) {
        silverCoins.push(item);
      } else {
        goldCoins.push(item);
      }
    });
  }

  // Strategy 3: elements containing price-like numbers near coin names
  if (!goldCoins.length && !silverCoins.length) {
    $('[class*="product"], [class*="coin"], [class*="rate"]').each((_, el) => {
      const text = normalize($(el).text());
      if (!/coin/i.test(text)) return;

      const nameMatch  = text.match(/([A-Za-z0-9 ]+coin[A-Za-z0-9 ]*)/i);
      const priceMatch = text.match(/[\d,]+(?:\.\d+)?/g);

      if (!nameMatch || !priceMatch) return;

      const name  = normalize(nameMatch[0]);
      const price = parsePrice(priceMatch[priceMatch.length - 1]);

      if (!name || price === null) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      const item = { name, price };
      if (/silver/i.test(name)) {
        silverCoins.push(item);
      } else {
        goldCoins.push(item);
      }
    });
  }

  return {
    goldCoins,
    silverCoins,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { scrapeCoins };