import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

// Prefer the current Supabase secret key (sb_secret_…). Fall back to the
// legacy service_role env name so a deployment that hasn't renamed the
// variable yet keeps working. Both resolve to the service_role in Postgres.
function getSecretKey(): string {
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey) {
    throw new Error(
      "Missing environment variable: SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  return secretKey;
}

export function createServerSupabase(): SupabaseClient {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const secretKey = getSecretKey();

  return createClient(supabaseUrl, secretKey, {
    auth: {
      // Disable auto-refresh and session persistence in a server context.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
