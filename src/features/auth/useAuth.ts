// src/features/auth/useAuth.ts
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClient, hasSupabaseClient } from "@/lib/supabase";

export function useAuth() {
  const supabaseConfigured = hasSupabaseClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }

    const client = getSupabaseClient();
    let ignore = false;

    (async () => {
      try {
        const {
          data: { user },
        } = await client.auth.getUser();
        if (!ignore) setUser(user ?? null);
      } catch (error) {
        console.error("Failed to initialize Supabase auth", error);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      ignore = true;
      sub.subscription.unsubscribe();
    };
  }, [supabaseConfigured]);

  return { user, loading, supabaseConfigured };
}

// somewhere in your UI
// const { user } = useAuth();
// await supabase.auth.signInWithOtp({ email });
// await supabase.auth.signOut();
