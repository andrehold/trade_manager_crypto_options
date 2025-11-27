import type { SupabaseClient } from "@supabase/supabase-js";

export type PlaybookSignal = {
  id: string;
  playbookId: string;
  label: string;
  trigger?: string | null;
  action?: string | null;
};

export type ProgramLink = {
  id: string;
  programId: string;
  title: string;
  url?: string | null;
  notes?: string | null;
  resourceType?: string | null;
};

export type ProgramPlaybook = {
  id: string;
  programId: string;
  profitRule?: string | null;
  stopRule?: string | null;
  timeRule?: string | null;
  otherNotes?: string | null;
  sizingLimits?: unknown;
  marketSignals?: unknown;
  signals: PlaybookSignal[];
  links: ProgramLink[];
};

export type FetchProgramPlaybooksResult =
  | { ok: true; playbooks: ProgramPlaybook[] }
  | { ok: false; error: string };

export async function fetchProgramPlaybooks(
  client: SupabaseClient,
  programIds?: string[],
): Promise<FetchProgramPlaybooksResult> {
  let playbooksQuery = client
    .from("program_playbooks")
    .select(
      "playbook_id, program_id, profit_rule, stop_rule, time_rule, other_notes, sizing_limits, market_signals",
    )
    .order("created_at", { ascending: true });

  if (Array.isArray(programIds) && programIds.length > 0) {
    playbooksQuery = playbooksQuery.in("program_id", programIds);
  }

  let linksQuery = client
    .from("program_resources")
    .select("resource_id, program_id, resource_type, title, url, notes")
    .order("title", { ascending: true });

  if (Array.isArray(programIds) && programIds.length > 0) {
    linksQuery = linksQuery.in("program_id", programIds);
  }

  const [playbookResult, linksResult] = await Promise.all([
    playbooksQuery,
    linksQuery,
  ]);

  if (playbookResult.error) {
    return { ok: false, error: playbookResult.error.message };
  }
  if (linksResult.error) {
    return { ok: false, error: linksResult.error.message };
  }

  const playbookRows = Array.isArray(playbookResult.data) ? playbookResult.data : [];
  const linkRows = Array.isArray(linksResult.data) ? linksResult.data : [];

  const linksByProgram = new Map<string, ProgramLink[]>();
  for (const row of linkRows) {
    const id = typeof row.resource_id === "string" ? row.resource_id : null;
    const programId = typeof row.program_id === "string" ? row.program_id : null;
    const title = typeof row.title === "string" ? row.title : null;

    if (!id || !programId || !title) continue;

    const link: ProgramLink = {
      id,
      programId,
      title,
      url: typeof row.url === "string" ? row.url : null,
      notes: typeof row.notes === "string" ? row.notes : null,
      resourceType: typeof row.resource_type === "string" ? row.resource_type : null,
    };

    const current = linksByProgram.get(programId) ?? [];
    current.push(link);
    linksByProgram.set(programId, current);
  }

  const playbooks: ProgramPlaybook[] = playbookRows
    .map((row) => {
      const id = typeof row.playbook_id === "string" ? row.playbook_id : null;
      const programId = typeof row.program_id === "string" ? row.program_id : null;

      if (!id || !programId) return null;

      return {
        id,
        programId,
        profitRule: typeof row.profit_rule === "string" ? row.profit_rule : null,
        stopRule: typeof row.stop_rule === "string" ? row.stop_rule : null,
        timeRule: typeof row.time_rule === "string" ? row.time_rule : null,
        otherNotes: typeof row.other_notes === "string" ? row.other_notes : null,
        sizingLimits: row.sizing_limits,
        marketSignals: row.market_signals,
        signals: [],
        links: linksByProgram.get(programId) ?? [],
      } satisfies ProgramPlaybook;
    })
    .filter((row): row is ProgramPlaybook => Boolean(row));

  return { ok: true, playbooks };
}
