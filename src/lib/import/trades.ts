// src/features/import/importTrades.ts
import { tryGetSupabaseClient } from "../supabase";
import { payloadSchema } from "./validation";
import type { ImportPayload } from "./types";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length < 2) return null;
  try {
    const payload = segments[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Failed to decode Supabase access token", error);
    }
    return null;
  }
}

type ImportTradesResult =
  | { ok: true; position_id: string }
  | { ok: false; error: string; details?: unknown };

export async function importTrades(payload: ImportPayload): Promise<ImportTradesResult> {
  const supabase = tryGetSupabaseClient();
  if (!supabase) {
    return {
      ok: false as const,
      error: "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable imports.",
    };
  }

  // 0) Validate
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false as const, error: "Invalid payload", details: parsed.error.flatten() };
  }
  const { program, venue, position, legs, fills } = parsed.data;

  // 1) Make sure user is signed in (RLS)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError && import.meta.env.DEV) {
    console.warn("Failed to retrieve Supabase session", sessionError);
  }

  const accessToken = session?.access_token ?? null;
  const supabaseUrl =
    (supabase as unknown as { supabaseUrl?: string }).supabaseUrl ??
    ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null);
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const restUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/rest/v1` : null;
  const authContext = {
    userId: user.id,
    hasAccessToken: Boolean(accessToken),
    accessTokenPreview: accessToken ? `${accessToken.slice(0, 10)}…${accessToken.slice(-6)}` : null,
    expiresAt: session?.expires_at ?? null,
    jwtClaims: accessToken ? decodeJwtPayload(accessToken) : null,
    supabaseUrl,
  };

  // 2) Upsert program
  {
    if (!restUrl || !supabaseKey) {
      const missingConfig = !restUrl
        ? "Supabase REST URL is not configured"
        : "Supabase publishable key is not configured";
      return {
        ok: false as const,
        error: missingConfig,
        details: { authContext, restUrl, hasSupabaseKey: Boolean(supabaseKey) },
      };
    }

    if (!accessToken) {
      return {
        ok: false as const,
        error:
          "Authenticated Supabase access token is not available. Verify the user session before retrying the import.",
        details: { authContext },
      };
    }

    const requestUrl = `${restUrl}/programs?on_conflict=program_id`;
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${accessToken}`,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(program),
    };
    const requestDebug = {
      url: requestUrl,
      method: requestInit.method,
      headers: {
        "Content-Type": "application/json",
        apikeyPreview: `${supabaseKey.slice(0, 6)}…${supabaseKey.slice(-4)}`,
        authorizationPreview: `Bearer ${accessToken.slice(0, 10)}…${accessToken.slice(-6)}`,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: program,
    };

    let response: Response;
    try {
      response = await fetch(requestUrl, requestInit);
    } catch (networkError) {
      const debugPayload = {
        authContext,
        request: requestDebug,
        response: null,
        networkError: networkError instanceof Error ? networkError.message : networkError,
      };
      const errorMessage = "Supabase programs upsert request failed before reaching the server";
      const errorWithRequest = `${errorMessage}\n${JSON.stringify(debugPayload, null, 2)}`;
      if (import.meta.env.DEV) {
        console.error(errorMessage, debugPayload);
      }
      return { ok: false as const, error: errorWithRequest, details: debugPayload };
    }

    if (!response.ok) {
      const responseBody = await response.text();
      const debugPayload = {
        authContext,
        request: requestDebug,
        response: {
          status: response.status,
          statusText: response.statusText,
          body: responseBody,
        },
      };

      if (response.status === 403) {
        const { data: programs, error: programLookupErr } = await supabase
          .from("programs")
          .select("program_id")
          .eq("program_id", program.program_id);

        if (programLookupErr) {
          const errorMessage =
            "Supabase programs upsert forbidden and existing program lookup failed";
          const errorWithRequest = `${errorMessage}\n${JSON.stringify(
            { ...debugPayload, programLookupErr },
            null,
            2,
          )}`;
          if (import.meta.env.DEV) {
            console.error(errorMessage, { ...debugPayload, programLookupErr });
          }
          return {
            ok: false as const,
            error: errorWithRequest,
            details: { ...debugPayload, programLookupErr },
          };
        }

        const programExists = Array.isArray(programs) && programs.length > 0;
        if (!programExists) {
          const errorMessage =
            "Supabase programs upsert forbidden and the referenced program does not exist";
          const errorWithRequest = `${errorMessage}\n${JSON.stringify(debugPayload, null, 2)}`;
          if (import.meta.env.DEV) {
            console.error(errorMessage, debugPayload);
          }
          return {
            ok: false as const,
            error: errorWithRequest,
            details: debugPayload,
          };
        }

        if (import.meta.env.DEV) {
          console.warn(
            "Supabase programs upsert forbidden; continuing because the program already exists",
            { ...debugPayload, programExists },
          );
        }
      } else {
        const errorMessage = `Supabase programs upsert failed (${response.status})`;
        const errorWithRequest = `${errorMessage}\n${JSON.stringify(debugPayload, null, 2)}`;
        if (import.meta.env.DEV) {
          console.error(errorMessage, debugPayload);
        }
        return { ok: false as const, error: errorWithRequest, details: debugPayload };
      }
    }
  }

  // 2b) Ensure strategy catalog + linkage
  {
    const strategyRow = {
      strategy_code: position.strategy_code,
      strategy_name: position.strategy_name,
    };
    const { error: strategyErr } = await supabase
      .from("strategies")
      .upsert(strategyRow, { onConflict: "strategy_code" });
    if (strategyErr) return { ok: false as const, error: strategyErr.message };

    const programStrategyRow = {
      program_id: position.program_id,
      strategy_code: position.strategy_code,
    };
    const { error: programStrategyErr } = await supabase
      .from("program_strategies")
      .upsert(programStrategyRow, { onConflict: "program_id,strategy_code" });
    if (programStrategyErr)
      return { ok: false as const, error: programStrategyErr.message };
  }

  // 3) Optional venue
  let venue_id = position.venue_id ?? null;
  if (venue && !venue_id) {
    const { data, error } = await supabase
      .from("venues")
      .insert(venue)
      .select("venue_id")
      .single();
    if (error) return { ok: false as const, error: error.message };
    venue_id = data.venue_id as string;
  }

  // 4) Insert position → get id
  const { data: pos, error: posErr } = await supabase
    .from("positions")
    .insert({
      ...position,
      venue_id,
      strategy_name_at_entry: position.strategy_name,
    })
    .select("position_id")
    .single();
  if (posErr) return { ok: false as const, error: posErr.message };
  const position_id = pos.position_id as string;

  // 5) Insert legs
  const legsRows = legs.map((l) => ({ ...l, position_id }));
  const { error: legsErr } = await supabase.from("legs").insert(legsRows);
  if (legsErr) return { ok: false as const, error: legsErr.message };

  // 6) Insert fills (optional)
  if (fills?.length) {
    const fillsRows = fills.map((f) => ({ ...f, position_id }));
    const { error: fillsErr } = await supabase.from("fills").insert(fillsRows);
    if (fillsErr) return { ok: false as const, error: fillsErr.message };
  }

  return { ok: true as const, position_id };
}
