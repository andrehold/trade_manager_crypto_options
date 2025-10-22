// src/lib/venues/deribit.ts
export type DeribitTicker = {
    mark_price?: number;
    last_price?: number;
    best_bid_price?: number;
    best_ask_price?: number;
    greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number };
  };
  
  export async function dbGetTicker(instrument: string): Promise<DeribitTicker | null> {
    // Use Vite dev proxy locally, Vercel serverless route in prod
    const BASE = import.meta.env.PROD ? '/api/deribit' : '/deribit';
    const url = `${BASE}/public/ticker?instrument_name=${encodeURIComponent(instrument)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result ?? null;
  }
  
  /** Best available: mark_price -> mid(bid/ask) -> last_price. Multiplier ~ 1. */
  export async function dbGetBest(instrument: string): Promise<{ price: number | null; multiplier: number | null; greeks?: DeribitTicker['greeks'] }> {
    const t = await dbGetTicker(instrument);
    if (!t) return { price: null, multiplier: 1, greeks: undefined };
    let price = t.mark_price ?? null;
    if (price == null && t.best_bid_price != null && t.best_ask_price != null) {
      price = (t.best_bid_price + t.best_ask_price) / 2;
    }
    if (price == null) price = t.last_price ?? null;
    return { price, multiplier: 1, greeks: t.greeks };
  }