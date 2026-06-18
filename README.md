# Mahakali Jewellers Live Rate Web App

This project is a Render-ready live rate dashboard with three pages:

- Gold
- Silver
- Coin

It uses a hidden relay backend so visitors only see your Mahakali domain.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Render settings

- Service type: Web Service
- Runtime: Node
- Build command: `npm install`
- Start command: `node server.js`
- Node version: `20.x`

## Environment variables

Optional overrides:

- `PORT` — Render sets this automatically
- `GOPNATH_SOCKET_URL`
- `GOPNATH_ROOM`
- `SWAYAM_SOCKET_URL`
- `SWAYAM_ROOM`
- `RIGHTGOLD_URL`
- `SOURCE_REFRESH_MS`

## Media folder

Put all favicons, logo files, manifest, and app icons inside `Media/`.

Suggested files:

- `favicon.ico`
- `favicon-16x16.png`
- `favicon-32x32.png`
- `apple-touch-icon.png`
- `android-chrome-192x192.png`
- `android-chrome-512x512.png`
- `site.webmanifest`
- your logo image

## Notes

- Gold prices are calculated from the `IMP GOLD RTGS` base rate.
- Silver uses the Swayam feed.
- Coin prices are pulled from Right Gold coin-rate content and shown on the coin page.
- The frontend uses batched DOM updates to reduce jerking.
