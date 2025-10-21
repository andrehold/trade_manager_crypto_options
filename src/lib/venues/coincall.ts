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

export async function ccGetDetail(symbol: string): Promise<CoincallDetail | null> {
  const res = await fetch(`/api/coincall/open/option/detail/v1/${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  const json = await res.json();
  const d = json?.data;
  if (!d) return null;
  return {
    markPrice: d.markPrice != null ? +d.markPrice : undefined,
    lastPrice: d.lastPrice != null ? +d.lastPrice : undefined,
    multiplier: d.multiplier != null ? +d.multiplier : undefined,
    delta: d.delta != null ? +d.delta : undefined,
    gamma: d.gamma != null ? +d.gamma : undefined,
    theta: d.theta != null ? +d.theta : undefined,
    vega: d.vega != null ? +d.vega : undefined,
    rho: d.rho != null ? +d.rho : undefined,
  };
}

export async function ccGetOrderbook(symbol: string): Promise<number | null> {
  const res = await fetch(`/api/coincall/open/option/order/orderbook/v1/${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  const json = await res.json();
  const bid = +(json?.data?.bids?.[0]?.price ?? 0);
  const ask = +(json?.data?.asks?.[0]?.price ?? 0);
  if (bid && ask) return (bid + ask) / 2;
  return bid || ask || null;
}

export async function ccGetLast(symbol: string): Promise<number | null> {
  const res = await fetch(`/api/coincall/open/option/trade/lasttrade/v1/${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  const json = await res.json();
  const p = json?.data?.[0]?.price;
  return p != null ? +p : null;
}

/** Best available price + greeks from detail; fall back for price if needed. */
export async function ccGetBest(symbol: string): Promise<{
  price: number | null;
  multiplier: number | null;
  greeks: { delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number };
}> {
  const d = await ccGetDetail(symbol); // includes greeks + multiplier (when available)
  let price = d?.markPrice ?? null;
  if (price == null) price = await ccGetOrderbook(symbol);
  if (price == null) price = await ccGetLast(symbol);
  return {
    price,
    multiplier: d?.multiplier ?? null,
    greeks: {
      delta: d?.delta,
      gamma: d?.gamma,
      theta: d?.theta,
      vega: d?.vega,
      rho: d?.rho,
    },
  };
}
  