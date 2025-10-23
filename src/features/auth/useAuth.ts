// src/features/auth/useAuth.ts
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function useAuth() {
  const [user, setUser] = useState<Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"]>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!ignore) setUser(user ?? null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      ignore = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

// somewhere in your UI
// const { user } = useAuth();
// await supabase.auth.signInWithOtp({ email });
// await supabase.auth.signOut();
