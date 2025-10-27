// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  throw new Error(
    `Missing Supabase envs: have URL? ${!!url} / have key? ${!!key}`
  );
}

export const supabase = createClient(
  url,
  key,
  {
    auth: {
      persistSession: true,         // keep the user logged in across refreshes
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);