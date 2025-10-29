// src/features/import/types.ts

// ───────────────────────────────────────────────────────────────────────────────
// Canonical runtime lists (single source of truth for literals)
// ───────────────────────────────────────────────────────────────────────────────
export const VENUE_TYPES = ['exchange', 'rfq_network', 'otc_bilateral'] as const;
export const EXECUTION_MODES = ['CLOB', 'RFQ', 'Block'] as const;
export const LIQUIDITY_ROLES = ['maker', 'taker'] as const;
export const OPTIONS_STRUCTURES = [
  'single_option', 'vertical', 'calendar', 'diagonal', 'butterfly',
  'iron_condor', 'strangle', 'straddle', 'ratio', 'broken_wing', 'collar',
] as const;
export const CONSTRUCTIONS = [
  'outright', 'balanced', 'unbalanced', 'ratio', 'broken_wing', 'skip_strike',
] as const;
export const EXECUTION_ROUTES = ['single', 'package', 'legged'] as const;
export const ORDER_TYPES = ['market', 'limit', 'pegged', 'stop', 'stop_limit'] as const;
export const SIDES = ['buy', 'sell'] as const;
export const OPTION_TYPES = ['call', 'put'] as const;
export const STRUCTURE_LIFECYCLES = ['open', 'close'] as const;

// ───────────────────────────────────────────────────────────────────────────────
// Primitive aliases
// ───────────────────────────────────────────────────────────────────────────────
export type ISODateTime = string; // e.g., '2025-10-23T12:34:56Z'
export type ISODate = string;     // e.g., '2025-10-23'

// ───────────────────────────────────────────────────────────────────────────────
// Domain literal aliases (derived from runtime lists)
// ───────────────────────────────────────────────────────────────────────────────
export type VenueType = typeof VENUE_TYPES[number];
export type ExecutionMode = typeof EXECUTION_MODES[number];
export type LiquidityRole = typeof LIQUIDITY_ROLES[number];
export type OptionsStructure = typeof OPTIONS_STRUCTURES[number];
export type Construction = typeof CONSTRUCTIONS[number];
export type ExecutionRoute = typeof EXECUTION_ROUTES[number];
export type OrderType = typeof ORDER_TYPES[number];
export type Side = typeof SIDES[number];
export type OptionType = typeof OPTION_TYPES[number];
export type StructureLifecycle = typeof STRUCTURE_LIFECYCLES[number];

// ───────────────────────────────────────────────────────────────────────────────
// Entities
// ───────────────────────────────────────────────────────────────────────────────
export type Program = {
  program_id: string;
  program_name: string;
  base_currency: string;
  objective?: string | null;
  sleeve?: string | null;
};

export type Venue = {
  venue_id?: string; // optional (DB can create UUID)
  type: VenueType;
  name: string;
  mic?: string | null;
  underlying_exchange?: string | null;
  venue_code?: string | null;
  execution_mode?: ExecutionMode;
  liquidity_role?: LiquidityRole;
  broker?: string | null;
  clearing_firm?: string | null;
  account?: string | null;
};

export type Position = {
  program_id: string;
  underlier: string;
  strategy_code: string;
  strategy_name: string;
  options_structure: OptionsStructure;
  construction: Construction;
  risk_defined: boolean;
  lifecycle: StructureLifecycle;
  entry_ts: ISODateTime;           // ISO datetime
  exit_ts?: ISODateTime | null;
  execution_route: ExecutionRoute;
  order_type?: OrderType;
  provider?: string | null;
  venue_id?: string | null;
  package_order_id?: string | null;
  order_id?: string | null;
  rfq_id?: string | null;
  deal_id?: string | null;
  trade_id?: string | null;
  fees_total?: number | null;
  fees_currency?: string | null;
  net_fill: number;
  mark_at_entry?: number | null;
  mark_source?: string | null;
  mark_ts?: ISODateTime | null;    // ISO datetime
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
};

export type Leg = {
  leg_seq: number;
  side: Side;
  option_type: OptionType;
  expiry: ISODate; // YYYY-MM-DD
  strike: number;
  qty: number;
  price: number;
};

export type Fill = {
  ts: ISODateTime;
  qty: number;
  price: number;
  leg_seq?: number | null;
  side?: Side | null;
  liquidity_role?: LiquidityRole | null;
  execution_mode?: ExecutionMode | null;
  provider?: string | null;
  venue_id?: string | null;
  order_id?: string | null;
  trade_id?: string | null;
  rfq_id?: string | null;
  deal_id?: string | null;
  fees?: number | null;
  notes?: string | null;
};

// ───────────────────────────────────────────────────────────────────────────────
// Root payload
// ───────────────────────────────────────────────────────────────────────────────
export type ImportPayload = {
  program: Program;
  venue?: Venue;
  position: Position;
  legs: Array<Leg>;
  fills?: Array<Fill>;
};
