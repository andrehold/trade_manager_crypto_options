// src/features/import/validation.ts
import { z } from 'zod';
import type { ImportPayload } from './types';
import {
  VENUE_TYPES,
  EXECUTION_MODES,
  LIQUIDITY_ROLES,
  OPTIONS_STRUCTURES,
  CONSTRUCTIONS,
  EXECUTION_ROUTES,
  ORDER_TYPES,
  SIDES,
  OPTION_TYPES,
  STRUCTURE_LIFECYCLES,
} from './types';

// ── Shared scalars ─────────────────────────────────────────────────────────────
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const ISO_DATETIME = z.string().datetime(); // ISO 8601 (e.g., 2025-10-23T12:34:56Z)

// ── Entity Schemas ────────────────────────────────────────────────────────────
export const ProgramSchema = z.object({
  program_id: z.string().min(1),
  program_name: z.string().min(1),
  base_currency: z.string().length(3),
  objective: z.string().optional().nullable(),
  sleeve: z.string().optional().nullable(),
});

export const VenueSchema = z.object({
  venue_id: z.string().uuid().optional(),
  type: z.enum(VENUE_TYPES),
  name: z.string().min(1),
  mic: z.string().optional().nullable(),
  underlying_exchange: z.string().optional().nullable(),
  venue_code: z.string().optional().nullable(),
  execution_mode: z.enum(EXECUTION_MODES).optional(),
  liquidity_role: z.enum(LIQUIDITY_ROLES).optional(),
  broker: z.string().optional().nullable(),
  clearing_firm: z.string().optional().nullable(),
  account: z.string().optional().nullable(),
});

export const PositionSchema = z
  .object({
    program_id: z.string().min(1),
    underlier: z.string().min(1),
    strategy_code: z.string().min(1),
    strategy_name: z.string().min(1),
    client_name: z.string().min(1),
    options_structure: z.enum(OPTIONS_STRUCTURES),
    construction: z.enum(CONSTRUCTIONS),
    risk_defined: z.boolean(),
    lifecycle: z.enum(STRUCTURE_LIFECYCLES),
    entry_ts: ISO_DATETIME,
    exit_ts: ISO_DATETIME.optional().nullable(),
    execution_route: z.enum(EXECUTION_ROUTES),
    order_type: z.enum(ORDER_TYPES).optional(),
    provider: z.string().optional().nullable(),
    venue_id: z.string().uuid().optional().nullable(),
    package_order_id: z.string().optional().nullable(),
    order_id: z.string().optional().nullable(),
    rfq_id: z.string().optional().nullable(),
    deal_id: z.string().optional().nullable(),
    trade_id: z.string().optional().nullable(),
    fees_total: z.number().optional().nullable(),
    fees_currency: z.string().length(3).optional().nullable(),
    net_fill: z.number(),
    mark_at_entry: z.number().optional().nullable(),
    mark_source: z.string().optional().nullable(),
    mark_ts: ISO_DATETIME.optional().nullable(),
    spot: z.number().optional().nullable(),
    expected_move_pts: z.number().optional().nullable(),
    em_coverage_pct: z.number().optional().nullable(),
    multiplier: z.number().optional().nullable(),
    max_gain: z.number().optional().nullable(),
    max_loss: z.number().optional().nullable(),
    net_delta: z.number().optional().nullable(),
    counterparty: z.string().optional().nullable(),
    pricing_currency: z.string().length(3).optional().nullable(),
    notes: z.string().optional().nullable(),
    close_target_structure_id: z.string().optional().nullable(),
    linked_structure_ids: z.array(z.string().min(1)).min(1).optional().nullable(),
  })
  .superRefine((position, ctx) => {
    if (
      position.lifecycle === 'close' &&
      (!position.close_target_structure_id || position.close_target_structure_id.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['close_target_structure_id'],
        message: 'Required when lifecycle is close',
      });
    }
  });

export const LegSchema = z.object({
  leg_seq: z.number().int().positive(),
  side: z.enum(SIDES),
  option_type: z.enum(OPTION_TYPES),
  expiry: ISO_DATE,
  strike: z.number().positive(),
  qty: z.number().positive(),
  price: z.number(),
});

export const FillSchema = z.object({
  ts: ISO_DATETIME,
  qty: z.number().positive(),
  price: z.number(),
  leg_seq: z.number().int().positive().optional(),
  side: z.enum(SIDES).optional(),
  liquidity_role: z.enum(LIQUIDITY_ROLES).optional(),
  execution_mode: z.enum(EXECUTION_MODES).optional(),
  provider: z.string().optional(),
  venue_id: z.string().uuid().optional(),
  order_id: z.string().optional(),
  trade_id: z.string().optional(),
  rfq_id: z.string().optional(),
  deal_id: z.string().optional(),
  fees: z.number().optional(),
  notes: z.string().optional(),
});

// ── Root payload ───────────────────────────────────────────────────────────────
export const payloadSchema: z.ZodType<ImportPayload> = z.object({
  program: ProgramSchema,
  venue: VenueSchema.optional(),
  position: PositionSchema,
  legs: z.array(LegSchema).min(1),
  fills: z.array(FillSchema).optional(),
});
