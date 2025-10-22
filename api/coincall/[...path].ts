export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const upstreamPath = url.pathname.replace(/^\/api\/coincall/, '');
  const target = 'https://api.coincall.com' + upstreamPath + url.search;

  // DEBUG: prove the function matched & see the computed target
  if (url.searchParams.get('debug') === '1') {
    return new Response(
      JSON.stringify({ ok: true, matched: true, upstreamPath, target }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  const upstream = await fetch(target, { headers: { accept: 'application/json' } });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 's-maxage=15, stale-while-revalidate=60',
    },
  });
}