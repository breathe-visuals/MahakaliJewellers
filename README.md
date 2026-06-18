# Mahakali Jewellers Live Rate Web App

Single-codebase live rate app for:

- Gold page (Gopnath)
- Silver page (Swayam)
- Coin page (Right Gold coin iframe)

## Run locally

```bash
npm install
node server.js
```

Open:

- http://localhost:3000

## Render settings

Build command:

```bash
npm install && npx playwright install chromium
```

Start command:

```bash
node server.js
```

## Important

The browser only talks to your own server over Socket.IO. Provider sources stay hidden.
