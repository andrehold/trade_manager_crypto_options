import type { SupabaseClient } from "../supabase";
import type { Position, TxnRow, Exchange } from "@/utils";
import { daysTo } from "@/utils";

type RawLeg = {
  leg_seq: number | null;
  side: string | null;
  option_type: string | null;
  expiry: string | null;
  strike: number | string | null;
  qty: number | string | null;
  price: number | string | null;
};

type RawPosition = {
  position_id: string;
  program_id: string | null;
  underlier: string | null;
  strategy_code: string | null;
  strategy_name: string | null;
  strategy_name_at_entry?: string | null;
  lifecycle: "open" | "close" | null;
  closed_at?: string | null;
  entry_ts: string | null;
  exit_ts?: string | null;
  execution_route?: string | null;
  order_type?: string | null;
  provider?: string | null;
  venue_id?: string | null;
  package_order_id?: string | null;
  order_id?: string | null;
  rfq_id?: string | null;
  deal_id?: string | null;
  trade_id?: string | null;
  fees_total?: number | null;
  fees_currency?: string | null;
  net_fill?: number | null;
  mark_at_entry?: number | null;
  mark_source?: string | null;
  mark_ts?: string | null;
  spot?: number | null;
  expected_move_pts?: number | null;
  em_coverage_pct?: number | null;
  multiplier?: number | null;
  max_gain?: number | null;
  max_loss?: number | null;
  net_delta?: number | null;
  counterparty?: string | null;
  pricing_currency?: string | null;
  notes?: string | null;
  close_target_structure_id?: string | null;
  linked_structure_ids?: string[] | null;
  legs?: RawLeg[] | null;
  archived?: boolean | null;
  archived_at?: string | null;
  archived_by?: string | null;
};

type FetchSavedStructuresOk = { ok: true; positions: Position[] };
type FetchSavedStructuresErr = { ok: false; error: string };
export type FetchSavedStructuresResult = FetchSavedStructuresOk | FetchSavedStructuresErr;

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function formatInstrument(underlier: string, expiryISO: string, strike: number, optionType: "C" | "P") {
  if (!expiryISO || expiryISO.length < 10) return `${underlier}-${strike}-${optionType}`;
  const [yearStr, monthStr, dayStr] = expiryISO.split("-");
  const monthIdx = Number(monthStr) - 1;
  const monthText = MONTHS[monthIdx] ?? monthStr;
  const yearShort = yearStr.slice(-2);
  const dayNum = Number(dayStr);
  const dayText = Number.isFinite(dayNum) ? String(dayNum) : dayStr;
  return `${underlier}-${dayText}${monthText}${yearShort}-${strike}-${optionType}`;
}

function parseNumeric(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const directMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) return directMatch[1];

  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function toOptionType(raw: string | null | undefined): "C" | "P" | null {
  if (!raw) return null;
  const norm = raw.toLowerCase();
  if (norm === "call") return "C";
  if (norm === "put") return "P";
  return null;
}

function normalizeExchangeCandidate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function inferExchange(position: RawPosition): Exchange | undefined {
  const candidates = [
    normalizeExchangeCandidate(position.provider),
    normalizeExchangeCandidate(position.venue_id),
    normalizeExchangeCandidate(position.mark_source),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.replace(/[^a-z]/g, "");
    if (!normalized) continue;

    if (normalized.includes("coincall") || normalized === "cc") {
      return "coincall";
    }

    if (normalized.includes("deribit") || normalized === "db") {
      return "deribit";
    }
  }

  return undefined;
}

function mapLeg(position: RawPosition, leg: RawLeg, index: number, exchange: Exchange | undefined) {
  const strike = parseNumeric(leg.strike) ?? undefined;
  const qtyRaw = parseNumeric(leg.qty) ?? undefined;
  const price = parseNumeric(leg.price) ?? undefined;
  const optionType = toOptionType(leg.option_type);
  const side = leg.side === "sell" ? "sell" : leg.side === "buy" ? "buy" : null;

  if (strike == null || qtyRaw == null || price == null || optionType == null || side == null) {
    return null;
  }

  const qty = Math.abs(qtyRaw);
  const sign = side === "sell" ? -1 : 1;
  const expiryISO =
    normalizeDateOnly(leg.expiry) ?? normalizeDateOnly(position.entry_ts ?? undefined) ?? null;
  const instrumentUnderlier = (position.underlier ?? "").toUpperCase() || "UNDERLIER";
  const instrument = formatInstrument(instrumentUnderlier, expiryISO ?? "", strike, optionType);

  const trade: TxnRow = {
    instrument,
    side,
    action: position.lifecycle === "close" ? "close" : "open",
    amount: qty,
    price,
    timestamp: position.entry_ts ?? undefined,
    trade_id: position.trade_id ?? undefined,
    order_id: position.order_id ?? undefined,
    info: undefined,
    underlying: instrumentUnderlier,
    expiry: expiryISO ?? undefined,
    strike,
    optionType,
    structureId: position.position_id,
    exchange,
  };

  return {
    key: `${leg.leg_seq ?? index}-${strike}-${optionType}`,
    strike,
    optionType,
    openLots: [{ qty, price, sign: sign as 1 | -1 }],
    realizedPnl: 0,
    netPremium: sign === -1 ? price * qty : -price * qty,
    qtyNet: sign * qty,
    trades: [trade],
    exchange,
    expiry: expiryISO ?? undefined,
  };
}

function normalizeClosedAt(rawClosedAt: string | null | undefined): string | null {
  if (rawClosedAt == null) return null;
  const trimmed = String(rawClosedAt).trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "undefined") return null;
  return trimmed;
}

function normalizeLifecycle(raw: string | null | undefined): "open" | "close" | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "open") return "open";
  if (normalized === "close" || normalized === "closed") return "close";
  return null;
}

function mapPosition(raw: RawPosition, programNames: Map<string, string>): Position {
  const underlier = (raw.underlier ?? "").toUpperCase();
  const exchange = inferExchange(raw);
  const legs = (raw.legs ?? [])
    .map((leg, index) => mapLeg(raw, leg, index, exchange))
    .filter((leg): leg is NonNullable<typeof leg> => Boolean(leg));

  const expiryFromLeg = legs.find((leg) => leg.expiry)?.expiry ?? null;
  const normalizedEntry = normalizeDateOnly(raw.entry_ts ?? undefined);
  const normalizedExpiry = expiryFromLeg ?? normalizedEntry;
  const expiryISO = normalizedExpiry ?? raw.entry_ts?.slice(0, 10) ?? "—";
  const dte = normalizedExpiry ? daysTo(normalizedExpiry) : 0;

  const netPremium =
    raw.net_fill ?? legs.reduce((sum, leg) => sum + (Number.isFinite(leg.netPremium) ? leg.netPremium : 0), 0);

  const lifecycle = normalizeLifecycle(raw.lifecycle) ?? "open";
  const closedAt = normalizeClosedAt(raw.closed_at ?? null);
  const hasLinkedClosure = Boolean(closedAt || raw.close_target_structure_id);
  const isClosed = lifecycle === "close" || hasLinkedClosure;

  const status: Position["status"] = isClosed ? "CLOSED" : "OPEN";

  return {
    id: raw.position_id,
    underlying: underlier || "—",
    expiryISO,
    dte,
    legs,
    legsCount: legs.length,
    type: legs.length > 1 ? "Multi-leg" : "Single",
    strategy: raw.strategy_name_at_entry || raw.strategy_name || raw.strategy_code || undefined,
    realizedPnl: 0,
    netPremium,
    pnlPct: null,
    status,
    greeks: {
      delta: raw.net_delta ?? null,
      gamma: null,
      theta: null,
      vega: null,
      rho: null,
    },
    playbook: raw.notes ?? undefined,
    programId: raw.program_id ?? undefined,
    programName: raw.program_id ? programNames.get(raw.program_id) ?? undefined : undefined,
    structureId:
      raw.package_order_id ?? raw.order_id ?? raw.trade_id ?? raw.close_target_structure_id ?? raw.position_id,
    exchange,
    source: "supabase",
    closedAt,
    archived: Boolean(raw.archived),
    archivedAt: raw.archived_at ?? null,
    archivedBy: raw.archived_by ?? null,
  };
}

export async function fetchSavedStructures(
  client: SupabaseClient,
): Promise<FetchSavedStructuresResult> {
  const { data, error } = await client
    .from("positions")
    .select(
      `position_id,
       program_id,
       underlier,
       strategy_code,
       strategy_name,
       strategy_name_at_entry,
       lifecycle,
       entry_ts,
       exit_ts,
       execution_route,
       order_type,
       provider,
       venue_id,
       package_order_id,
       order_id,
       rfq_id,
       deal_id,
       trade_id,
       fees_total,
       fees_currency,
       net_fill,
       mark_at_entry,
       mark_source,
       mark_ts,
       spot,
       expected_move_pts,
       em_coverage_pct,
       multiplier,
       max_gain,
       max_loss,
       net_delta,
       counterparty,
       pricing_currency,
       notes,
       closed_at,
       close_target_structure_id,
       linked_structure_ids,
       archived,
       archived_at,
       archived_by,
       legs:legs(
         leg_seq,
         side,
         option_type,
         expiry,
         strike,
         qty,
         price
       )`
    )
    .eq("archived", false)
    .order("entry_ts", { ascending: false });

  if (error) {
    return { ok: false, error: error.message };
  }

  const rows = (data as RawPosition[] | null | undefined) ?? [];

  const programNameMap = new Map<string, string>();
  const programIds = Array.from(new Set(rows.map((row) => row.program_id).filter((id): id is string => Boolean(id))));

  if (programIds.length > 0) {
    const { data: programRows, error: programError } = await client
      .from("programs")
      .select("program_id, program_name")
      .in("program_id", programIds);

    if (programError) {
      return { ok: false, error: programError.message };
    }

    for (const row of programRows ?? []) {
      const programId = typeof row?.program_id === "string" ? row.program_id : null;
      const programName = typeof row?.program_name === "string" ? row.program_name : null;
      if (programId && programName) {
        programNameMap.set(programId, programName);
      }
    }
  }

  const positions = rows.map((raw) => mapPosition(raw, programNameMap));
  return { ok: true, positions };
}
