import type { SupabaseClient } from '../supabase';
import type { ImportPayload } from '../import';
import type {
  OptionsStructure,
  Construction,
  StructureLifecycle,
  ExecutionRoute,
  OrderType,
  ExecutionMode,
  LiquidityRole,
} from '../import/types';

export type FetchStructurePayloadResult =
  | { ok: true; payload: ImportPayload }
  | { ok: false; error: string };

type PositionRow = {
  position_id: string;
  program_id: string | null;
  underlier: string | null;
  strategy_code: string | null;
  strategy_name: string | null;
  client_name: string | null;
  options_structure: OptionsStructure | null;
  construction: Construction | null;
  risk_defined: boolean | null;
  lifecycle: StructureLifecycle | null;
  closed_at: string | null;
  entry_ts: string | null;
  exit_ts: string | null;
  execution_route: ExecutionRoute | null;
  order_type: OrderType | null;
  provider: string | null;
  venue_id: string | null;
  package_order_id: string | null;
  order_id: string | null;
  rfq_id: string | null;
  deal_id: string | null;
  trade_id: string | null;
  fees_total: number | null;
  fees_currency: string | null;
  net_fill: number | null;
  mark_at_entry: number | null;
  mark_source: string | null;
  mark_ts: string | null;
  spot: number | null;
  expected_move_pts: number | null;
  em_coverage_pct: number | null;
  multiplier: number | null;
  max_gain: number | null;
  max_loss: number | null;
  net_delta: number | null;
  counterparty: string | null;
  pricing_currency: string | null;
  notes: string | null;
  close_target_structure_id: string | null;
  linked_structure_ids: string[] | null;
};

type LegRow = {
  leg_seq: number | null;
  side: 'buy' | 'sell' | null;
  option_type: 'call' | 'put' | null;
  expiry: string | null;
  strike: number | string | null;
  qty: number | string | null;
  price: number | string | null;
};

type FillRow = {
  ts: string | null;
  qty: number | string | null;
  price: number | string | null;
  leg_seq: number | null;
  side: 'buy' | 'sell' | null;
  liquidity_role: string | null;
  execution_mode: string | null;
  provider: string | null;
  venue_id: string | null;
  order_id: string | null;
  trade_id: string | null;
  rfq_id: string | null;
  deal_id: string | null;
  fees: number | null;
  notes: string | null;
};

type ProgramRow = {
  program_id: string;
  program_name: string | null;
  base_currency: string | null;
  objective: string | null;
  sleeve: string | null;
};

type VenueRow = {
  venue_id: string;
  type: string | null;
  name: string | null;
  mic: string | null;
  underlying_exchange: string | null;
  venue_code: string | null;
  execution_mode: string | null;
  liquidity_role: string | null;
  broker: string | null;
  clearing_firm: string | null;
  account: string | null;
};

function coalesceString(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function coalesceNumber(value: number | string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const numeric = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric : undefined;
}

export async function fetchStructurePayload(
  client: SupabaseClient,
  positionId: string,
): Promise<FetchStructurePayloadResult> {
  const { data: positionRow, error: positionError } = await client
    .from('positions')
    .select(
      `position_id,
       program_id,
      underlier,
      strategy_code,
      strategy_name,
      client_name,
      options_structure,
       construction,
       risk_defined,
       lifecycle,
       closed_at,
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
       close_target_structure_id,
       linked_structure_ids`
    )
    .eq('position_id', positionId)
    .maybeSingle();

  if (positionError) {
    return { ok: false, error: positionError.message };
  }

  if (!positionRow) {
    return { ok: false, error: 'Structure not found.' };
  }

  const position = positionRow as PositionRow;

  const { data: legsRows, error: legsError } = await client
    .from('legs')
    .select('leg_seq, side, option_type, expiry, strike, qty, price')
    .eq('position_id', positionId)
    .order('leg_seq');

  if (legsError) {
    return { ok: false, error: legsError.message };
  }

  const { data: fillsRows, error: fillsError } = await client
    .from('fills')
    .select(
      'ts, qty, price, leg_seq, side, liquidity_role, execution_mode, provider, venue_id, order_id, trade_id, rfq_id, deal_id, fees, notes',
    )
    .eq('position_id', positionId)
    .order('ts');

  if (fillsError) {
    return { ok: false, error: fillsError.message };
  }

  const programId = position.program_id;
  if (!programId) {
    return { ok: false, error: 'Saved structure is missing a program reference.' };
  }

  const { data: programRow, error: programError } = await client
    .from('programs')
    .select('program_id, program_name, base_currency, objective, sleeve')
    .eq('program_id', programId)
    .maybeSingle();

  if (programError) {
    return { ok: false, error: programError.message };
  }

  if (!programRow) {
    return { ok: false, error: `Program ${programId} not found.` };
  }

  let venuePayload: ImportPayload['venue'];
  if (position.venue_id) {
    const { data: venueRow, error: venueError } = await client
      .from('venues')
      .select(
        'venue_id, type, name, mic, underlying_exchange, venue_code, execution_mode, liquidity_role, broker, clearing_firm, account',
      )
      .eq('venue_id', position.venue_id)
      .maybeSingle();

    if (venueError) {
      return { ok: false, error: venueError.message };
    }

    if (venueRow) {
      const venue = venueRow as VenueRow;
      const executionMode = coalesceString(venue.execution_mode) as ExecutionMode | undefined;
      const liquidityRole = coalesceString(venue.liquidity_role) as LiquidityRole | undefined;

      venuePayload = {
        venue_id: venue.venue_id,
        type: (venue.type ?? 'exchange') as ImportPayload['venue']['type'],
        name: venue.name ?? '',
        mic: coalesceString(venue.mic),
        underlying_exchange: coalesceString(venue.underlying_exchange) ?? undefined,
        venue_code: coalesceString(venue.venue_code) ?? undefined,
        execution_mode: executionMode,
        liquidity_role: liquidityRole,
        broker: coalesceString(venue.broker) ?? undefined,
        clearing_firm: coalesceString(venue.clearing_firm) ?? undefined,
        account: coalesceString(venue.account) ?? undefined,
      };
    }
  }

  const legsPayload = (legsRows ?? []).map((leg) => {
    const row = leg as LegRow;
    return {
      leg_seq: row.leg_seq ?? 0,
      side: (row.side ?? 'buy') as ImportPayload['legs'][number]['side'],
      option_type: (row.option_type ?? 'call') as ImportPayload['legs'][number]['option_type'],
      expiry: row.expiry ?? '',
      strike: coalesceNumber(row.strike) ?? 0,
      qty: coalesceNumber(row.qty) ?? 0,
      price: coalesceNumber(row.price) ?? 0,
    } satisfies ImportPayload['legs'][number];
  });

  const fillsPayload = (fillsRows ?? []).map((fill) => {
    const row = fill as FillRow;
    return {
      ts: row.ts ?? '',
      qty: coalesceNumber(row.qty) ?? 0,
      price: coalesceNumber(row.price) ?? 0,
      leg_seq: row.leg_seq ?? undefined,
      side: (row.side ?? undefined) as ImportPayload['fills'][number]['side'],
      liquidity_role:
        (row.liquidity_role ?? undefined) as ImportPayload['fills'][number]['liquidity_role'],
      execution_mode:
        (row.execution_mode ?? undefined) as ImportPayload['fills'][number]['execution_mode'],
      provider: row.provider ?? undefined,
      venue_id: row.venue_id ?? undefined,
      order_id: row.order_id ?? undefined,
      trade_id: row.trade_id ?? undefined,
      rfq_id: row.rfq_id ?? undefined,
      deal_id: row.deal_id ?? undefined,
      fees: row.fees ?? undefined,
      notes: row.notes ?? undefined,
    } satisfies ImportPayload['fills'][number];
  });

  const payload: ImportPayload = {
    program: {
      program_id: programRow.program_id,
      program_name: programRow.program_name ?? '',
      base_currency: programRow.base_currency ?? 'USD',
      objective: coalesceString(programRow.objective) ?? undefined,
      sleeve: coalesceString(programRow.sleeve) ?? undefined,
    },
    position: {
      program_id: programRow.program_id,
      underlier: position.underlier ?? '',
      strategy_code: position.strategy_code ?? '',
      strategy_name: position.strategy_name ?? '',
      options_structure: (position.options_structure ?? 'single_option') as OptionsStructure,
      construction: (position.construction ?? 'outright') as Construction,
      risk_defined: Boolean(position.risk_defined ?? false),
      lifecycle: (position.lifecycle ?? 'open') as StructureLifecycle,
      entry_ts: position.entry_ts ?? '',
      exit_ts: position.exit_ts ?? undefined,
      execution_route: (position.execution_route ?? 'single') as ExecutionRoute,
      order_type: position.order_type ?? undefined,
      provider: position.provider ?? undefined,
      venue_id: position.venue_id ?? undefined,
      package_order_id: position.package_order_id ?? undefined,
      order_id: position.order_id ?? undefined,
      rfq_id: position.rfq_id ?? undefined,
      deal_id: position.deal_id ?? undefined,
      trade_id: position.trade_id ?? undefined,
      fees_total: position.fees_total ?? undefined,
      fees_currency: position.fees_currency ?? undefined,
      net_fill: position.net_fill ?? 0,
      mark_at_entry: position.mark_at_entry ?? undefined,
      mark_source: position.mark_source ?? undefined,
      mark_ts: position.mark_ts ?? undefined,
      spot: position.spot ?? undefined,
      expected_move_pts: position.expected_move_pts ?? undefined,
      em_coverage_pct: position.em_coverage_pct ?? undefined,
      multiplier: position.multiplier ?? undefined,
      max_gain: position.max_gain ?? undefined,
      max_loss: position.max_loss ?? undefined,
      net_delta: position.net_delta ?? undefined,
      counterparty: position.counterparty ?? undefined,
      pricing_currency: position.pricing_currency ?? undefined,
      notes: position.notes ?? undefined,
      close_target_structure_id: position.close_target_structure_id ?? undefined,
      linked_structure_ids:
        Array.isArray(position.linked_structure_ids) && position.linked_structure_ids.length > 0
          ? position.linked_structure_ids
          : undefined,
      client_name: position.client_name ?? '',
    },
    legs: legsPayload,
    fills: fillsPayload.length > 0 ? fillsPayload : undefined,
    venue: venuePayload,
  };

  return { ok: true, payload };
}
