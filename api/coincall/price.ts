// api/coincall/price.ts
export const config = { runtime: 'edge' };

type CCDetail = {
  code?: number;
  data?: {
    markPrice?: number;
    multiplier?: number;
    delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number;
  };
};

type CCOrderbook = {
  data?: { bids?: Array<{ price: number }>; asks?: Array<{ price: number }> };
};

type CCLastTrade = {
  data?: Array<{ price: number }>;
};

async function j(url: string) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol');
  if (!symbol) {
    return new Response(JSON.stringify({ error: 'missing symbol' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  const base = 'https://api.coincall.com';
  const [detail, ob, last] = await Promise.all([
    j(`${base}/open/option/detail/v1/${encodeURIComponent(symbol)}`) as Promise<CCDetail | null>,
    j(`${base}/open/option/order/orderbook/v1/${encodeURIComponent(symbol)}`) as Promise<CCOrderbook | null>,
    j(`${base}/open/option/trade/lasttrade/v1/${encodeURIComponent(symbol)}`) as Promise<CCLastTrade | null>,
  ]);

  const mark = detail?.data?.markPrice ?? null;

  const mid = (() => {
    const bid = ob?.data?.bids?.[0]?.price ?? 0;
    const ask = ob?.data?.asks?.[0]?.price ?? 0;
    return bid && ask ? (bid + ask) / 2 : (bid || ask || null);
  })();

  const lastPx = last?.data?.[0]?.price ?? null;

  const price = mark ?? mid ?? lastPx;

  const resp = {
    price,
    multiplier: detail?.data?.multiplier ?? null,
    greeks: detail?.data ? {
      delta: detail.data.delta ?? undefined,
      gamma: detail.data.gamma ?? undefined,
      theta: detail.data.theta ?? undefined,
      vega:  detail.data.vega  ?? undefined,
      rho:   detail.data.rho   ?? undefined,
    } : undefined,
  };

  return new Response(JSON.stringify(resp), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 's-maxage=15, stale-while-revalidate=60',
    },
  });
}