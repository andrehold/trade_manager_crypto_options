import type {
  CanonicalDataAccount,
  CanonicalDataAccountPage,
  CanonicalLatestPositionPage,
  CanonicalLedgerEvent,
  CanonicalLedgerEventPage,
  CanonicalPosition,
  CanonicalPositionSnapshot,
  CanonicalSummary,
  CanonicalSummaryComponent,
  ExactDecimal,
} from './schemas';
import {
  dataAccountPageSchema,
  dataAccountSchema,
  latestPositionPageSchema,
  ledgerEventPageSchema,
  positionPageSchema,
  positionSchema,
  positionSnapshotSchema,
  summaryComponentSchema,
  summaryPageSchema,
  summarySchema,
} from './schemas';

export type DatasetQuality = 'complete' | 'partial';

export interface DatasetProvenance {
  canonicalSchemaVersion: string;
  runId: string;
  fetchedAt: string;
  venueObservedAt: string | null;
  processingVersion: string;
  quality: DatasetQuality;
  venue: string | null;
}

export interface HubAccount {
  id: string;
  label: string;
  venue: string;
  environment: string;
  externalAccountIdentifier: string | null;
  enabled: boolean;
  activatedAt: string;
}

export interface HubSummaryComponent {
  currency: string;
  componentScope: string;
  equity: ExactDecimal | null;
  balance: ExactDecimal | null;
  collateral: ExactDecimal | null;
  availableFunds: ExactDecimal | null;
  availableWithdrawalFunds: ExactDecimal | null;
  initialMargin: ExactDecimal | null;
  maintenanceMargin: ExactDecimal | null;
  realizedPnl: ExactDecimal | null;
  unrealizedPnl: ExactDecimal | null;
  attributes: Record<string, unknown>;
}

export interface HubSummary extends DatasetProvenance {
  id: string;
  accountId: string;
  accountLabel: string | null;
  sourceRawBatchId: string | null;
  ingestedAt: string | null;
  components: HubSummaryComponent[];
  attributes: Record<string, unknown>;
}

export interface HubPositionSnapshot extends DatasetProvenance {
  id: string;
  accountId: string;
  accountLabel: string | null;
  sourceRawBatchId: string | null;
  ingestedAt: string | null;
  positionCount: number;
}

export interface HubPosition {
  id: string;
  snapshotId: string;
  accountId: string | null;
  accountLabel: string | null;
  runId: string | null;
  venue: string | null;
  sourceRawBatchId: string | null;
  ingestedAt: string | null;
  processingVersion: string | null;
  nativeInstrumentId: string;
  venueRecordIdentifier: string | null;
  instrumentType: 'spot' | 'perpetual' | 'future' | 'option' | 'unknown' | null;
  baseCurrency: string | null;
  quoteCurrency: string | null;
  settlementCurrency: string | null;
  direction: 'long' | 'short' | 'flat' | 'unknown' | null;
  quantity: ExactDecimal | null;
  quantityUnit: string | null;
  averagePrice: ExactDecimal | null;
  markPrice: ExactDecimal | null;
  indexPrice: ExactDecimal | null;
  indexPriceCurrency: string | null;
  notional: ExactDecimal | null;
  notionalUnit: string | null;
  realizedPnl: ExactDecimal | null;
  unrealizedPnl: ExactDecimal | null;
  initialMargin: ExactDecimal | null;
  maintenanceMargin: ExactDecimal | null;
  liquidationPrice: ExactDecimal | null;
  expiryAt: string | null;
  strike: ExactDecimal | null;
  strikeCurrency: string | null;
  optionSide: 'call' | 'put' | null;
  attributes: Record<string, unknown>;
}

export interface HubLedgerEvent {
  id: string;
  accountId: string;
  runId: string;
  eventGroupIdentifier: string;
  eventComponentIndex: number;
  eventType: CanonicalLedgerEvent['event_type'];
  eventTime: string;
  accountLabel: string | null;
  venue: string | null;
  venueEventIdentifier: string | null;
  deduplicationKey: string | null;
  sourceRawBatchId: string | null;
  ingestedAt: string | null;
  nativeInstrumentId: string | null;
  side: string | null;
  quantity: ExactDecimal | null;
  quantityUnit: string | null;
  amount: ExactDecimal | null;
  currency: string | null;
  price: ExactDecimal | null;
  priceCurrency: string | null;
  orderIdentifier: string | null;
  tradeIdentifier: string | null;
  transactionHash: string | null;
  processingVersion: string;
  attributes: Record<string, unknown>;
}

export interface HubPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface HubLatestPositionPage extends HubPage<HubPosition> {
  snapshot: HubPositionSnapshot;
}

function nullableOptional(value: string | null | undefined): string | null {
  return value ?? null;
}

function normalizeProvenance(
  record: CanonicalSummary | CanonicalPositionSnapshot,
): DatasetProvenance {
  return {
    canonicalSchemaVersion: record.canonical_schema_version,
    runId: record.run_id,
    fetchedAt: record.fetched_at,
    venueObservedAt: record.venue_observed_at,
    processingVersion: record.processing_version,
    quality: 'completeness' in record
      ? (record as CanonicalSummary).completeness
      : (record as CanonicalPositionSnapshot).status,
    venue: nullableOptional(record.venue),
  };
}

export function normalizeHubAccount(account: CanonicalDataAccount): HubAccount {
  return {
    id: account.id,
    label: account.label,
    venue: account.venue,
    environment: account.environment,
    externalAccountIdentifier: account.external_account_identifier,
    enabled: account.enabled,
    activatedAt: account.activated_at,
  };
}

export function normalizeHubSummaryComponent(component: CanonicalSummaryComponent): HubSummaryComponent {
  return {
    currency: component.currency,
    componentScope: component.component_scope,
    equity: component.equity,
    balance: component.balance,
    collateral: component.collateral,
    availableFunds: component.available_funds,
    availableWithdrawalFunds: component.available_withdrawal_funds,
    initialMargin: component.initial_margin,
    maintenanceMargin: component.maintenance_margin,
    realizedPnl: component.realized_pnl,
    unrealizedPnl: component.unrealized_pnl,
    attributes: component.attributes,
  };
}

export function normalizeHubSummary(summary: CanonicalSummary): HubSummary {
  return {
    ...normalizeProvenance(summary),
    id: summary.id,
    accountId: summary.account_id,
    accountLabel: nullableOptional(summary.account_label),
    sourceRawBatchId: nullableOptional(summary.source_raw_batch_id),
    ingestedAt: nullableOptional(summary.ingested_at),
    components: summary.components.map(normalizeHubSummaryComponent),
    attributes: summary.attributes,
  };
}

export function normalizeHubPositionSnapshot(snapshot: CanonicalPositionSnapshot): HubPositionSnapshot {
  return {
    ...normalizeProvenance(snapshot),
    id: snapshot.id,
    accountId: snapshot.account_id,
    accountLabel: nullableOptional(snapshot.account_label),
    sourceRawBatchId: nullableOptional(snapshot.source_raw_batch_id),
    ingestedAt: nullableOptional(snapshot.ingested_at),
    positionCount: snapshot.position_count,
  };
}

export function normalizeHubPosition(position: CanonicalPosition): HubPosition {
  return {
    id: position.id,
    snapshotId: position.snapshot_id,
    accountId: nullableOptional(position.account_id),
    accountLabel: nullableOptional(position.account_label),
    runId: nullableOptional(position.run_id),
    venue: nullableOptional(position.venue),
    sourceRawBatchId: nullableOptional(position.source_raw_batch_id),
    ingestedAt: nullableOptional(position.ingested_at),
    processingVersion: nullableOptional(position.processing_version),
    nativeInstrumentId: position.native_instrument_id,
    venueRecordIdentifier: position.venue_record_identifier,
    instrumentType: position.instrument_type,
    baseCurrency: position.base_currency,
    quoteCurrency: position.quote_currency,
    settlementCurrency: position.settlement_currency,
    direction: position.direction,
    quantity: position.quantity,
    quantityUnit: position.quantity_unit,
    averagePrice: position.average_price,
    markPrice: position.mark_price,
    indexPrice: position.index_price,
    indexPriceCurrency: nullableOptional(position.index_price_currency),
    notional: position.notional,
    notionalUnit: position.notional_unit,
    realizedPnl: position.realized_pnl,
    unrealizedPnl: position.unrealized_pnl,
    initialMargin: position.initial_margin,
    maintenanceMargin: position.maintenance_margin,
    liquidationPrice: position.liquidation_price,
    expiryAt: position.expiry_at,
    strike: position.strike,
    strikeCurrency: nullableOptional(position.strike_currency),
    optionSide: position.option_side,
    attributes: position.attributes,
  };
}

export function normalizeHubLedgerEvent(event: CanonicalLedgerEvent): HubLedgerEvent {
  return {
    id: event.id,
    accountId: event.account_id,
    runId: event.run_id,
    eventGroupIdentifier: event.event_group_identifier,
    eventComponentIndex: event.event_component_index,
    eventType: event.event_type,
    eventTime: event.event_time,
    accountLabel: nullableOptional(event.account_label),
    venue: nullableOptional(event.venue),
    venueEventIdentifier: event.venue_event_identifier,
    deduplicationKey: nullableOptional(event.deduplication_key),
    sourceRawBatchId: nullableOptional(event.source_raw_batch_id),
    ingestedAt: nullableOptional(event.ingested_at),
    nativeInstrumentId: event.native_instrument_id,
    side: event.side,
    quantity: event.quantity,
    quantityUnit: event.quantity_unit,
    amount: event.amount,
    currency: event.currency,
    price: event.price,
    priceCurrency: event.price_currency,
    orderIdentifier: event.order_identifier,
    tradeIdentifier: event.trade_identifier,
    transactionHash: event.transaction_hash,
    processingVersion: event.processing_version,
    attributes: event.attributes,
  };
}

export function parseHubAccount(input: unknown): HubAccount {
  return normalizeHubAccount(dataAccountSchema.parse(input));
}

export function parseHubAccountPage(input: unknown): HubPage<HubAccount> {
  const page: CanonicalDataAccountPage = dataAccountPageSchema.parse(input);
  return { items: page.items.map(normalizeHubAccount), nextCursor: null };
}

export function parseHubSummary(input: unknown): HubSummary {
  return normalizeHubSummary(summarySchema.parse(input));
}

export function parseHubSummaryPage(input: unknown): HubPage<HubSummary> {
  const page = summaryPageSchema.parse(input);
  return { items: page.items.map(normalizeHubSummary), nextCursor: page.next_cursor ?? null };
}

export function parseHubPositionSnapshot(input: unknown): HubPositionSnapshot {
  return normalizeHubPositionSnapshot(positionSnapshotSchema.parse(input));
}

export function parseHubPosition(input: unknown): HubPosition {
  return normalizeHubPosition(positionSchema.parse(input));
}

export function parseHubPositionPage(input: unknown): HubPage<HubPosition> {
  const page = positionPageSchema.parse(input);
  return { items: page.items.map(normalizeHubPosition), nextCursor: page.next_cursor ?? null };
}

export function parseHubLatestPositionPage(input: unknown): HubLatestPositionPage {
  const page: CanonicalLatestPositionPage = latestPositionPageSchema.parse(input);
  return {
    items: page.items.map(normalizeHubPosition),
    snapshot: normalizeHubPositionSnapshot(page.snapshot),
    nextCursor: page.next_cursor ?? null,
  };
}

export function parseHubLedgerEventPage(input: unknown): HubPage<HubLedgerEvent> {
  const page: CanonicalLedgerEventPage = ledgerEventPageSchema.parse(input);
  return { items: page.items.map(normalizeHubLedgerEvent), nextCursor: page.next_cursor ?? null };
}
