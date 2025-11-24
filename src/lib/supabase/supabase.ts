// src/lib/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function createSupabaseFetchProxy(supabaseUrl: string) {
  const normalizedUrl = supabaseUrl.replace(/\/$/, "");

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof window === "undefined") return fetch(input, init);

    const targetUrl = typeof input === "string" ? input : input.url;
    if (!targetUrl.startsWith(normalizedUrl)) return fetch(input, init);

    const serializedHeaders = Array.from(new Headers(init?.headers ?? {}).entries());

    return fetch("/api/supabase-proxy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: targetUrl,
        init: {
          ...init,
          headers: serializedHeaders,
        },
      }),
    });
  };
}

let cachedClient: SupabaseClient | null | undefined;

function initClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

  if (!url || !key) {
    if (import.meta.env.DEV) {
      console.warn(
        "Supabase environment variables are not configured. Features that rely on Supabase will be disabled."
      );
    }
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(url, key, {
    global: { fetch: createSupabaseFetchProxy(url) },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return cachedClient;
}

export function tryGetSupabaseClient(): SupabaseClient | null {
  return initClient();
}

export function hasSupabaseClient(): boolean {
  return initClient() !== null;
}

export function getSupabaseClient(): SupabaseClient {
  const client = initClient();
  if (!client) {
    throw new Error(
      "Supabase client is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable this feature."
    );
  }
  return client;
}
export const supabase = initClient();
