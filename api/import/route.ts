import { createServerSupabase } from "@/lib/supabase/server";
import { payloadSchema } from "@/lib/import/validation";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request) {
  const supabase = createServerSupabase();

  // Validate payload
  const json = await req.json();
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return jsonResponse({ error: parsed.error.flatten() }, 400);
  }
  const { program, venue, position, legs, fills } = parsed.data;

  // 1) Ensure program exists (RLS: account_id = auth.uid() via DEFAULT)
  {
    const { error } = await supabase
      .from("programs")
      .upsert([program], { onConflict: "program_id", ignoreDuplicates: false });
    if (error) return jsonResponse({ error: error.message }, 400);
  }

  // 1b) Ensure strategy exists and is linked to the program
  {
    const strategyRow = {
      strategy_code: position.strategy_code,
      strategy_name: position.strategy_name,
    };
    const { error: strategyErr } = await supabase
      .from("strategies")
      .upsert([strategyRow], { onConflict: "strategy_code", ignoreDuplicates: false });
    if (strategyErr) return jsonResponse({ error: strategyErr.message }, 400);

    const programStrategyRow = {
      program_id: position.program_id,
      strategy_code: position.strategy_code,
    };
    const { error: programStrategyErr } = await supabase
      .from("program_strategies")
      .upsert([programStrategyRow], {
        onConflict: "program_id,strategy_code",
        ignoreDuplicates: false,
      });
    if (programStrategyErr)
      return jsonResponse({ error: programStrategyErr.message }, 400);
  }

  // 2) Optionally insert a venue and capture its id
  let venue_id: string | null = position.venue_id ?? null;
  if (venue && !venue_id) {
    const { data, error } = await supabase
      .from("venues")
      .insert(venue)
      .select("venue_id")
      .single();
    if (error) return jsonResponse({ error: error.message }, 400);
    venue_id = data.venue_id;
  }

  // 3) Insert position
  const { data: pos, error: posErr } = await supabase
    .from("positions")
    .insert({
      ...position,
      venue_id,
      strategy_name_at_entry: position.strategy_name,
    })
    .select("position_id")
    .single();
  if (posErr) return jsonResponse({ error: posErr.message }, 400);

  const position_id = pos.position_id as string;

  // 4) Insert legs (with FK to position)
  const legsRows = legs.map((l) => ({ ...l, position_id }));
  const { error: legsErr } = await supabase.from("legs").insert(legsRows);
  if (legsErr) return jsonResponse({ error: legsErr.message }, 400);

  // 5) Insert fills (optional)
  if (fills?.length) {
    const fillsRows = fills.map((f) => ({ ...f, position_id }));
    const { error: fillsErr } = await supabase.from("fills").insert(fillsRows);
    if (fillsErr) return jsonResponse({ error: fillsErr.message }, 400);
  }

  return jsonResponse({ ok: true, position_id });
}
