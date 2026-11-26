// Classic Vercel Node serverless handler (NOT edge, NOT a web Request/Response
// handler): on the Node runtime Vercel ignores a returned Response, so we must
// write to `res`. The edge runtime, in turn, rejected the POST-with-body fetch
// to Supabase with an opaque "internal error". Node's global fetch proxies it fine.

type ProxyInit = {
  method?: string;
  headers?: [string, string][];
  body?: string | null;
};

type ProxyRequest = {
  url?: string;
  init?: ProxyInit;
};

type Req = { method?: string; body?: unknown };
type Res = {
  setHeader(name: string, value: string): void;
  status(code: number): Res;
  send(body: string | Buffer): void;
  end(): void;
};

const SKIP_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

function setCors(res: Res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: Req, res: Res): Promise<void> {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  // Vercel parses a JSON body into req.body; tolerate string/Buffer too.
  let payload: ProxyRequest;
  try {
    const raw = req.body;
    payload =
      raw && typeof raw === "object" && !Buffer.isBuffer(raw)
        ? (raw as ProxyRequest)
        : (JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "")) as ProxyRequest);
  } catch (err) {
    console.error("Failed to parse supabase proxy payload", err);
    res.status(400).send("Invalid JSON");
    return;
  }

  const targetUrl = payload.url?.trim();
  if (!targetUrl) {
    res.status(400).send("Missing target URL");
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)?.replace(/\/$/, "");
  if (!supabaseUrl || !targetUrl.startsWith(supabaseUrl)) {
    res.status(400).send("Target URL is not allowed");
    return;
  }

  const method = payload.init?.method ?? "GET";
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers: new Headers(payload.init?.headers ?? []),
      body: payload.init?.body ?? null,
      // Never hang forever: bound the upstream call so the client gets a 502
      // instead of a request that stays pending until the function times out.
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: unknown; stack?: string };
    const cause = e?.cause as { code?: string; message?: string } | undefined;
    // diag: temporary — surface the real fetch failure in the response + logs
    const detail = JSON.stringify({
      targetUrl,
      method,
      name: e?.name,
      message: e?.message,
      causeCode: cause?.code,
      causeMessage: cause?.message ?? (e?.cause != null ? String(e.cause) : undefined),
    });
    console.error("Supabase upstream fetch failed", detail, e?.stack);
    res.status(502).send("Upstream request failed: " + detail);
    return;
  }

  upstream.headers.forEach((value, key) => {
    if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
  });
  setCors(res); // ensure CORS wins over any forwarded header
  const body = Buffer.from(await upstream.arrayBuffer());
  res.status(upstream.status).send(body);
}
