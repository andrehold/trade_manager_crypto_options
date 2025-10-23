// src/features/import/importTrades.ts
import { supabase } from "../supabase/supabase";
import { payloadSchema } from "./validation";
import type { ImportPayload } from "./types";

type ImportTradesResult =
  | { ok: true; position_id: string }
  | { ok: false; error: string; details?: unknown };

export async function importTrades(payload: ImportPayload): Promise<ImportTradesResult> {
  // 0) Validate
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false as const, error: "Invalid payload", details: parsed.error.flatten() };
  }
  const { program, venue, position, legs, fills } = parsed.data;

  // 1) Make sure user is signed in (RLS)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };

  // 2) Upsert program
  {
    const { error } = await supabase
      .from("programs")
      .upsert(program, { onConflict: "program_id" });
    if (error) return { ok: false as const, error: error.message };
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
    .insert({ ...position, venue_id })
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
