import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { payloadSchema } from "@/lib/import/validation";

export async function POST(req: Request) {
  const supabase = createServerSupabase();

  // Validate payload
  const json = await req.json();
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { program, venue, position, legs, fills } = parsed.data;

  // 1) Ensure program exists (RLS: account_id = auth.uid() via DEFAULT)
  {
    const { error } = await supabase
      .from("programs")
      .upsert([program], { onConflict: "program_id", ignoreDuplicates: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // 2) Optionally insert a venue and capture its id
  let venue_id: string | null = position.venue_id ?? null;
  if (venue && !venue_id) {
    const { data, error } = await supabase
      .from("venues")
      .insert(venue)
      .select("venue_id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    venue_id = data.venue_id;
  }

  // 3) Insert position
  const { data: pos, error: posErr } = await supabase
    .from("positions")
    .insert({ ...position, venue_id })
    .select("position_id")
    .single();
  if (posErr) return NextResponse.json({ error: posErr.message }, { status: 400 });

  const position_id = pos.position_id as string;

  // 4) Insert legs (with FK to position)
  const legsRows = legs.map((l) => ({ ...l, position_id }));
  const { error: legsErr } = await supabase.from("legs").insert(legsRows);
  if (legsErr) return NextResponse.json({ error: legsErr.message }, { status: 400 });

  // 5) Insert fills (optional)
  if (fills?.length) {
    const fillsRows = fills.map((f) => ({ ...f, position_id }));
    const { error: fillsErr } = await supabase.from("fills").insert(fillsRows);
    if (fillsErr) return NextResponse.json({ error: fillsErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, position_id });
}
