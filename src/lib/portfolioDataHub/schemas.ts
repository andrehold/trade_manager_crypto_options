import { z } from 'zod';

/** Canonical Contract v1 accepts additive fields, but not a different major. */
export const SUPPORTED_CANONICAL_MAJOR = 1;

const canonicalSchemaVersionPattern = /^(\d+)\.(\d+)(?:\.\d+)?$/;

export function isSupportedCanonicalSchemaVersion(value: string): boolean {
  const match = canonicalSchemaVersionPattern.exec(value);
  return match !== null && Number(match[1]) === SUPPORTED_CANONICAL_MAJOR;
}

export const canonicalSchemaVersionSchema = z.string().refine(isSupportedCanonicalSchemaVersion, {
  message: `Unsupported Canonical Contract major version; expected ${SUPPORTED_CANONICAL_MAJOR}.x`,
});

declare const exactDecimal: unique symbol;

/**
 * Decimal values arrive as strings so they never cross JavaScript binary
 * floating point on the way from the Hub to the portal.
 */
export type ExactDecimal = string & { readonly [exactDecimal]: true };

const exactDecimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export const exactDecimalSchema = z.string().regex(exactDecimalPattern, {
  message: 'Expected an exact decimal string',
}).transform((value) => value as ExactDecimal);

const nullableExactDecimalSchema = exactDecimalSchema.nullable();
const nullableStringSchema = z.string().nullable();
const nullableUuidSchema = z.string().uuid().nullable();
const dateTimeSchema = z.string().datetime({ offset: true });
const nullableDateTimeSchema = dateTimeSchema.nullable();
const attributesSchema = z.record(z.string(), z.unknown());

const contractObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();

export const dataAccountSchema = contractObject({
  canonical_schema_version: canonicalSchemaVersionSchema,
  id: z.string().uuid(),
  label: z.string(),
  venue: z.string(),
  environment: z.string(),
  external_account_identifier: nullableStringSchema,
  enabled: z.boolean(),
  activated_at: dateTimeSchema,
});

export const dataAccountPageSchema = contractObject({
  canonical_schema_version: canonicalSchemaVersionSchema,
  items: z.array(dataAccountSchema),
});

export const summaryComponentSchema = contractObject({
  currency: z.string(),
  component_scope: z.string(),
  equity: nullableExactDecimalSchema,
  balance: nullableExactDecimalSchema,
  collateral: nullableExactDecimalSchema,
  available_funds: nullableExactDecimalSchema,
  available_withdrawal_funds: nullableExactDecimalSchema,
  initial_margin: nullableExactDecimalSchema,
  maintenance_margin: nullableExactDecimalSchema,
  realized_pnl: nullableExactDecimalSchema,
  unrealized_pnl: nullableExactDecimalSchema,
  attributes: attributesSchema,
});

export const summarySchema = contractObject({
  canonical_schema_version: canonicalSchemaVersionSchema,
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  run_id: z.string().uuid(),
  fetched_at: dateTimeSchema,
  venue_observed_at: nullableDateTimeSchema,
  processing_version: z.string(),
  completeness: z.enum(['complete', 'partial']),
  attributes: attributesSchema,
  components: z.array(summaryComponentSchema),
  account_label: nullableStringSchema.optional(),
  venue: nullableStringSchema.optional(),
  ingested_at: nullableDateTimeSchema.optional(),
  source_raw_batch_id: nullableUuidSchema.optional(),
});

export const summaryPageSchema = contractObject({
  canonical_schema_version: canonicalSchemaVersionSchema,
  items: z.array(summarySchema),
  next_cursor: nullableStringSchema.optional(),
});

export const positionSnapshotSchema = contractObject({
  canonical_schema_version: canonicalSchemaVersionSchema,
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  run_id: z.string().uuid(),
  fetched_at: dateTimeSchema,
  venue_observed_at: nullableDateTimeSchema,
  status: z.enum(['complete', 'partial']),
  position_count: z.number().int().nonnegative(),
  processing_version: z.string(),
  account_label: nullableStringSchema.optional(),
  venue: nullableStringSchema.optional(),
  ingested_at: nullableDateTimeSchema.optional(),
  source_raw_batch_id: nullableUuidSchema.optional(),
});

export const positionSchema = contractObject({
  canonical_schema_version: canonicalSchemaVersionSchema,
  id: z.string().uuid(),
  snapshot_id: z.string().uuid(),
  venue_record_identifier: nullableStringSchema,
  native_instrument_id: z.string(),
  instrument_type: z.enum(['spot', 'perpetual', 'future', 'option', 'unknown']).nullable(),
  base_currency: nullableStringSchema,
  quote_currency: nullableStringSchema,
  settlement_currency: nullableStringSchema,
  direction: z.enum(['long', 'short', 'flat', 'unknown']).nullable(),
  quantity: nullableExactDecimalSchema,
  quantity_unit: nullableStringSchema,
  average_price: nullableExactDecimalSchema,
  mark_price: nullableExactDecimalSchema,
  index_price: nullableExactDecimalSchema,
  // Additive v1 fields. Do not infer either price unit from quote_currency:
  // inverse options can quote their premium in BTC while their index and
  // strike remain USD-denominated.
  index_price_currency: nullableStringSchema.optional(),
  notional: nullableExactDecimalSchema,
  notional_unit: nullableStringSchema,
  realized_pnl: nullableExactDecimalSchema,
  unrealized_pnl: nullableExactDecimalSchema,
  initial_margin: nullableExactDecimalSchema,
  maintenance_margin: nullableExactDecimalSchema,
  liquidation_price: nullableExactDecimalSchema,
  expiry_at: nullableDateTimeSchema,
  strike: nullableExactDecimalSchema,
  strike_currency: nullableStringSchema.optional(),
  option_side: z.enum(['call', 'put']).nullable(),
  attributes: attributesSchema,
  account_id: nullableUuidSchema.optional(),
  account_label: nullableStringSchema.optional(),
  run_id: nullableUuidSchema.optional(),
  venue: nullableStringSchema.optional(),
  source_raw_batch_id: nullableUuidSchema.optional(),
  ingested_at: nullableDateTimeSchema.optional(),
  processing_version: nullableStringSchema.optional(),
});

export const positionPageSchema = contractObject({
  canonical_schema_version: canonicalSchemaVersionSchema,
  items: z.array(positionSchema),
  next_cursor: nullableStringSchema.optional(),
});

export const latestPositionPageSchema = contractObject({
  canonical_schema_version: canonicalSchemaVersionSchema,
  items: z.array(positionSchema),
  snapshot: positionSnapshotSchema,
  next_cursor: nullableStringSchema.optional(),
});

export const ledgerEventSchema = contractObject({
  canonical_schema_version: canonicalSchemaVersionSchema,
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  run_id: z.string().uuid(),
  event_group_identifier: z.string(),
  event_component_index: z.number().int().nonnegative(),
  venue_event_identifier: nullableStringSchema,
  event_type: z.enum([
    'trade', 'fee', 'rebate', 'funding', 'deposit', 'withdrawal', 'transfer',
    'settlement', 'liquidation', 'interest', 'adjustment', 'other',
  ]),
  event_time: dateTimeSchema,
  native_instrument_id: nullableStringSchema,
  side: nullableStringSchema,
  quantity: nullableExactDecimalSchema,
  quantity_unit: nullableStringSchema,
  amount: nullableExactDecimalSchema,
  currency: nullableStringSchema,
  price: nullableExactDecimalSchema,
  price_currency: nullableStringSchema,
  order_identifier: nullableStringSchema,
  trade_identifier: nullableStringSchema,
  transaction_hash: nullableStringSchema,
  processing_version: z.string(),
  attributes: attributesSchema,
  account_label: nullableStringSchema.optional(),
  venue: nullableStringSchema.optional(),
  source_raw_batch_id: nullableUuidSchema.optional(),
  deduplication_key: nullableStringSchema.optional(),
  ingested_at: nullableDateTimeSchema.optional(),
});

export const ledgerEventPageSchema = contractObject({
  canonical_schema_version: canonicalSchemaVersionSchema,
  items: z.array(ledgerEventSchema),
  next_cursor: nullableStringSchema.optional(),
});

export type CanonicalDataAccount = z.infer<typeof dataAccountSchema>;
export type CanonicalDataAccountPage = z.infer<typeof dataAccountPageSchema>;
export type CanonicalSummaryComponent = z.infer<typeof summaryComponentSchema>;
export type CanonicalSummary = z.infer<typeof summarySchema>;
export type CanonicalSummaryPage = z.infer<typeof summaryPageSchema>;
export type CanonicalPositionSnapshot = z.infer<typeof positionSnapshotSchema>;
export type CanonicalPosition = z.infer<typeof positionSchema>;
export type CanonicalPositionPage = z.infer<typeof positionPageSchema>;
export type CanonicalLatestPositionPage = z.infer<typeof latestPositionPageSchema>;
export type CanonicalLedgerEvent = z.infer<typeof ledgerEventSchema>;
export type CanonicalLedgerEventPage = z.infer<typeof ledgerEventPageSchema>;
