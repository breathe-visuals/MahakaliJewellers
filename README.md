# Mahakali Jewellers Live Rate Web App

Three-page live rate site for:

- Gold page sourced from Gopnath
- Silver page sourced from Swayam
- Coin page sourced from the Right Gold coin iframe

## Local run

```bash
npm install
npm start
```

Open:

- http://localhost:3000

## Render settings

Build command:

```bash
npm install
```

Start command:

```bash
node server.js
```

## Notes

- The app uses your own Node.js server and Socket.IO for live updates.
- Upstream source branding stays hidden from the frontend.
- The coin collector uses Playwright, and `postinstall` downloads Chromium automatically.
- If you want to point the coin collector somewhere else, set `RIGHTGOLD_URL`.
