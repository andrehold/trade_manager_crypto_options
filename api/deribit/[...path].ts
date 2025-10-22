export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const target =
    'https://www.deribit.com/api/v2' +
    url.pathname.replace(/^\/api\/deribit/, '') +
    url.search;

  const upstream = await fetch(target, { headers: { accept: 'application/json' } });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 's-maxage=15, stale-while-revalidate=60',
    },
  });
}
