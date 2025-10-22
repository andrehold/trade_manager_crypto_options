# Deploying to Vercel

This app uses **explicit Vercel Edge routes** for live data and a Vite proxy for local development.

## Required files
- `api/deribit/ticker.ts` — proxies `public/ticker` to Deribit and returns upstream JSON.
- `api/coincall/price.ts` — aggregates Coincall detail + orderbook + last trade and returns `{ price, multiplier, greeks }`.

## Project settings
- Framework preset: **Vite**
- Output directory: **dist**
- Root directory: **(empty)** (repo root)

## Build & verify
1) Push to your repo and open the Vercel deployment page.  
2) **Resources → Functions** should list:
   - `/api/deribit/ticker`
   - `/api/coincall/price`
3) Test in the browser (replace domain):
   ```
   https://<your-app>.vercel.app/api/deribit/ticker?instrument_name=BTC-27DEC25-50000-C
   https://<your-app>.vercel.app/api/coincall/price?symbol=BTCUSD-27DEC25-50000-C
   ```
4) In the app → DevTools → Network while clicking **Get Live Marks** you should see those same two endpoints.

## Local development
### Option A — `vercel dev` (preferred)
Runs the app and Edge functions locally under `/api`.
```bash
npm i
vercel dev
```

### Option B — `npm run dev` (vite proxy)
If you only use Vite dev, the client falls back to proxies:
```ts
// vite.config.ts
server: {
  proxy: {
    '/coincall': {
      target: 'https://api.coincall.com',
      changeOrigin: true,
      rewrite: p => p.replace(/^\/coincall/, ''),
    },
    '/deribit': {
      target: 'https://www.deribit.com/api/v2',
      changeOrigin: true,
      rewrite: p => p.replace(/^\/deribit/, ''),
    },
  },
}
```

## Troubleshooting
**404 (HTML) from Vercel**  
→ You’re hitting a deployment that doesn’t include the function. Use that deployment’s **Visit** URL and confirm the route exists under **Resources → Functions**.

**Coincall `{ code: 40034 }`**  
→ Symbol string doesn’t exist (routing OK). Ensure `DDMONYY` **without leading zero** for day and `USD` suffix. Example: `BTCUSD-27DEC25-50000-C`.

**Deribit “instrument not found”**  
→ Instrument format: `UNDERLYING-DMONYY-STRIKE-C|P`, day **without leading zero**. Example: `BTC-27DEC25-50000-C`.

**Symbols from the UI**  
→ Hover the **Mark** cell in the table to copy the exact symbol/instrument queried.

## Production domains
Promote a known-good preview to **Production** so your main domain always points to a stable commit with both Edge routes.
