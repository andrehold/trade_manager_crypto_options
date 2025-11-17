import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClientScope } from "./clientScope";

export type SyncLinkedStructuresParams = {
  sourceId: string;
  linkedIds: string[];
  closedAt?: string;
  clientScope?: SupabaseClientScope;
};

export type SyncLinkedStructuresResult = { ok: true } | { ok: false; error: string };

function sanitizeIds(raw: unknown, disallow: string): string[] {
  if (!Array.isArray(raw)) return [];
  const result: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed === disallow) continue;
    if (!result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

function normalizeIsoTimestamp(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return trimmed;
  return new Date(parsed).toISOString();
}

function mergeClosedAt(existing: string | null, candidate: string | null): string | null {
  if (!candidate) return existing ?? null;
  const normalizedExisting = normalizeIsoTimestamp(existing);
  const normalizedCandidate = normalizeIsoTimestamp(candidate);
  if (!normalizedCandidate) return normalizedExisting;
  if (!normalizedExisting) return normalizedCandidate;

  const existingTime = Date.parse(normalizedExisting);
  const candidateTime = Date.parse(normalizedCandidate);
  if (Number.isNaN(existingTime)) return normalizedCandidate;
  if (Number.isNaN(candidateTime)) return normalizedExisting;
  return candidateTime < existingTime ? normalizedCandidate : normalizedExisting;
}

export async function syncLinkedStructures(
  client: SupabaseClient,
  params: SyncLinkedStructuresParams,
): Promise<SyncLinkedStructuresResult> {
  const sourceId = params.sourceId.trim();
  if (!sourceId) {
    return { ok: false, error: "Missing source structure identifier." };
  }

  const clientName = params.clientScope?.clientName?.trim();
  const restrictByClient = Boolean(clientName) && !params.clientScope?.isAdmin;

  const desiredLinked = Array.from(
    new Set(
      params.linkedIds
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
        .filter((id) => id !== sourceId),
    ),
  );

  let sourceQuery = client
    .from("positions")
    .select("linked_structure_ids, closed_at")
    .eq("position_id", sourceId);

  if (restrictByClient && clientName) {
    sourceQuery = sourceQuery.eq("client_name", clientName);
  }

  const { data: sourceRow, error: sourceErr } = await sourceQuery.maybeSingle();

  if (sourceErr) {
    return { ok: false, error: sourceErr.message };
  }

  if (!sourceRow) {
    return { ok: false, error: `Structure ${sourceId} does not exist.` };
  }

  const currentLinked = sanitizeIds((sourceRow as { linked_structure_ids?: unknown }).linked_structure_ids, sourceId);
  const removedIds = currentLinked.filter((id) => !desiredLinked.includes(id));
  const affectedTargets = Array.from(new Set([...desiredLinked, ...removedIds]));

  let targets: Array<{ position_id: string; linked_structure_ids?: unknown; closed_at?: string | null }> = [];
  if (affectedTargets.length > 0) {
    let targetsQuery = client
      .from("positions")
      .select("position_id, linked_structure_ids, closed_at")
      .in("position_id", affectedTargets);

    if (restrictByClient && clientName) {
      targetsQuery = targetsQuery.eq("client_name", clientName);
    }

    const { data: targetRows, error: targetErr } = await targetsQuery;

    if (targetErr) {
      return { ok: false, error: targetErr.message };
    }

    targets = targetRows as Array<{
      position_id: string;
      linked_structure_ids?: unknown;
      closed_at?: string | null;
    }>;

    const missingTarget = affectedTargets.find(
      (id) => !targets.some((row) => row.position_id === id),
    );
    if (missingTarget) {
      return { ok: false, error: `Linked structure ${missingTarget} does not exist.` };
    }
  }

  const normalizedClosedAt = params.closedAt ? normalizeIsoTimestamp(params.closedAt) : undefined;
  const nextSourceClosedAt =
    normalizedClosedAt !== undefined
      ? mergeClosedAt((sourceRow as { closed_at?: string | null }).closed_at ?? null, normalizedClosedAt)
      : (sourceRow as { closed_at?: string | null }).closed_at ?? null;

  const sourceUpdate: Record<string, any> = {
    linked_structure_ids: desiredLinked.length > 0 ? desiredLinked : null,
  };

  if (normalizedClosedAt !== undefined) {
    sourceUpdate.closed_at = nextSourceClosedAt;
  }

  let sourceUpdateQuery = client
    .from("positions")
    .update(sourceUpdate)
    .eq("position_id", sourceId);

  if (restrictByClient && clientName) {
    sourceUpdateQuery = sourceUpdateQuery.eq("client_name", clientName);
  }

  const { error: sourceUpdateErr } = await sourceUpdateQuery;

  if (sourceUpdateErr) {
    return { ok: false, error: sourceUpdateErr.message };
  }

  for (const target of targets) {
    const targetId = target.position_id;
    const existingLinks = sanitizeIds(target.linked_structure_ids, targetId);
    const isDesired = desiredLinked.includes(targetId);

    if (isDesired) {
      if (!existingLinks.includes(sourceId)) {
        existingLinks.push(sourceId);
      }
    }

    const nextLinks = isDesired
      ? Array.from(new Set(existingLinks))
      : existingLinks.filter((id) => id !== sourceId);

    const update: Record<string, any> = {
      linked_structure_ids: nextLinks.length > 0 ? nextLinks : null,
    };

    if (isDesired && normalizedClosedAt !== undefined) {
      update.closed_at = mergeClosedAt(target.closed_at ?? null, normalizedClosedAt);
    }

    const needsUpdate =
      Array.isArray(target.linked_structure_ids)
        ? JSON.stringify(sanitizeIds(target.linked_structure_ids, targetId)) !== JSON.stringify(nextLinks)
        : nextLinks.length > 0;

    const closedAtChanged =
      normalizedClosedAt !== undefined && update.closed_at !== (target.closed_at ?? null);

    if (needsUpdate || closedAtChanged) {
      let targetUpdateQuery = client
        .from("positions")
        .update(update)
        .eq("position_id", targetId);

      if (restrictByClient && clientName) {
        targetUpdateQuery = targetUpdateQuery.eq("client_name", clientName);
      }

      const { error: targetUpdateErr } = await targetUpdateQuery;

      if (targetUpdateErr) {
        return { ok: false, error: targetUpdateErr.message };
      }
    }
  }

  return { ok: true };
}
