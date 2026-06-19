# Mahakali Jewellers – Live Rates

Live gold and silver bullion rate dashboard for Mahakali Jewellers.

## Setup

```bash
npm install
npm start
```

Open: http://localhost:3000

## Architecture

Built on the Reference (Dharamraj) socket architecture — unchanged.

- `server.js` — Express + Socket.IO server, connects to Gopnath (gold) and Swayam (silver) feeds
- `public/index.html` — 3-page SPA (Gold, Silver, Coins)
- `public/app.js` — Socket.IO client, all rendering logic
- `public/styles.css` — Design system (#003336 brand, #D9B25F gold)
- `public/sw.js` — Service worker (shell cache only, never caches live rates)

## Pages

- **Gold** — Karat rates (24K–9K), Gold Product Table, Market Rates (Future/Spot slider)
- **Silver** — Silver Product Table only
- **Coins** — Gold Coin 999 rates + Silver Coin 999 rates (tabbed)

## Data Sources

Gold data → Gopnath feed  
Silver data → Swayam feed  
All updates via WebSocket only — no polling, no API refresh.
