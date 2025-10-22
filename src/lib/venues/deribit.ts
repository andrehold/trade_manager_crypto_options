// Pick the right base: Vite proxy locally, Vercel function in prod
const BASE = import.meta.env.PROD ? "/api/deribit" : "/deribit";

export type DeribitGreeks = {
  delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number;
};

export async function dbGetBest(instrument: string): Promise<{
  price: number | null;
  multiplier: number | null;
  greeks?: DeribitGreeks;
}> {
  // ✅ explicit route
  const res = await fetch(`${BASE}/ticker?instrument_name=${encodeURIComponent(instrument)}`);
  if (!res.ok) return { price: null, multiplier: 1 };

  const json = await res.json();
  // Our Edge function proxies Deribit’s payload unchanged:
  // { jsonrpc: "2.0", result: { mark_price, best_bid_price, best_ask_price, last_price, greeks, ... } }
  const t = json?.result ?? json;

  let price = t?.mark_price ?? null;
  if (price == null && t?.best_bid_price != null && t?.best_ask_price != null) {
    price = (t.best_bid_price + t.best_ask_price) / 2;
  }
  if (price == null) price = t?.last_price ?? null;

  return { price, multiplier: 1, greeks: t?.greeks };
}
