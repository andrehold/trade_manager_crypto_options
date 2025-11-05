import type { SupabaseClient } from "../supabase";
import type { Position, TxnRow } from "@/utils";
import { daysTo } from "@/utils";

type RawLeg = {
  leg_seq: number | null;
  side: string | null;
  option_type: string | null;
  expiry: string | null;
  strike: number | null;
  qty: number | null;
  price: number | null;
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
  return `${underlier}-${dayStr}${monthText}${yearShort}-${strike}-${optionType}`;
}

function normalizeExpiry(expiry: string | null | undefined): string | null {
  if (!expiry) return null;
  const trimmed = expiry.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

function toOptionType(raw: string | null | undefined): "C" | "P" | null {
  if (!raw) return null;
  const norm = raw.toLowerCase();
  if (norm === "call") return "C";
  if (norm === "put") return "P";
  return null;
}

function mapLeg(position: RawPosition, leg: RawLeg, index: number) {
  const strike = leg.strike ?? undefined;
  const qtyRaw = leg.qty ?? undefined;
  const price = leg.price ?? undefined;
  const optionType = toOptionType(leg.option_type);
  const side = leg.side === "sell" ? "sell" : leg.side === "buy" ? "buy" : null;

  if (strike == null || qtyRaw == null || price == null || optionType == null || side == null) {
    return null;
  }

  const qty = Math.abs(qtyRaw);
  const sign = side === "sell" ? -1 : 1;
  const expiryISO = normalizeExpiry(leg.expiry) ?? normalizeExpiry(position.entry_ts ?? undefined) ?? "";
  const instrumentUnderlier = (position.underlier ?? "").toUpperCase() || "UNDERLIER";
  const instrument = formatInstrument(instrumentUnderlier, expiryISO || "", strike, optionType);

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
    exchange: undefined,
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
    exchange: undefined,
  };
}

function mapPosition(raw: RawPosition): Position {
  const underlier = (raw.underlier ?? "").toUpperCase();
  const legs = (raw.legs ?? [])
    .map((leg, index) => mapLeg(raw, leg, index))
    .filter((leg): leg is NonNullable<typeof leg> => Boolean(leg));

  const expiryFromLeg = legs.find((leg) => leg.trades?.[0]?.expiry)?.trades?.[0]?.expiry ?? null;
  const normalizedExpiry = normalizeExpiry(expiryFromLeg) ?? normalizeExpiry(raw.entry_ts ?? undefined);
  const expiryISO = normalizedExpiry ?? (expiryFromLeg || raw.entry_ts?.slice(0, 10) || "—");
  const dte = normalizedExpiry ? daysTo(normalizedExpiry) : 0;

  const netPremium =
    raw.net_fill ?? legs.reduce((sum, leg) => sum + (Number.isFinite(leg.netPremium) ? leg.netPremium : 0), 0);

  const lifecycle = raw.lifecycle ?? "open";
  const closedAt = raw.closed_at ?? null;

  let status: Position["status"];
  if (lifecycle === "close") {
    status = "ALERT";
  } else if (closedAt) {
    status = "ATTENTION";
  } else {
    status = "OPEN";
  }

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
    structureId:
      raw.package_order_id ?? raw.order_id ?? raw.trade_id ?? raw.close_target_structure_id ?? raw.position_id,
    exchange: undefined,
    source: "supabase",
    closedAt,
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
    .order("entry_ts", { ascending: false });

  if (error) {
    return { ok: false, error: error.message };
  }

  const positions = (data as RawPosition[] | null | undefined)?.map(mapPosition) ?? [];
  return { ok: true, positions };
}
