// src/lib/venues/coincall.ts

export type CoincallDetail = {
  markPrice?: number;
  lastPrice?: number;
  multiplier?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
};

export type CCGreeks = {
  delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number;
};

type PricePayload = {
  price: number | null;
  multiplier: number | null;
  greeks?: CCGreeks;
};

// --- Base helpers ------------------------------------------------------------

// In production we always call our Edge function under /api.
// In dev: prefer /api if you're running `vercel dev`; otherwise fall back to Vite proxy (/coincall).
const API_BASE = import.meta.env.PROD ? '/api/coincall' : '/api/coincall';
const RAW_BASE = import.meta.env.PROD ? '/api/coincall' : '/coincall';

async function getJSON<T = any>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

// --- Explicit aggregator (recommended) --------------------------------------

// Calls your Edge route: /api/coincall/price?symbol=...
// Returns { price, multiplier, greeks } in one hop.
async function ccGetPrice(symbol: string): Promise<PricePayload | null> {
  const url = `${API_BASE}/price?symbol=${encodeURIComponent(symbol)}`;
  const j = await getJSON<PricePayload>(url);
  if (!j) return null;
  // Ensure we always return the three keys
  return {
    price: j.price ?? null,
    multiplier: j.multiplier ?? null,
    greeks: j.greeks,
  };
}

// --- Legacy raw endpoints (fallbacks for dev / resilience) ------------------

export async function ccGetDetail(symbol: string): Promise<CoincallDetail | null> {
  const url = `${RAW_BASE}/open/option/detail/v1/${encodeURIComponent(symbol)}`;
  const j = await getJSON<any>(url);
  const d = j?.data;
  if (!d) return null;
  return {
    markPrice: d.markPrice ?? undefined,
    lastPrice: d.lastPrice ?? undefined,
    multiplier: d.multiplier ?? undefined,
    delta: d.delta ?? undefined,
    gamma: d.gamma ?? undefined,
    theta: d.theta ?? undefined,
    vega: d.vega ?? undefined,
    rho: d.rho ?? undefined,
  };
}

async function ccGetOrderbook(symbol: string): Promise<number | null> {
  const url = `${RAW_BASE}/open/option/order/orderbook/v1/${encodeURIComponent(symbol)}`;
  const j = await getJSON<any>(url);
  const b = j?.data?.bids?.[0]?.price ?? 0;
  const a = j?.data?.asks?.[0]?.price ?? 0;
  if (b && a) return (b + a) / 2;
  return b || a || null;
}

async function ccGetLast(symbol: string): Promise<number | null> {
  const url = `${RAW_BASE}/open/option/trade/lasttrade/v1/${encodeURIComponent(symbol)}`;
  const j = await getJSON<any>(url);
  return j?.data?.[0]?.price ?? null;
}

// --- Unified surface used by the app ----------------------------------------

export async function ccGetBest(symbol: string): Promise<{
  price: number | null;
  multiplier: number | null;
  greeks?: CCGreeks;
}> {
  // 1) Try the explicit Edge route first (works on Vercel and also in `vercel dev`)
  const agg = await ccGetPrice(symbol);
  if (agg && (agg.price != null || agg.greeks || agg.multiplier != null)) {
    return agg;
  }

  // 2) Fallback chain for local dev without the /api route:
  const d = await ccGetDetail(symbol); // includes markPrice, greeks, multiplier
  let price: number | null = d?.markPrice ?? null;
  if (price == null) price = await ccGetOrderbook(symbol);
  if (price == null) price = await ccGetLast(symbol);

  return {
    price,
    multiplier: d?.multiplier ?? null,
    greeks: d
      ? {
          delta: d.delta,
          gamma: d.gamma,
          theta: d.theta,
          vega: d.vega,
          rho: d.rho,
        }
      : undefined,
  };
}
