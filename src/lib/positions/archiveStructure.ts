import type { SupabaseClient } from "@supabase/supabase-js";

export type ArchiveStructureParams = {
  positionId: string;
  archivedBy?: string | null;
};

export type ArchiveStructureResult = { ok: true } | { ok: false; error: string };

export async function archiveStructure(
  client: SupabaseClient,
  params: ArchiveStructureParams,
): Promise<ArchiveStructureResult> {
  const id = params.positionId.trim();
  if (!id) {
    return { ok: false, error: "Missing structure identifier." };
  }

  const timestamp = new Date().toISOString();
  const update: Record<string, any> = {
    archived: true,
    archived_at: timestamp,
    archived_by: params.archivedBy ?? null,
  };

  const { error, data } = await client
    .from("positions")
    .update(update)
    .eq("position_id", id)
    .select("position_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data) {
    return { ok: false, error: `Structure ${id} does not exist.` };
  }

  return { ok: true };
}
