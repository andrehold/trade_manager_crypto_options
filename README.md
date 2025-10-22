# Trade Manager — Crypto Options

A lightweight web app to import options transactions (CSV), group legs into trade kits, fetch **live marks & greeks** from **Coincall** and **Deribit**, and compute PnL at leg and kit level.

<p align="center">
  <a href="./api/deribit/ticker.ts"><code>api/deribit/ticker.ts</code></a> ·
  <a href="./api/coincall/price.ts"><code>api/coincall/price.ts</code></a> ·
  <a href="./src/lib/venues/deribit.ts"><code>src/lib/venues/deribit.ts</code></a> ·
  <a href="./src/lib/venues/coincall.ts"><code>src/lib/venues/coincall.ts</code></a> ·
  <a href="./src/components/ColumnMapper.tsx"><code>ColumnMapper.tsx</code></a> ·
  <a href="./src/components/ReviewOverlay.tsx"><code>ReviewOverlay.tsx</code></a> ·
  <a href="./src/components/PositionRow.tsx"><code>PositionRow.tsx</code></a> ·
  <a href="./src/App.tsx"><code>App.tsx</code></a> ·
  <a href="./vite.config.ts"><code>vite.config.ts</code></a>
</p>

---

## ✨ Features
- CSV import with column mapping (Deribit, Coincall, CME starter presets)
- Line filtering (auto-exclude timestamps ending **08:00:00**; manual include/exclude)
- Kit assignment in the review overlay (e.g., legs 1–4 → kit #1, 5–6 → kit #2)
- **Single** “Get Live Marks” button fetching Coincall **and** Deribit
- Leg/Kit **Mark**, **uPnL**, and **Greeks** (Gamma with 6 decimals)
- Progress bar + counts during fetch (done/total/errors)

---

## 🧱 Architecture
**Frontend:** Vite + React (TypeScript)  
**Live data:** explicit **Vercel Edge functions** (no catch-alls)

- **Deribit** → `GET /api/deribit/ticker?instrument_name=<INSTR>`
  - Edge: [`api/deribit/ticker.ts`](./api/deribit/ticker.ts)
  - Client: [`src/lib/venues/deribit.ts`](./src/lib/venues/deribit.ts)
- **Coincall** → `GET /api/coincall/price?symbol=<SYMBOL>`  
  Aggregates detail + orderbook + last trade server-side; returns `{ price, multiplier, greeks }`
  - Edge: [`api/coincall/price.ts`](./api/coincall/price.ts)
  - Client: [`src/lib/venues/coincall.ts`](./src/lib/venues/coincall.ts)

Env switch in clients:
```ts
// Deribit
const DERIBIT_BASE = import.meta.env.PROD ? '/api/deribit' : '/deribit';
// Coincall
const COINCALL_BASE = import.meta.env.PROD ? '/api/coincall' : '/coincall';
```
- **Production (Vercel)**: calls `/api/*` (Edge functions).
- **Local dev**:
  - `vercel dev` → `/api/*` works locally
  - `vite` dev → falls back to proxy (`/deribit`, `/coincall`) per [`vite.config.ts`](./vite.config.ts)

---

## ▶️ Local Development

### Option A — Vercel Dev (recommended)
```bash
npm i
vercel dev
# http://localhost:3000
```

### Option B — Vite Dev + Proxy
```bash
npm i
npm run dev
# http://localhost:5173
```
`vite.config.ts` should include:
```ts
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
},
```

---

## 🚀 Deploying to Vercel
1. Framework = **Vite**, Output = **dist**, Root Directory = **(empty)**.
2. Ensure:
   - [`api/deribit/ticker.ts`](./api/deribit/ticker.ts)
   - [`api/coincall/price.ts`](./api/coincall/price.ts)
3. After deploy → **Resources → Functions** should list:
   - `/api/deribit/ticker`
   - `/api/coincall/price`
4. Smoke test (replace domain):
   - `/api/deribit/ticker?instrument_name=BTC-27DEC25-50000-C`
   - `/api/coincall/price?symbol=BTCUSD-27DEC25-50000-C`

> Tip: promote a known-good preview to **Production**.

---

## 📥 CSV Mapping Presets

| Column (UI) | CSV field |
|---|---|
| Instrument | `instrument` (e.g., `BTC-27DEC25-50000-C`) |
| Side | `side` (`open buy`, `open sell`, `close buy`, `close sell`) |
| Amount | `amount` |
| Price | `price` |
| Timestamp | `date` |
| Trade ID | `Trade ID` |
| Order ID | `Order ID` |
| Info | `Info` |

Notes:
- It’s valid to **open by selling** an option (short open).
- Import overlay auto-excludes lines with timestamps ending `08:00:00`, then you can manually include/exclude lines.

---

## 🔤 Symbol Formats
- **Deribit**: `UNDERLYING-DMONYY-STRIKE-C|P` (day **without leading zero**)  
  e.g., `BTC-27DEC25-50000-C`
- **Coincall**: `UNDERLYINGUSD-DMONYY-STRIKE-C|P` (day **without leading zero**)  
  e.g., `BTCUSD-27DEC25-50000-C`

Tip: hover the **Mark** cell to copy the exact instrument/symbol.

---

## 📈 Live Marks, Greeks & PnL
- **Get Live Marks** fetches both venues with a progress bar (`done/total • errors`).
- **Deribit**: mark + greeks; multiplier = `1`.
- **Coincall**: mark + greeks + multiplier from `/api/coincall/price`.

**PNL**
- Opening sell → negative qty; opening buy → positive qty.
- uPnL (per leg) = `(mark − entryPrice) × qty × multiplier`.
- Net Premium (per leg) = `entryPrice × qty`.  
  (Kit totals aggregate legs.)

**Greeks**
- Gamma shown with **6 decimals**. Adjust in helpers (`src/utils.ts`).

---

## 🔎 Diagnostics
- **HTML 404 (Vercel)** → you’re on a deploy missing the function. Use that deploy’s **Visit** URL and confirm **Resources → Functions**.
- **Coincall `{ code: 40034 }`** → symbol not found (routing OK). Check day (no leading zero) + `USD` suffix.
- DevTools → Network (while fetching) should show only:
  - `/api/deribit/ticker?...`
  - `/api/coincall/price?symbol=...`

---

## 📂 File Map
- Edge routes: [`api/deribit/ticker.ts`](./api/deribit/ticker.ts), [`api/coincall/price.ts`](./api/coincall/price.ts)  
- Clients: [`src/lib/venues/deribit.ts`](./src/lib/venues/deribit.ts), [`src/lib/venues/coincall.ts`](./src/lib/venues/coincall.ts)  
- UI: [`src/App.tsx`](./src/App.tsx), [`src/components/ColumnMapper.tsx`](./src/components/ColumnMapper.tsx), [`src/components/ReviewOverlay.tsx`](./src/components/ReviewOverlay.tsx), [`src/components/PositionRow.tsx`](./src/components/PositionRow.tsx)  
- Tooling: [`vite.config.ts`](./vite.config.ts)

---

## 🛠 Scripts
```bash
npm run dev     # vite dev (with proxy)
vercel dev      # dev server + /api routes locally
npm run build   # vite build → dist
```

---

## License
MIT
