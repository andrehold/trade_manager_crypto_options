// src/features/import/importTrades.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { tryGetSupabaseClient } from "../supabase";
import { syncLinkedStructures } from "../positions/syncLinkedStructures";
import { payloadSchema } from "./validation";
import type { ImportPayload } from "./types";

type ImportTradesResult =
  | { ok: true; position_id: string; mode: 'insert' | 'update' }
  | { ok: false; error: string; details?: unknown };

function nullifyUndefined<T extends Record<string, any>>(row: T): T {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key] = value === undefined ? null : value;
  }
  return result as T;
}

type ImportTradesOptions = {
  positionId?: string;
};

type Lifecycle = ImportPayload["position"]["lifecycle"];

type SyncResult = { ok: true } | { ok: false; error: string };

function sanitizeValue(value: unknown): unknown {
  if (value == null) return value;

  if (Array.isArray(value)) {
    const sanitized = value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== undefined);
    return sanitized;
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = sanitizeValue(nested);
    }
    return result;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return value;
}

function sanitizePayload(payload: ImportPayload): ImportPayload {
  return sanitizeValue(payload) as ImportPayload;
}

async function recalcClosedAt(
  client: SupabaseClient,
  targetId: string,
): Promise<SyncResult> {
  const { data, error } = await client
    .from("positions")
    .select("entry_ts")
    .eq("close_target_structure_id", targetId)
    .eq("lifecycle", "close")
    .order("entry_ts", { ascending: true })
    .limit(1);

  if (error) {
    return { ok: false as const, error: error.message };
  }

  const closedAt = data?.[0]?.entry_ts ?? null;
  const { error: updateErr } = await client
    .from("positions")
    .update({ closed_at: closedAt })
    .eq("position_id", targetId);

  if (updateErr) {
    return { ok: false as const, error: updateErr.message };
  }

  return { ok: true as const };
}

async function syncClosedStructureState(
  client: SupabaseClient,
  params: {
    previousLifecycle?: Lifecycle | null;
    previousTargetId?: string | null;
    newLifecycle: Lifecycle;
    newTargetId: string | null;
  },
): Promise<SyncResult> {
  const targets = new Set<string>();

  if (params.previousLifecycle === "close" && params.previousTargetId) {
    targets.add(params.previousTargetId);
  }

  if (params.newLifecycle === "close" && params.newTargetId) {
    targets.add(params.newTargetId);
  }

  for (const targetId of targets) {
    const result = await recalcClosedAt(client, targetId);
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true as const };
}

export async function importTrades(
  payload: ImportPayload,
  options: ImportTradesOptions = {},
): Promise<ImportTradesResult> {
  const supabase = tryGetSupabaseClient();
  if (!supabase) {
    return {
      ok: false as const,
      error: "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable imports.",
    };
  }

  // 0) Validate
  const sanitizedPayload = sanitizePayload(payload);
  const parsed = payloadSchema.safeParse(sanitizedPayload);
  if (!parsed.success) {
    return { ok: false as const, error: "Invalid payload", details: parsed.error.flatten() };
  }
  const { program, venue, position, legs, fills } = parsed.data;

  if (program.program_id !== position.program_id) {
    return {
      ok: false as const,
      error: "Program mismatch between program metadata and position payload.",
    };
  }

  // 1) Make sure user is signed in (RLS)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };

  // 2) Verify program exists without modifying the catalog
  {
    const { data, error } = await supabase
      .from("programs")
      .select("program_id")
      .eq("program_id", program.program_id)
      .maybeSingle();

    if (error) {
      return { ok: false as const, error: error.message };
    }

    if (!data) {
      return {
        ok: false as const,
        error: `Program ${program.program_id} does not exist. Create it before saving a structure.`,
      };
    }
  }

  // 2b) Verify strategy catalog entry when provided
  if (position.strategy_code) {
    const { data, error } = await supabase
      .from("strategies")
      .select("strategy_code")
      .eq("strategy_code", position.strategy_code)
      .maybeSingle();

    if (error) {
      return { ok: false as const, error: error.message };
    }

    if (!data) {
      return {
        ok: false as const,
        error: `Strategy ${position.strategy_code} does not exist. Create it before saving a structure.`,
      };
    }
  }

  const { positionId } = options;

  if (positionId) {
    // Updating an existing structure
    const { data: existing, error: existingErr } = await supabase
      .from("positions")
      .select("position_id, venue_id, lifecycle, close_target_structure_id")
      .eq("position_id", positionId)
      .maybeSingle();

    if (existingErr) {
      return { ok: false as const, error: existingErr.message };
    }

    if (!existing) {
      return { ok: false as const, error: `Position ${positionId} does not exist.` };
    }

    let venue_id = position.venue_id ?? (existing.venue_id as string | null) ?? null;

    if (venue) {
      const venueTargetId = venue.venue_id ?? (existing.venue_id as string | null) ?? null;
      const venuePayload = nullifyUndefined({ ...venue });
      delete (venuePayload as { venue_id?: string }).venue_id;

      if (venueTargetId) {
        const { error: updateVenueErr } = await supabase
          .from("venues")
          .update(venuePayload)
          .eq("venue_id", venueTargetId);
        if (updateVenueErr) {
          return { ok: false as const, error: updateVenueErr.message };
        }
        venue_id = venueTargetId;
      } else {
        const { data: newVenue, error: insertVenueErr } = await supabase
          .from("venues")
          .insert(venue)
          .select("venue_id")
          .single();
        if (insertVenueErr) {
          return { ok: false as const, error: insertVenueErr.message };
        }
        venue_id = newVenue.venue_id as string;
      }
    } else {
      venue_id = null;
    }

    const positionUpdate = nullifyUndefined({
      ...position,
      venue_id,
      strategy_name_at_entry: position.strategy_name,
    });

    const { error: updatePositionErr } = await supabase
      .from("positions")
      .update(positionUpdate)
      .eq("position_id", positionId);

    if (updatePositionErr) {
      return { ok: false as const, error: updatePositionErr.message };
    }

    const { error: deleteFillsErr } = await supabase.from("fills").delete().eq("position_id", positionId);
    if (deleteFillsErr) {
      return { ok: false as const, error: deleteFillsErr.message };
    }

    const { error: deleteLegsErr } = await supabase.from("legs").delete().eq("position_id", positionId);
    if (deleteLegsErr) {
      return { ok: false as const, error: deleteLegsErr.message };
    }

    if (legs.length) {
      const legsRows = legs.map((l) => ({ ...l, position_id: positionId }));
      const { error: legsErr } = await supabase.from("legs").insert(legsRows);
      if (legsErr) {
        return { ok: false as const, error: legsErr.message };
      }
    }

    if (fills?.length) {
      const fillsRows = fills.map((f) => nullifyUndefined({ ...f, position_id: positionId }));
      const { error: fillsErr } = await supabase.from("fills").insert(fillsRows);
      if (fillsErr) {
        return { ok: false as const, error: fillsErr.message };
      }
    }

    const linkedIdsSet = new Set<string>();
    if (Array.isArray(position.linked_structure_ids)) {
      for (const id of position.linked_structure_ids) {
        if (typeof id === "string" && id.trim().length > 0) {
          linkedIdsSet.add(id.trim());
        }
      }
    }
    if (typeof position.close_target_structure_id === "string" && position.close_target_structure_id.trim().length > 0) {
      linkedIdsSet.add(position.close_target_structure_id.trim());
    }
    linkedIdsSet.delete(positionId);

    const closedAtCandidate =
      position.lifecycle === "close"
        ? position.exit_ts ?? position.entry_ts ?? new Date().toISOString()
        : undefined;

    const syncResult = await syncClosedStructureState(supabase, {
      previousLifecycle: (existing.lifecycle as Lifecycle | null) ?? null,
      previousTargetId: (existing.close_target_structure_id as string | null) ?? null,
      newLifecycle: position.lifecycle,
      newTargetId: position.close_target_structure_id ?? null,
    });

    if (!syncResult.ok) {
      return { ok: false as const, error: syncResult.error };
    }

    const linkResult = await syncLinkedStructures(supabase, {
      sourceId: positionId,
      linkedIds: Array.from(linkedIdsSet),
      closedAt: closedAtCandidate,
    });

    if (!linkResult.ok) {
      return { ok: false as const, error: linkResult.error };
    }

    return { ok: true as const, position_id: positionId, mode: 'update' };
  }

  // 3) Optional venue when inserting
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
    const fillsRows = fills.map((f) => nullifyUndefined({ ...f, position_id }));
    const { error: fillsErr } = await supabase.from("fills").insert(fillsRows);
    if (fillsErr) return { ok: false as const, error: fillsErr.message };
  }

  const linkedIdsSet = new Set<string>();
  if (Array.isArray(position.linked_structure_ids)) {
    for (const id of position.linked_structure_ids) {
      if (typeof id === "string" && id.trim().length > 0) {
        linkedIdsSet.add(id.trim());
      }
    }
  }
  if (typeof position.close_target_structure_id === "string" && position.close_target_structure_id.trim().length > 0) {
    linkedIdsSet.add(position.close_target_structure_id.trim());
  }
  linkedIdsSet.delete(position_id);

  const closedAtCandidate =
    position.lifecycle === "close"
      ? position.exit_ts ?? position.entry_ts ?? new Date().toISOString()
      : undefined;

  const syncResult = await syncClosedStructureState(supabase, {
    newLifecycle: position.lifecycle,
    newTargetId: position.close_target_structure_id ?? null,
  });

  if (!syncResult.ok) {
    return { ok: false as const, error: syncResult.error };
  }

  const linkResult = await syncLinkedStructures(supabase, {
    sourceId: position_id,
    linkedIds: Array.from(linkedIdsSet),
    closedAt: closedAtCandidate,
  });

  if (!linkResult.ok) {
    return { ok: false as const, error: linkResult.error };
  }

  return { ok: true as const, position_id, mode: 'insert' };
}
