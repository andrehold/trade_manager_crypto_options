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

/** Low-level ticker fetch. In prod this hits /api/deribit/public/ticker, in dev it uses the Vite proxy. */
export async function dbGetTicker(instrument: string): Promise<DeribitTickerResult | null> {
  const url = `${BASE}/public/ticker?instrument_name=${encodeURIComponent(instrument)}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const json: DeribitTickerEnvelope = await res.json();
  // Accept both shapes: { result: {...} } and direct {...}
  const result = (json && json.result) ? json.result : (json as unknown as DeribitTickerResult);
  return result ?? null;
}

/**
 * Fetch all non-expired option instruments for a currency and return
 * deduplicated, sorted expiry dates as ISO strings ("YYYY-MM-DD").
 */
export async function dbGetInstruments(currency = 'BTC'): Promise<string[]> {
  try {
    const url = `${BASE}/public/get_instruments?currency=${encodeURIComponent(currency)}&kind=option&expired=false`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const instruments: Array<{ expiration_timestamp?: number }> = json?.result ?? [];
    const seen = new Set<string>();
    const expiries: string[] = [];
    for (const inst of instruments) {
      if (!inst.expiration_timestamp) continue;
      const iso = new Date(inst.expiration_timestamp).toISOString().slice(0, 10);
      if (!seen.has(iso)) {
        seen.add(iso);
        expiries.push(iso);
      }
    }
    return expiries.sort();
  } catch {
    return [];
  }
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
