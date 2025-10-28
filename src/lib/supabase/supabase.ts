// src/lib/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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