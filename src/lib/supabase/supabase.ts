// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  throw new Error(
    `Missing Supabase envs: have URL? ${!!url} / have key? ${!!key}`
  );
}

// DEBUG: log the outgoing headers on every request
const loggingFetch: typeof fetch = async (input, init) => {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const hdrs = new Headers(init?.headers);
  console.log('[supabase →]', urlStr, {
    apikey: hdrs.get('apikey') ? '(present)' : '(missing)',
    authorization: hdrs.get('authorization') ? '(present)' : '(missing)',
  });
  const res = await fetch(input as RequestInfo, init as RequestInit);
  console.log('[supabase ←]', res.status, res.url);
  return res;
};

export const supabase = createClient(
  url,
  key,
  {
    global: { 
      fetch: loggingFetch,
      headers: { apikey: key, Authorization: `Bearer ${key}` },
     }, // wrap all supabase-js network calls
    auth: {
      persistSession: true,         // keep the user logged in across refreshes
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);