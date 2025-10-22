export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  // Strip the /api/deribit prefix and forward the rest to Deribit v2
  const upstreamPath = url.pathname.replace(/^\/api\/deribit/, '');
  const target = 'https://www.deribit.com/api/v2' + upstreamPath + url.search;
  
  const upstream = await fetch(target, { headers: { accept: 'application/json' } });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 's-maxage=15, stale-while-revalidate=60',
    },
  });
}