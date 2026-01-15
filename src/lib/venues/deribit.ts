// src/lib/venues/deribit.ts
// Tiny Deribit client that uses the explicit Vercel route in prod,
// and your Vite dev proxy in local development.

export type DeribitGreeks = {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
};

export type DeribitTickerResult = {
  instrument_name: string;
  index_price?: number;
  mark_price?: number;
  best_bid_price?: number;
  best_ask_price?: number;
  last_price?: number;
  greeks?: DeribitGreeks;
};

// Deribit returns { jsonrpc: "2.0", result: { ... } }
// Our Edge function may also just return the result directly.
// We handle both.
type DeribitTickerEnvelope = {
  result?: DeribitTickerResult;
  [k: string]: any;
};

// NEW: pick the right base per environment
const BASE = import.meta.env.PROD ? "/api/deribit" : "/deribit";

/** Low-level ticker fetch. In prod this hits /api/deribit/ticker, in dev it uses the Vite proxy. */
export async function dbGetTicker(instrument: string): Promise<DeribitTickerResult | null> {
  const url = `${BASE}/ticker?instrument_name=${encodeURIComponent(instrument)}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const json: DeribitTickerEnvelope = await res.json();
  // Accept both shapes: { result: {...} } and direct {...}
  const result = (json && json.result) ? json.result : (json as unknown as DeribitTickerResult);
  return result ?? null;
}

/**
 * High-level helper: best available price + greeks.
 * Price preference: mark_price -> mid(bid/ask) -> last_price.
 * Multiplier: treat as 1 for Deribit options.
 */
export async function dbGetBest(instrument: string): Promise<{
  price: number | null;
  multiplier: number | null;
  greeks?: DeribitGreeks;
}> {
  const t = await dbGetTicker(instrument);
  if (!t) return { price: null, multiplier: 1 };

  let price = t.mark_price ?? null;
  if (price == null && t.best_bid_price != null && t.best_ask_price != null) {
    price = (t.best_bid_price + t.best_ask_price) / 2;
  }
  if (price == null) price = t.last_price ?? null;

  return { price, multiplier: 1, greeks: t.greeks };
}
