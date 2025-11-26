import type { SupabaseClient } from "@supabase/supabase-js";

export type ProgramResource = {
  id: string;
  programId: string;
  title: string;
  url?: string | null;
  notes?: string | null;
  profitRule?: string | null;
  stopRule?: string | null;
  timeRule?: string | null;
  riskNotes?: string | null;
  playbookUrl?: string | null;
};

export type FetchProgramResourcesResult =
  | { ok: true; resources: ProgramResource[] }
  | { ok: false; error: string };

export async function fetchProgramResources(
  client: SupabaseClient,
  programIds?: string[],
): Promise<FetchProgramResourcesResult> {
  let query = client
    .from("program_resources")
    .select(
      "resource_id, program_id, title, url, notes, profit_rule, stop_rule, time_rule, risk_notes, playbook_url",
    )
    .order("title", { ascending: true });

  if (Array.isArray(programIds) && programIds.length > 0) {
    query = query.in("program_id", programIds);
  }

  const { data, error } = await query;

  if (error) {
    return { ok: false, error: error.message };
  }

  const rows = Array.isArray(data) ? data : [];
  const resources: ProgramResource[] = rows
    .map((row) => {
      const id = typeof row.resource_id === "string" ? row.resource_id : null;
      const programId = typeof row.program_id === "string" ? row.program_id : null;
      const title = typeof row.title === "string" ? row.title : null;

      if (!id || !programId || !title) return null;

      return {
        id,
        programId,
        title,
        url: typeof row.url === "string" ? row.url : null,
        notes: typeof row.notes === "string" ? row.notes : null,
        profitRule: typeof row.profit_rule === "string" ? row.profit_rule : null,
        stopRule: typeof row.stop_rule === "string" ? row.stop_rule : null,
        timeRule: typeof row.time_rule === "string" ? row.time_rule : null,
        riskNotes: typeof row.risk_notes === "string" ? row.risk_notes : null,
        playbookUrl: typeof row.playbook_url === "string" ? row.playbook_url : null,
      } satisfies ProgramResource;
    })
    .filter((row): row is ProgramResource => Boolean(row));

  return { ok: true, resources };
}
