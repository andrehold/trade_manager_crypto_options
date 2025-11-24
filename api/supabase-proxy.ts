export const config = { runtime: "edge" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type ProxyInit = {
  method?: string;
  headers?: [string, string][];
  body?: string | null;
};

type ProxyRequest = {
  url?: string;
  init?: ProxyInit;
};

function withCors(headers: HeadersInit = {}) {
  const h = new Headers(headers);
  Object.entries(corsHeaders).forEach(([key, value]) => h.set(key, value));
  return h;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: withCors() });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: withCors() });
  }

  let payload: ProxyRequest;
  try {
    payload = (await req.json()) as ProxyRequest;
  } catch (err) {
    console.error("Failed to parse supabase proxy payload", err);
    return new Response("Invalid JSON", { status: 400, headers: withCors() });
  }

  const targetUrl = payload.url?.trim();
  if (!targetUrl) {
    return new Response("Missing target URL", { status: 400, headers: withCors() });
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.replace(/\/$/, "");
  if (!supabaseUrl || !targetUrl.startsWith(supabaseUrl)) {
    return new Response("Target URL is not allowed", { status: 400, headers: withCors() });
  }

  const headers = new Headers(payload.init?.headers ?? []);
  const forwardInit: RequestInit = {
    ...payload.init,
    headers,
  };

  const upstreamResponse = await fetch(targetUrl, forwardInit);
  const responseHeaders = withCors(upstreamResponse.headers);
  const body = await upstreamResponse.arrayBuffer();

  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
