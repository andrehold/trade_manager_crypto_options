export const config = { runtime: "nodejs" };

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

  // Forward only what a proxy needs. Spreading payload.init carried a JSON-serialized
  // signal ({}), which the edge fetch rejects — the real cause of the login failure.
  const headers = new Headers(payload.init?.headers ?? []);
  const forwardInit: RequestInit = {
    method: payload.init?.method ?? "GET",
    headers,
    body: payload.init?.body ?? null,
  };

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl, forwardInit);
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: unknown; stack?: string };
    const cause = e?.cause as { code?: string; message?: string } | undefined;
    // diag: temporary — surface the real fetch failure in the response + logs
    const detail = JSON.stringify({
      targetUrl,
      method: forwardInit.method,
      hasBody: forwardInit.body != null,
      name: e?.name,
      message: e?.message,
      causeCode: cause?.code,
      causeMessage: cause?.message ?? (e?.cause != null ? String(e.cause) : undefined),
    });
    console.error("Supabase upstream fetch failed", detail, e?.stack);
    return new Response("Upstream request failed: " + detail, { status: 502, headers: withCors() });
  }

  const responseHeaders = withCors(upstreamResponse.headers);
  // Body is auto-decompressed, so upstream content-length/-encoding no longer match it;
  // leaving them makes the edge runtime reject the response (FUNCTION_INVOCATION_FAILED).
  ["content-length", "content-encoding", "transfer-encoding", "connection"].forEach((h) =>
    responseHeaders.delete(h),
  );
  const body = await upstreamResponse.arrayBuffer();

  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
