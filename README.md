# Mahakali Jewellers Live Rate Web App

A Render-ready full stack live bullion website based on the Dharamraj Silver Arts architecture.

## What this app does
- Pulls gold live rates from Gopnath
- Pulls silver live rates from Swayam
- Pulls coin rates from Right Gold
- Calculates 24K, 22K, 21K, 20K, 18K, 14K, 10K and 9K from the master gold rate
- Keeps provider sources hidden from the frontend

## Run locally
```bash
npm install
npm start
```

Open:
`http://localhost:3000`

## Environment variables
You can run with defaults first, then customize if needed:

- `PORT` = server port
- `GOPNATH_SOCKET_URL` = provider socket URL
- `GOPNATH_ROOM` = provider room name
- `SWAYAM_SOCKET_URL` = provider socket URL
- `SWAYAM_ROOM` = provider room name
- `RIGHTGOLD_URL` = Right Gold live-rate page
- `RIGHTGOLD_POLL_MS` = polling interval in milliseconds
- `MARKET_SOURCE` = `gopnath` or `swayam`
- `ENABLE_DEMO_FALLBACK` = `true` to show sample values when feeds are offline

## Notes
- The frontend only talks to your own server.
- Provider names are not shown to users.
- The `Media/` folder is where you can place your logo and favicons.
