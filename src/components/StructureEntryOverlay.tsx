import React from 'react';
import { X } from 'lucide-react';
import Overlay from './Overlay';
import type { Position, TxnRow } from '../utils';
import { computeMissing } from '../features/import/missing';
import { importTrades } from '../lib/import';
import type { ImportPayload } from '../lib/import';
import { tryGetSupabaseClient } from '../lib/supabase';
import { useAuth } from '../features/auth/useAuth';
import { fetchStructurePayload } from '../lib/positions/fetchStructurePayload';
import { syncLinkedStructures } from '../lib/positions/syncLinkedStructures';
import {
  OPTIONS_STRUCTURES,
  CONSTRUCTIONS,
  EXECUTION_ROUTES,
  ORDER_TYPES,
  VENUE_TYPES,
  EXECUTION_MODES,
  LIQUIDITY_ROLES,
  OPTION_TYPES,
  STRUCTURE_LIFECYCLES,
} from '../lib/import/types';

type PartialPayload = {
  program?: Partial<ImportPayload['program']>;
  venue?: Partial<NonNullable<ImportPayload['venue']>> | null;
  position?: Partial<ImportPayload['position']>;
  legs?: Array<Partial<ImportPayload['legs'][number]>>;
  fills?: Array<Partial<NonNullable<ImportPayload['fills']>[number]>>;
};

type PathSegment = string | number;

type FieldMeta = {
  label: string;
  path: string;
  type?: 'text' | 'number' | 'select' | 'textarea';
  valueType: 'string' | 'number' | 'integer';
  options?: readonly string[];
  placeholder?: string;
  helperText?: string;
  required?: boolean;
  step?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
};

type CheckboxMeta = {
  label: string;
  path: string;
  helperText?: string;
  required?: boolean;
};

type StructureEntryOverlayMode = 'create' | 'update';

const REQUIRED_LEG_SUFFIXES = [
  'leg_seq',
  'side',
  'option_type',
  'expiry',
  'strike',
  'qty',
  'price',
];

const REQUIRED_FILL_SUFFIXES = ['ts', 'qty', 'price'];

const LEG_FIELD_LABELS: Record<string, string> = {
  leg_seq: 'Leg Sequence',
  side: 'Side',
  option_type: 'Option Type',
  expiry: 'Expiry (YYYY-MM-DD)',
  strike: 'Strike',
  qty: 'Quantity',
  price: 'Price',
};

const FILL_FIELD_LABELS: Record<string, string> = {
  ts: 'Timestamp',
  qty: 'Quantity',
  price: 'Price',
  leg_seq: 'Leg Sequence',
  side: 'Side',
  liquidity_role: 'Liquidity Role',
  execution_mode: 'Execution Mode',
  provider: 'Provider',
  venue_id: 'Venue ID',
  order_id: 'Order ID',
  trade_id: 'Trade ID',
  rfq_id: 'RFQ ID',
  deal_id: 'Deal ID',
  fees: 'Fees',
  notes: 'Notes',
};

function joinPathSegments(path: PathSegment[]): string {
  if (!path.length) return '';
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`;
    }
    return acc ? `${acc}.${segment}` : segment;
  }, '');
}

function describeIssueValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => describeIssueValue(item)).join(', ');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type FormatSaveErrorDetailsOptions = {
  getLabel?: (path: string, segments: PathSegment[]) => string | undefined;
  getValue?: (path: string, segments: PathSegment[]) => unknown;
};

const DUMMY_LINKABLE_STRUCTURE_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: 'demo-structure-1', label: '#101 • BTC-USD • 2024-06-28 • DERIBIT' },
  { value: 'demo-structure-2', label: '#204 • ETH-USD • 2024-07-12 • CME' },
  { value: 'demo-structure-3', label: '#305 • SOL-USD • 2024-08-30 • BINANCE' },
];

function formatSaveErrorDetails(
  details: unknown,
  options: FormatSaveErrorDetailsOptions = {},
): string | null {
  if (!details) return null;

  if (typeof details === 'string') {
    return details;
  }

  if (details && typeof details === 'object') {
    if ('issues' in details && Array.isArray((details as { issues?: unknown }).issues)) {
      const issues = (details as { issues?: unknown }).issues;
      const grouped = new Map<string, { label?: string; path?: string; messages: string[] }>();

      for (const issue of issues as unknown[]) {
        if (!issue || typeof issue !== 'object') continue;
        const message = typeof (issue as { message?: unknown }).message === 'string'
          ? (issue as { message?: string }).message.trim()
          : '';
        if (!message) continue;
        const code = typeof (issue as { code?: unknown }).code === 'string'
          ? (issue as { code?: string }).code
          : undefined;
        const expected = (issue as { expected?: unknown }).expected;
        const received = (issue as { received?: unknown }).received;
        const rawPath = Array.isArray((issue as { path?: unknown }).path)
          ? ((issue as { path?: PathSegment[] }).path ?? [])
          : [];
        const pathSegments = rawPath.filter(
          (segment): segment is PathSegment => typeof segment === 'string' || typeof segment === 'number',
        );
        const pathString = joinPathSegments(pathSegments);
        const label = options.getLabel?.(pathString, pathSegments);
        const key = pathString || label || message;
        const entry = grouped.get(key) ?? {
          label,
          path: pathString,
          messages: [],
        };
        const expectationParts: string[] = [];
        if (expected !== undefined) {
          expectationParts.push(`expected ${describeIssueValue(expected)}`);
        }
        const actualValue =
          received !== undefined ? received : options.getValue?.(pathString, pathSegments);
        if (actualValue !== undefined) {
          expectationParts.push(`received ${describeIssueValue(actualValue)}`);
        }
        const isIsoIssue =
          code === 'invalid_format' && typeof message === 'string' && message.toLowerCase().includes('iso datetime');
        if (isIsoIssue && !expectationParts.some((part) => part.startsWith('expected'))) {
          expectationParts.push('expected ISO 8601 datetime like 2024-06-01T15:30:00Z');
        }
        const formattedMessage = expectationParts.length
          ? `${message} (${expectationParts.join(', ')})`
          : message;
        entry.messages.push(code && code !== 'custom' ? `${formattedMessage} [${code}]` : formattedMessage);
        grouped.set(key, entry);
      }

      if (grouped.size > 0) {
        return Array.from(grouped.values())
          .map((entry) => {
            const subject = entry.label || entry.path || 'Payload';
            const suffix = entry.messages.length === 1
              ? entry.messages[0]
              : entry.messages.join('; ');
            return `• ${subject}: ${suffix}`;
          })
          .join('\n');
      }
    }

    if ('fieldErrors' in details && 'formErrors' in details) {
      const fieldErrors = (details as {
        fieldErrors?: Record<string, unknown>;
        formErrors?: unknown;
      }).fieldErrors;
      const formErrors = (details as { formErrors?: unknown }).formErrors;
      const lines: string[] = [];

      if (Array.isArray(formErrors) && formErrors.length > 0) {
        for (const message of formErrors) {
          if (typeof message === 'string' && message.trim().length > 0) {
            lines.push(`• ${message}`);
          }
        }
      }

      if (fieldErrors && typeof fieldErrors === 'object') {
        for (const [path, messages] of Object.entries(fieldErrors)) {
          if (!Array.isArray(messages)) continue;
          const filtered = messages.filter(
            (message): message is string => typeof message === 'string' && message.trim().length > 0,
          );
          if (!filtered.length) continue;
          const suffix = filtered.length === 1 ? filtered[0] : filtered.join('; ');
          const segments = parsePath(path);
          const label = options.getLabel?.(path, segments);
          const subject = label || path;
          lines.push(`• ${subject}: ${suffix}`);
        }
      }

      if (lines.length > 0) {
        return lines.join('\n');
      }
    }
  }

  try {
    return JSON.stringify(details, null, 2);
  } catch (err) {
    return String(details);
  }
}

/**
 * Break a string path like `legs[0].qty` into discrete object/array segments
 * so the value can be read or written in a type-safe way later on.
 */
function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const parts = path.split('.');
  for (const part of parts) {
    const regex = /([^\[]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(part))) {
      if (match[1]) segments.push(match[1]);
      if (match[2]) segments.push(Number(match[2]));
    }
  }
  return segments;
}

/**
 * Safely walks a nested object following the provided path and returns the
 * value if every segment can be resolved. Any missing/invalid segment returns
 * `undefined` instead of throwing.
 */
function getValue(obj: unknown, path: PathSegment[]): any {
  return path.reduce<any>((acc, seg) => {
    if (acc == null) return undefined;
    if (typeof seg === 'number') {
      if (!Array.isArray(acc)) return undefined;
      return acc[seg];
    }
    if (typeof acc !== 'object') return undefined;
    return (acc as Record<string, any>)[seg];
  }, obj);
}

/**
 * Clones the provided object (shallowly) and writes a value at the requested
 * path. Any missing intermediate structures are created using sensible
 * defaults (arrays for numeric keys, objects otherwise).
 */
function setValue<T>(obj: T, path: PathSegment[], value: any): T {
  if (!path.length) return value;
  const [head, ...tail] = path;
  const clone: any = Array.isArray(obj) ? [...(obj as any[])] : { ...(obj as any) };
  if (tail.length === 0) {
    clone[head as any] = value;
    return clone;
  }
  const current = clone[head as any];
  const nextDefault = typeof tail[0] === 'number' ? [] : {};
  clone[head as any] = setValue(current ?? nextDefault, tail, value);
  return clone;
}

/**
 * When venue information is optional we either strip it from the payload or
 * ensure a minimal stub exists so the downstream schema validation succeeds.
 */
function ensureVenue(payload: PartialPayload, include: boolean): PartialPayload {
  if (!include) {
    const copy: PartialPayload = { ...payload };
    if ('venue' in copy) {
      delete (copy as Record<string, unknown>).venue;
    }
    return copy;
  }
  if (payload.venue) return payload;
  return {
    ...payload,
    venue: {
      type: VENUE_TYPES[0],
      name: '',
    },
  };
}

/** Convert a timestamp to ISO 8601 when we can, otherwise preserve the input. */
function safeIso(ts?: string | null): string | undefined {
  if (!ts) return undefined;
  const trimmed = ts.trim();
  if (!trimmed) return undefined;

  const queue: string[] = [trimmed];
  const seen = new Set<string>();
  const candidates: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    candidates.push(current);

    if (/\s/.test(current)) {
      queue.push(current.replace(/\s+/, 'T'));
    }

    const normalizedTzSpacing = current.replace(/\s*([+-]\d{2}:?\d{2})$/, '$1');
    if (normalizedTzSpacing !== current) {
      queue.push(normalizedTzSpacing);
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(current)) {
      queue.push(`${current}:00`);
    }

    const tzCompact = current.match(/([+-]\d{2})(\d{2})$/);
    if (tzCompact) {
      queue.push(`${current.slice(0, -tzCompact[0].length)}${tzCompact[1]}:${tzCompact[2]}`);
    }

    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(current)) {
      queue.push(`${current}Z`);
    }
  }

  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return undefined;
}

function normalizeTimestampFields(payload: PartialPayload): PartialPayload {
  let next = payload;

  const updatePath = (path: string) => {
    const segments = parsePath(path);
    const value = getValue(next, segments);

    let iso: string | undefined;
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
      iso = value.toISOString();
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      iso = new Date(value).toISOString();
    } else if (typeof value === 'string') {
      iso = safeIso(value);
    }

    if (iso && typeof iso === 'string' && iso !== value) {
      next = setValue(next, segments, iso);
    }
  };

  updatePath('position.entry_ts');
  updatePath('position.exit_ts');
  updatePath('position.mark_ts');

  if (Array.isArray(payload.fills)) {
    payload.fills.forEach((_, idx) => updatePath(`fills[${idx}].ts`));
  }

  return next;
}

/** Total fees incurred across every leg in the position. */
function sumFees(legs: Position['legs']): number {
  return legs.reduce((acc, leg) => {
    const total = leg.trades?.reduce((sum, trade) => sum + (trade.fee ?? 0), 0) ?? 0;
    return acc + total;
  }, 0);
}

/**
 * Consolidate individual trade fills into a single signed notional to seed the
 * `net_fill` field in the import payload.
 */
function computeNetFill(legs: Position['legs']): number {
  return legs.reduce((acc, leg) => {
    const legTotal = leg.trades?.reduce((sum, trade) => {
      const qty = Math.abs(trade.amount ?? 0);
      const price = trade.price ?? 0;
      const sign = trade.side === 'buy' ? 1 : trade.side === 'sell' ? -1 : 0;
      return sum + sign * price * qty;
    }, 0) ?? 0;
    return acc + legTotal;
  }, 0);
}

/** Pick the first trade we encounter, primarily for default metadata fields. */
function firstTrade(legs: Position['legs']): TxnRow | undefined {
  for (const leg of legs) {
    if (leg.trades?.length) return leg.trades[0];
  }
  return undefined;
}

/** Flatten every trade from each leg into a single array for aggregation. */
function collectAllTrades(legs: Position['legs']): TxnRow[] {
  const trades: TxnRow[] = [];
  for (const leg of legs) {
    if (leg.trades?.length) trades.push(...leg.trades);
  }
  return trades;
}

/** Timestamp helpers used for default entry/exit values in the overlay form. */
function earliestTimestamp(trades: TxnRow[]): string | undefined {
  const sorted = trades
    .map((t) => ({ raw: t.timestamp, time: t.timestamp ? Date.parse(t.timestamp) : NaN }))
    .filter((t) => t.raw && !Number.isNaN(t.time))
    .sort((a, b) => a.time - b.time);
  return sorted[0]?.raw;
}

function latestTimestamp(trades: TxnRow[]): string | undefined {
  const sorted = trades
    .map((t) => ({ raw: t.timestamp, time: t.timestamp ? Date.parse(t.timestamp) : NaN }))
    .filter((t) => t.raw && !Number.isNaN(t.time))
    .sort((a, b) => b.time - a.time);
  return sorted[0]?.raw;
}

/**
 * Translate existing position legs into the structured shape expected by the
 * import API, pre-populating values wherever the source data is clear enough.
 */
function buildInitialLegs(position: Position): Array<Partial<ImportPayload['legs'][number]>> {
  return position.legs.map((leg, idx) => {
    const totalQty = leg.trades?.reduce((sum, trade) => sum + Math.abs(trade.amount ?? 0), 0) ?? 0;
    const qty = totalQty || Math.abs(leg.qtyNet) || undefined;
    const totalPremium = leg.trades?.reduce(
      (sum, trade) => sum + Math.abs(trade.amount ?? 0) * (trade.price ?? 0),
      0,
    ) ?? 0;
    const avgPrice = qty ? totalPremium / qty : undefined;
    const first = leg.trades?.[0];
    const side = (first?.side ?? (leg.qtyNet >= 0 ? 'buy' : 'sell')) as 'buy' | 'sell';
    const optionType = leg.optionType?.toLowerCase() === 'p' ? 'put' : 'call';
    return {
      leg_seq: idx + 1,
      side,
      option_type: optionType as (typeof OPTION_TYPES)[number],
      expiry: position.expiryISO,
      strike: leg.strike,
      qty,
      price: avgPrice ?? first?.price ?? undefined,
    };
  });
}

/**
 * Rehydrate trade-level information so that each fill row matches the import
 * schema (including references back to the originating leg).
 */
function buildInitialFills(
  position: Position,
): Array<Partial<NonNullable<ImportPayload['fills']>[number]>> {
  const fills: Array<Partial<NonNullable<ImportPayload['fills']>[number]>> = [];
  position.legs.forEach((leg, idx) => {
    leg.trades?.forEach((trade) => {
      fills.push({
        ts: safeIso(trade.timestamp) ?? trade.timestamp,
        qty: Math.abs(trade.amount ?? 0) || undefined,
        price: trade.price ?? undefined,
        leg_seq: idx + 1,
        side: trade.side as any,
        execution_mode: undefined,
        provider: trade.exchange,
        venue_id: undefined,
        order_id: trade.order_id,
        trade_id: trade.trade_id,
        rfq_id: undefined,
        deal_id: undefined,
        fees: trade.fee,
        notes: trade.info,
      });
    });
  });
  return fills;
}

/**
 * Build the complete default payload for the overlay using the information we
 * already have from the parsed position. The result is the baseline state for
 * the interactive form, so it aims to fill in as much as possible.
 */
function buildInitialPayload(position: Position): PartialPayload {
  const trades = collectAllTrades(position.legs);
  const entryTs = earliestTimestamp(trades);
  const exitTs = latestTimestamp(trades);
  const first = firstTrade(position.legs);
  const feesTotal = sumFees(position.legs);
  const netFill = computeNetFill(position.legs);

  const program = {
    program_id: '',
    program_name: '',
    base_currency: 'USD',
    objective: '',
    sleeve: '',
  } satisfies Partial<ImportPayload['program']>;

  const positionDetails: Partial<ImportPayload['position']> = {
    program_id: program.program_id,
    underlier: position.underlying,
    strategy_code: position.strategy ?? '',
    strategy_name: position.strategy ?? '',
    options_structure: position.legs.length > 1 ? 'strangle' : 'single_option',
    construction: position.legs.length > 1 ? 'balanced' : 'outright',
    risk_defined: position.legs.length > 1,
    lifecycle: 'open',
    entry_ts: safeIso(entryTs) ?? entryTs,
    exit_ts: safeIso(exitTs) ?? undefined,
    execution_route: position.legs.length > 1 ? 'package' : 'single',
    order_type: undefined,
    provider: first?.exchange,
    venue_id: undefined,
    package_order_id: undefined,
    order_id: first?.order_id,
    rfq_id: undefined,
    deal_id: undefined,
    trade_id: first?.trade_id,
    fees_total: feesTotal || undefined,
    fees_currency: feesTotal ? 'USD' : undefined,
    net_fill: netFill || position.netPremium || 0,
    mark_at_entry: undefined,
    mark_source: undefined,
    mark_ts: safeIso(entryTs) ?? undefined,
    spot: undefined,
    expected_move_pts: undefined,
    em_coverage_pct: undefined,
    multiplier: undefined,
    max_gain: undefined,
    max_loss: undefined,
    net_delta: undefined,
    counterparty: undefined,
    pricing_currency: 'USD',
    notes: position.playbook ?? '',
    close_target_structure_id: undefined,
    linked_structure_ids: undefined,
  };

  return {
    program,
    position: positionDetails,
    legs: buildInitialLegs(position),
    fills: buildInitialFills(position),
    venue: undefined,
  };
}

function Field({
  meta,
  value,
  onChange,
  missing,
}: {
  meta: FieldMeta;
  value: any;
  onChange: (value: any) => void;
  missing: boolean;
}) {
  const { label, type = 'text', options, placeholder, helperText, required, step, inputMode } = meta;
  const displayValue = value ?? '';
  const baseClass = `mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${missing ? 'border-rose-500 focus:ring-rose-400' : 'border-slate-200 focus:ring-slate-400'}`;

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const raw = event.target.value;
    if (meta.valueType === 'number' || meta.valueType === 'integer') {
      if (raw === '') {
        onChange(undefined);
        return;
      }
      const trimmed = raw.replace(/\s+/g, '');
      // Support locales that use comma as the decimal separator by
      // treating a solitary comma as a decimal point. Multiple commas
      // are assumed to be thousands separators and stripped instead.
      const hasDot = trimmed.includes('.');
      const commaCount = (trimmed.match(/,/g) ?? []).length;
      const normalized = hasDot || commaCount !== 1
        ? trimmed.replace(/,/g, '')
        : trimmed.replace(',', '.');
      const parsed = Number(normalized);
      if (Number.isNaN(parsed)) {
        onChange(undefined);
        return;
      }
      onChange(meta.valueType === 'integer' ? Math.trunc(parsed) : parsed);
      return;
    }
    onChange(raw);
  };

  const labelText = (
    <span className="text-xs font-medium uppercase tracking-wide text-slate-600">
      {label}
      {required ? <span className="ml-1 text-rose-500">*</span> : null}
      {missing ? (
        <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
          Required
        </span>
      ) : null}
    </span>
  );

  if (type === 'textarea') {
    return (
      <label className="flex flex-col gap-1">
        {labelText}
        <textarea
          className={`${baseClass} min-h-[96px] resize-y`}
          value={displayValue}
          onChange={handleChange}
          placeholder={placeholder}
        />
        {helperText ? <p className="text-[11px] text-slate-500">{helperText}</p> : null}
      </label>
    );
  }

  if (type === 'select') {
    return (
      <label className="flex flex-col gap-1">
        {labelText}
        <select className={baseClass} value={displayValue} onChange={handleChange}>
          <option value="">Select…</option>
          {options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {helperText ? <p className="text-[11px] text-slate-500">{helperText}</p> : null}
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      {labelText}
      <input
        type={type === 'number' ? 'number' : 'text'}
        className={baseClass}
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder}
        step={type === 'number' ? step : undefined}
        inputMode={inputMode}
      />
      {helperText ? <p className="text-[11px] text-slate-500">{helperText}</p> : null}
    </label>
  );
}

function CheckboxField({
  meta,
  value,
  onChange,
  missing,
}: {
  meta: CheckboxMeta;
  value: boolean;
  onChange: (value: boolean) => void;
  missing: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        missing
          ? 'border-rose-500 bg-rose-50 text-rose-600'
          : 'border-slate-200 bg-white text-slate-700'
      }`}
    >
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 bg-white text-slate-600 focus:ring-slate-500"
      />
      <span className="font-medium">{meta.label}</span>
      {meta.required ? (
        <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-rose-600">Required</span>
      ) : null}
      {missing ? (
        <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
          Missing
        </span>
      ) : null}
      {meta.helperText ? <span className="ml-auto text-xs text-slate-500">{meta.helperText}</span> : null}
    </label>
  );
}

type SectionProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

function Section({ title, description, children }: SectionProps) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h3>
        {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function StructureEntryOverlay({
  open,
  onClose,
  position,
  allPositions,
  onSaved,
  mode = 'create',
  existingPositionId,
}: {
  open: boolean;
  onClose: () => void;
  position: Position;
  allPositions: Position[];
  onSaved?: (positionId: string) => void;
  mode?: StructureEntryOverlayMode;
  existingPositionId?: string;
}) {
  const initialPayload = React.useMemo(() => buildInitialPayload(position), [position]);
  const [form, setForm] = React.useState<PartialPayload>(initialPayload);
  const [includeVenue, setIncludeVenue] = React.useState(false);
  const [programOptions, setProgramOptions] = React.useState<
    Array<{ program_id: string; program_name: string }>
  >([]);
  const [strategyOptions, setStrategyOptions] = React.useState<
    Array<{ strategy_code: string; strategy_name: string }>
  >([]);
  const [strategyLookup, setStrategyLookup] = React.useState<Record<string, string>>({});
  const strategyRequests = React.useRef<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [saveStatus, setSaveStatus] = React.useState<
    { type: 'idle' | 'error' | 'success'; message?: string; details?: string }
  >({ type: 'idle' });
  const [loadingExisting, setLoadingExisting] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [quickLinkTarget, setQuickLinkTarget] = React.useState('');
  const [linking, setLinking] = React.useState(false);
  const [linkStatus, setLinkStatus] = React.useState<
    { type: 'idle' | 'error' | 'success'; message?: string }
  >({ type: 'idle' });
  const { user, loading: authLoading, supabaseConfigured } = useAuth();
  const supabase = React.useMemo(
    () => (supabaseConfigured ? tryGetSupabaseClient() : null),
    [supabaseConfigured],
  );
  const isUpdateMode = mode === 'update' && Boolean(existingPositionId);

  React.useEffect(() => {
    if (!supabase || !user) return;
    let active = true;

    const loadPrograms = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError) {
          console.error('Failed to retrieve Supabase session for program lookup', sessionError);
          return;
        }
        const accessToken = session?.access_token;
        if (!accessToken) {
          console.error('Missing Supabase access token while loading program options');
          return;
        }

        const supabaseUrl =
          (supabase as unknown as { supabaseUrl?: string }).supabaseUrl ??
          ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null);
        if (!supabaseUrl) {
          console.error('Supabase URL is not configured. Unable to load program options');
          return;
        }

        const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
        if (!supabaseKey) {
          console.error('Supabase publishable key is not configured. Unable to load program options');
          return;
        }

        const restBase = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/programs`;
        const query = new URLSearchParams({ select: 'program_id,program_name', order: 'program_name' });
        const requestUrl = `${restBase}?${query.toString()}`;

        const response = await fetch(requestUrl, {
          headers: {
            Accept: 'application/json',
            apikey: supabaseKey,
            Authorization: `Bearer ${accessToken}`,
            Prefer: 'count=exact',
          },
        });

        if (!response.ok) {
          const body = await response.text();
          console.error('Failed to load program resources', {
            status: response.status,
            statusText: response.statusText,
            body,
          });
          return;
        }

        const payload = (await response.json()) as unknown;
        if (!active) return;

        if (!Array.isArray(payload)) {
          console.error('Unexpected response shape when loading program resources', payload);
          return;
        }

        const rows = payload.filter(
          (row): row is { program_id: string; program_name: string } =>
            Boolean(
              row &&
              typeof row === 'object' &&
              typeof (row as { program_id?: unknown }).program_id === 'string' &&
              typeof (row as { program_name?: unknown }).program_name === 'string',
            ),
        );

        if (!rows.length) {
          const sanitizedHeaders = {
            Accept: 'application/json',
            Prefer: 'count=exact',
            apikeyPreview: `${supabaseKey.slice(0, 6)}…${supabaseKey.slice(-4)}`,
            authorizationPreview: `Bearer ${accessToken.slice(0, 10)}…${accessToken.slice(-6)}`,
          };
          console.info('Program lookup succeeded but returned no rows', {
            request: { url: requestUrl, headers: sanitizedHeaders },
            response: {
              status: response.status,
              contentRange: response.headers.get('Content-Range'),
            },
            userId: user.id,
          });
        }

        setProgramOptions(rows);
      } catch (err) {
        if (active) console.error('Failed to load program resources', err);
      }
    };

    void loadPrograms();

    return () => {
      active = false;
    };
  }, [supabase, user]);

  React.useEffect(() => {
    if (!supabase || !user) return;
    let active = true;

    const loadStrategies = async () => {
      try {
        const { data, error } = await supabase
          .from('strategies')
          .select('strategy_code, strategy_name')
          .order('strategy_name');
        if (!active) return;
        if (error) {
          console.error('Failed to load strategy resources', error);
          return;
        }
        const rows = (data ?? []).filter(
          (row): row is { strategy_code: string; strategy_name: string } =>
            Boolean(row?.strategy_code && row?.strategy_name),
        );
        setStrategyOptions(rows);
        if (rows.length) {
          setStrategyLookup((prevLookup) => {
            const next = { ...prevLookup };
            for (const row of rows) {
              next[row.strategy_code] = row.strategy_name;
            }
            return next;
          });
        }
      } catch (err) {
        if (active) console.error('Failed to load strategy resources', err);
      }
    };

    void loadStrategies();

    return () => {
      active = false;
    };
  }, [supabase, user]);

  React.useEffect(() => {
    if (!open) return;
    setSaving(false);
    setSaveStatus({ type: 'idle' });
    setLoadError(null);

    if (!isUpdateMode) {
      setForm(initialPayload);
      setIncludeVenue(false);
      setLoadingExisting(false);
      return;
    }

    setForm(initialPayload);
    setIncludeVenue(false);

    if (!supabase) {
      setLoadingExisting(false);
      setLoadError('Supabase is not configured. Configure environment variables to edit saved structures.');
      return;
    }

    if (!existingPositionId) {
      setLoadingExisting(false);
      setLoadError('Missing structure identifier for update.');
      return;
    }

    let active = true;
    setLoadingExisting(true);

    const loadExisting = async () => {
      try {
        const result = await fetchStructurePayload(supabase, existingPositionId);
        if (!active) return;
        if (result.ok) {
          setForm(result.payload);
          setIncludeVenue(Boolean(result.payload.venue || result.payload.position?.venue_id));
          const strategyCode = result.payload.position?.strategy_code;
          const strategyName = result.payload.position?.strategy_name;
          if (strategyCode && strategyName) {
            setStrategyLookup((prevLookup) => ({ ...prevLookup, [strategyCode]: strategyName }));
          }
          setLoadError(null);
        } else {
          setLoadError(result.error);
        }
      } catch (err) {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load saved structure.');
      } finally {
        if (active) {
          setLoadingExisting(false);
        }
      }
    };

    void loadExisting();

    return () => {
      active = false;
    };
  }, [open, isUpdateMode, initialPayload, supabase, existingPositionId]);

  const updateField = React.useCallback((path: string, value: any) => {
    setSaveStatus((prev) => (prev.type === 'idle' ? prev : { type: 'idle' }));
    setForm((prev) => {
      const parsed = parsePath(path);
      let next = setValue(prev, parsed, value);
      if (path === 'program.program_id') {
        next = setValue(next, parsePath('position.program_id'), value ?? '');
      }
      if (path === 'position.strategy_code') {
        next = setValue(next, parsePath('position.strategy_name'), '');
      }
      if (path === 'position.strategy_name') {
        const code = getValue(next, parsePath('position.strategy_code'));
        if (typeof code === 'string') {
          const trimmedCode = code.trim();
          const trimmedName = typeof value === 'string' ? value.trim() : '';
          if (trimmedCode && trimmedName) {
            setStrategyLookup((prevLookup) => ({ ...prevLookup, [trimmedCode]: trimmedName }));
          }
        }
      }
      if (path === 'position.lifecycle' && value === 'open') {
        next = setValue(next, parsePath('position.close_target_structure_id'), undefined);
      }
      return next;
    });
  }, []);

  const lifecycle = (form.position?.lifecycle as (typeof STRUCTURE_LIFECYCLES)[number]) ?? 'open';
  const linkableStructureOptions = React.useMemo(() => {
    const closeTargetId =
      typeof form.position?.close_target_structure_id === 'string'
        ? form.position.close_target_structure_id
        : undefined;
    const explicitLinkedIds = Array.isArray(form.position?.linked_structure_ids)
      ? form.position.linked_structure_ids.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        )
      : [];
    const allowedClosedIds = new Set(explicitLinkedIds);
    if (closeTargetId) {
      allowedClosedIds.add(closeTargetId);
    }

    return allPositions
      .filter((candidate) => {
        if (candidate.source !== 'supabase') return false;
        if (candidate.id === position.id) return false;
        if (candidate.closedAt == null) return true;
        return allowedClosedIds.has(candidate.id);
      })
      .map((candidate) => {
        const parts = [
          candidate.structureId ? `#${candidate.structureId}` : 'No structure #',
          candidate.underlying,
        ];
        if (candidate.expiryISO) parts.push(candidate.expiryISO);
        if (candidate.exchange) parts.push(candidate.exchange.toUpperCase());
        return {
          value: candidate.id,
          label: parts.join(' • '),
        };
      });
  }, [
    allPositions,
    form.position?.close_target_structure_id,
    form.position?.linked_structure_ids,
    position.id,
  ]);

  const linkableStructureLookup = React.useMemo(
    () =>
      new Map(
        linkableStructureOptions.map((option) => [option.value, option.label] as const),
      ),
    [linkableStructureOptions],
  );

  const closeTargetStructureId =
    typeof form.position?.close_target_structure_id === 'string'
      ? form.position.close_target_structure_id
      : undefined;

  const linkedStructureIds = React.useMemo(() => {
    const rawIds = Array.isArray(form.position?.linked_structure_ids)
      ? form.position.linked_structure_ids
      : [];
    const uniqueIds = new Set(
      rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    if (closeTargetStructureId) {
      uniqueIds.add(closeTargetStructureId);
    }
    return Array.from(uniqueIds);
  }, [closeTargetStructureId, form.position?.linked_structure_ids]);

  const quickLinkOptions = React.useMemo(
    () => linkableStructureOptions.filter((option) => !linkedStructureIds.includes(option.value)),
    [linkableStructureOptions, linkedStructureIds],
  );

  const usingDummyLinkOptions = linkableStructureOptions.length === 0;

  const visibleQuickLinkOptions = usingDummyLinkOptions
    ? [...DUMMY_LINKABLE_STRUCTURE_OPTIONS]
    : quickLinkOptions;

  const visibleLinkableStructureOptions = usingDummyLinkOptions
    ? [...DUMMY_LINKABLE_STRUCTURE_OPTIONS]
    : linkableStructureOptions;

  const supabaseUnavailable = !supabaseConfigured || !supabase;
  const supabaseChecking = !supabaseUnavailable && authLoading;
  const supabaseSignedOut = !supabaseUnavailable && !authLoading && !user;

  React.useEffect(() => {
    if (lifecycle !== 'close') return;
    if (!closeTargetStructureId) {
      if (linkableStructureOptions.length !== 1) return;
      const only = linkableStructureOptions[0];
      if (!only) return;
      updateField('position.linked_structure_ids', [only.value]);
      updateField('position.close_target_structure_id', only.value);
      return;
    }

    const hasCloseTargetLinked = Array.isArray(form.position?.linked_structure_ids)
      ? form.position.linked_structure_ids.includes(closeTargetStructureId)
      : false;

    if (!hasCloseTargetLinked) {
      const next = [closeTargetStructureId, ...linkedStructureIds.filter((id) => id !== closeTargetStructureId)];
      updateField('position.linked_structure_ids', next);
    }
  }, [
    closeTargetStructureId,
    form.position?.linked_structure_ids,
    lifecycle,
    linkableStructureOptions,
    linkedStructureIds,
    updateField,
  ]);

  React.useEffect(() => {
    if (!closeTargetStructureId) return;
    if (lifecycle === 'close') return;
    updateField('position.lifecycle', 'close');
  }, [closeTargetStructureId, lifecycle, updateField]);

  const handleLinkedStructureChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      if (usingDummyLinkOptions) {
        return;
      }

      const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
      const unique = Array.from(new Set(selected));
      updateField('position.linked_structure_ids', unique.length > 0 ? unique : undefined);

      if (lifecycle === 'close') {
        if (unique.length === 0) {
          updateField('position.close_target_structure_id', undefined);
          return;
        }

        if (!closeTargetStructureId || !unique.includes(closeTargetStructureId)) {
          updateField('position.close_target_structure_id', unique[0]);
        }
      }
    },
    [closeTargetStructureId, lifecycle, updateField, usingDummyLinkOptions],
  );

  const handleCloseTargetChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      if (usingDummyLinkOptions) {
        return;
      }

      const nextValue = event.target.value ? event.target.value : undefined;
      updateField('position.close_target_structure_id', nextValue);

      if (nextValue) {
        updateField('position.lifecycle', 'close');
      }
    },
    [updateField, usingDummyLinkOptions],
  );

  const handleQuickLink = React.useCallback(async () => {
    if (!quickLinkTarget) return;
    if (usingDummyLinkOptions) {
      setLinkStatus({
        type: 'error',
        message: 'Save an open structure first before linking with Supabase-backed data.',
      });
      return;
    }
    if (!isUpdateMode || !existingPositionId) {
      setLinkStatus({
        type: 'error',
        message: 'Save this structure first before linking to another.',
      });
      return;
    }
    if (supabaseUnavailable) {
      setLinkStatus({
        type: 'error',
        message: 'Supabase is not configured. Configure environment variables to enable linking.',
      });
      return;
    }
    if (supabaseChecking) {
      setLinkStatus({
        type: 'error',
        message: 'Supabase session is being restored. Try again in a moment.',
      });
      return;
    }
    if (!supabase || !user) {
      setLinkStatus({ type: 'error', message: 'Sign in to link structures.' });
      return;
    }

    const desiredLinks = Array.from(
      new Set(
        [...linkedStructureIds, quickLinkTarget].filter(
          (id): id is string => typeof id === 'string' && id.length > 0 && id !== existingPositionId,
        ),
      ),
    );

    const timestampForClosure =
      lifecycle === 'close'
        ? form.position?.exit_ts ?? form.position?.entry_ts ?? new Date().toISOString()
        : undefined;

    setLinking(true);
    setLinkStatus({ type: 'idle' });

    try {
      const result = await syncLinkedStructures(supabase, {
        sourceId: existingPositionId,
        linkedIds: desiredLinks,
        closedAt: timestampForClosure,
      });

      if (!result.ok) {
        setLinkStatus({ type: 'error', message: result.error || 'Failed to link structures.' });
        return;
      }

      updateField('position.linked_structure_ids', desiredLinks.length > 0 ? desiredLinks : undefined);
      updateField('position.close_target_structure_id', quickLinkTarget);
      updateField('position.lifecycle', 'close');
      setQuickLinkTarget('');
      setLinkStatus({ type: 'success', message: 'Structures linked successfully.' });
      onSaved?.(existingPositionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to link structures.';
      setLinkStatus({ type: 'error', message });
    } finally {
      setLinking(false);
    }
  }, [
    existingPositionId,
    form.position?.entry_ts,
    form.position?.exit_ts,
    isUpdateMode,
    lifecycle,
    linkedStructureIds,
    onSaved,
    quickLinkTarget,
    supabase,
    supabaseChecking,
    supabaseUnavailable,
    updateField,
    user,
    usingDummyLinkOptions,
  ]);

  React.useEffect(() => {
    if (usingDummyLinkOptions) {
      setQuickLinkTarget('');
      setLinkStatus({ type: 'idle' });
    }
  }, [usingDummyLinkOptions]);

  React.useEffect(() => {
    if (usingDummyLinkOptions) return;
    if (!quickLinkTarget) return;
    if (!quickLinkOptions.some((option) => option.value === quickLinkTarget)) {
      setQuickLinkTarget('');
    }
  }, [quickLinkOptions, quickLinkTarget, usingDummyLinkOptions]);

  const payloadForValidation = React.useMemo(
    () => normalizeTimestampFields(ensureVenue(form, includeVenue)),
    [form, includeVenue],
  );
  const missing = React.useMemo(
    () => new Set(computeMissing(payloadForValidation as Partial<ImportPayload>)),
    [payloadForValidation],
  );

  const handleProgramNameChange = React.useCallback(
    (value: string) => {
      setForm((prev) => {
        const nextName = value || undefined;
        let next = setValue(prev, parsePath('program.program_name'), nextName);
        const match = programOptions.find((option) => option.program_name === value);
        const programId = match?.program_id ?? '';
        next = setValue(next, parsePath('program.program_id'), programId);
        next = setValue(next, parsePath('position.program_id'), programId);
        return next;
      });
    },
    [programOptions],
  );

  const handleStrategyNameChange = React.useCallback(
    (value: string) => {
      const match = strategyOptions.find((option) => option.strategy_name === value);
      setForm((prev) => {
        const nextName = value || undefined;
        let next = setValue(prev, parsePath('position.strategy_name'), nextName);
        const strategyCode = match?.strategy_code ?? '';
        next = setValue(next, parsePath('position.strategy_code'), strategyCode);
        return next;
      });
      if (match?.strategy_code && match.strategy_name) {
        setStrategyLookup((prevLookup) => ({
          ...prevLookup,
          [match.strategy_code]: match.strategy_name,
        }));
      }
    },
    [strategyOptions],
  );

  const handleSignOut = React.useCallback(() => {
    if (!supabase) return;
    void supabase.auth.signOut();
  }, [supabase]);

  React.useEffect(() => {
    const currentId = form.program?.program_id;
    if (!currentId || !programOptions.length) return;
    const match = programOptions.find((option) => option.program_id === currentId);
    if (!match) return;
    if (form.program?.program_name === match.program_name) return;
    setForm((prev) => setValue(prev, parsePath('program.program_name'), match.program_name));
  }, [form.program?.program_id, form.program?.program_name, programOptions]);

  React.useEffect(() => {
    const rawCode = form.position?.strategy_code;
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    if (!code) return;

    const cached = strategyLookup[code];
    if (cached) {
      if (!form.position?.strategy_name || !form.position.strategy_name.trim()) {
        setForm((prev) => {
          const current = getValue(prev, parsePath('position.strategy_name'));
          if (current && String(current).trim().length > 0) return prev;
          return setValue(prev, parsePath('position.strategy_name'), cached);
        });
      }
      return;
    }

    if (strategyRequests.current.has(code)) return;

    if (!supabase || !user) return;

    let active = true;
    strategyRequests.current.add(code);

    const loadStrategy = async () => {
      try {
        const { data, error } = await supabase
          .from('strategies')
          .select('strategy_name')
          .eq('strategy_code', code)
          .maybeSingle();

        if (!active) return;
        if (error) {
          console.error('Failed to fetch strategy name', error);
          return;
        }
        const name = data?.strategy_name;
        if (!name) return;
        setStrategyLookup((prevLookup) => ({ ...prevLookup, [code]: name }));
        setForm((prev) => {
          const current = getValue(prev, parsePath('position.strategy_name'));
          if (current && String(current).trim().length > 0) return prev;
          return setValue(prev, parsePath('position.strategy_name'), name);
        });
      } catch (err) {
        if (active) console.error('Failed to fetch strategy name', err);
      } finally {
        strategyRequests.current.delete(code);
      }
    };

    void loadStrategy();

    return () => {
      active = false;
      strategyRequests.current.delete(code);
    };
  }, [
    form.position?.strategy_code,
    form.position?.strategy_name,
    strategyLookup,
    supabase,
    user,
  ]);

  const programFields: FieldMeta[] = [
    { label: 'Program ID', path: 'program.program_id', valueType: 'string', required: true },
    {
      label: 'Program Name',
      path: 'program.program_name',
      valueType: 'string',
      required: true,
      type: 'select',
      options: programOptions.map((option) => option.program_name),
    },
    {
      label: 'Base Currency',
      path: 'program.base_currency',
      valueType: 'string',
      required: true,
      placeholder: 'e.g., USD',
    },
    { label: 'Objective', path: 'program.objective', valueType: 'string', type: 'textarea' },
    { label: 'Sleeve', path: 'program.sleeve', valueType: 'string' },
  ];

  const positionFields: FieldMeta[] = [
    { label: 'Program ID', path: 'position.program_id', valueType: 'string', required: true },
    { label: 'Underlier', path: 'position.underlier', valueType: 'string', required: true },
    { label: 'Strategy Code', path: 'position.strategy_code', valueType: 'string', required: true },
    {
      label: 'Strategy Name',
      path: 'position.strategy_name',
      valueType: 'string',
      required: true,
      type: 'select',
      options: strategyOptions.map((option) => option.strategy_name),
    },
    {
      label: 'Options Structure',
      path: 'position.options_structure',
      valueType: 'string',
      type: 'select',
      options: OPTIONS_STRUCTURES,
      required: true,
    },
    {
      label: 'Construction',
      path: 'position.construction',
      valueType: 'string',
      type: 'select',
      options: CONSTRUCTIONS,
      required: true,
    },
  ];

  const positionSecondaryFields: FieldMeta[] = [
    {
      label: 'Entry Timestamp',
      path: 'position.entry_ts',
      valueType: 'string',
      required: true,
      placeholder: 'ISO 8601',
    },
    {
      label: 'Exit Timestamp',
      path: 'position.exit_ts',
      valueType: 'string',
      placeholder: 'ISO 8601 (optional)',
    },
    {
      label: 'Execution Route',
      path: 'position.execution_route',
      valueType: 'string',
      type: 'select',
      options: EXECUTION_ROUTES,
      required: true,
    },
    { label: 'Order Type', path: 'position.order_type', valueType: 'string', type: 'select', options: ORDER_TYPES },
    { label: 'Provider', path: 'position.provider', valueType: 'string' },
    {
      label: 'Venue ID',
      path: 'position.venue_id',
      valueType: 'string',
      placeholder: 'Existing UUID if known',
    },
    { label: 'Package Order ID', path: 'position.package_order_id', valueType: 'string' },
    { label: 'Order ID', path: 'position.order_id', valueType: 'string' },
    { label: 'RFQ ID', path: 'position.rfq_id', valueType: 'string' },
    { label: 'Deal ID', path: 'position.deal_id', valueType: 'string' },
    { label: 'Trade ID', path: 'position.trade_id', valueType: 'string' },
    { label: 'Fees Total', path: 'position.fees_total', valueType: 'number', type: 'number' },
    {
      label: 'Fees Currency',
      path: 'position.fees_currency',
      valueType: 'string',
      placeholder: 'e.g., USD',
    },
    { label: 'Net Fill', path: 'position.net_fill', valueType: 'number', type: 'number', required: true },
    { label: 'Mark at Entry', path: 'position.mark_at_entry', valueType: 'number', type: 'number' },
    { label: 'Mark Source', path: 'position.mark_source', valueType: 'string' },
    { label: 'Mark Timestamp', path: 'position.mark_ts', valueType: 'string', placeholder: 'ISO 8601' },
    { label: 'Spot', path: 'position.spot', valueType: 'number', type: 'number' },
    {
      label: 'Expected Move (pts)',
      path: 'position.expected_move_pts',
      valueType: 'number',
      type: 'number',
    },
    { label: 'EM Coverage %', path: 'position.em_coverage_pct', valueType: 'number', type: 'number' },
    { label: 'Multiplier', path: 'position.multiplier', valueType: 'number', type: 'number' },
    { label: 'Max Gain', path: 'position.max_gain', valueType: 'number', type: 'number' },
    { label: 'Max Loss', path: 'position.max_loss', valueType: 'number', type: 'number' },
    { label: 'Net Delta', path: 'position.net_delta', valueType: 'number', type: 'number' },
    { label: 'Counterparty', path: 'position.counterparty', valueType: 'string' },
    {
      label: 'Pricing Currency',
      path: 'position.pricing_currency',
      valueType: 'string',
      placeholder: 'e.g., USD',
    },
    { label: 'Notes', path: 'position.notes', valueType: 'string', type: 'textarea' },
  ];

  const venueFields: FieldMeta[] = [
    {
      label: 'Venue ID (existing)',
      path: 'venue.venue_id',
      valueType: 'string',
      helperText: 'Leave blank to auto-create',
    },
    {
      label: 'Venue Type',
      path: 'venue.type',
      valueType: 'string',
      type: 'select',
      options: VENUE_TYPES,
      required: true,
    },
    { label: 'Name', path: 'venue.name', valueType: 'string', required: true },
    { label: 'MIC', path: 'venue.mic', valueType: 'string' },
    { label: 'Underlying Exchange', path: 'venue.underlying_exchange', valueType: 'string' },
    { label: 'Venue Code', path: 'venue.venue_code', valueType: 'string' },
    {
      label: 'Execution Mode',
      path: 'venue.execution_mode',
      valueType: 'string',
      type: 'select',
      options: EXECUTION_MODES,
    },
    {
      label: 'Liquidity Role',
      path: 'venue.liquidity_role',
      valueType: 'string',
      type: 'select',
      options: LIQUIDITY_ROLES,
    },
    { label: 'Broker', path: 'venue.broker', valueType: 'string' },
    { label: 'Clearing Firm', path: 'venue.clearing_firm', valueType: 'string' },
    { label: 'Account', path: 'venue.account', valueType: 'string' },
  ];

  const riskDefinedMeta: CheckboxMeta = {
    label: 'Risk defined structure',
    path: 'position.risk_defined',
    helperText: 'Required boolean flag',
    required: true,
  };

  const fieldLabelMap = React.useMemo(() => {
    const map = new Map<string, string>();
    const register = (path: string, label: string) => {
      map.set(path, label);
      const normalized = path.replace(/\[\d+\]/g, '[]');
      if (normalized !== path) {
        map.set(normalized, label);
      }
    };
    const registerFields = (fields: FieldMeta[]) => {
      for (const field of fields) {
        register(field.path, field.label);
      }
    };

    registerFields(programFields);
    registerFields(positionFields);
    registerFields(positionSecondaryFields);
    registerFields(venueFields);
    register('position.risk_defined', 'Risk defined structure');

    for (const [suffix, label] of Object.entries(LEG_FIELD_LABELS)) {
      register(`legs[].${suffix}`, label);
    }

    for (const [suffix, label] of Object.entries(FILL_FIELD_LABELS)) {
      register(`fills[].${suffix}`, label);
    }

    register('program', 'Program');
    register('position', 'Position');
    register('venue', 'Venue');
    register('legs', 'Legs');
    register('fills', 'Fills');

    return map;
  }, [programFields, positionFields, positionSecondaryFields, venueFields]);

  const getFieldLabel = React.useCallback(
    (path: string, segments: PathSegment[]) => {
      if (!path) return undefined;

      const normalizedPath = path.replace(/\[\d+\]/g, '[]');
      const directLabel = fieldLabelMap.get(path) ?? fieldLabelMap.get(normalizedPath);

      if (directLabel) {
        const firstIndex = segments.findIndex((segment) => typeof segment === 'number');
        if (firstIndex > 0) {
          const parent = segments[firstIndex - 1];
          const index = segments[firstIndex];
          if (typeof parent === 'string' && typeof index === 'number') {
            const groupLabel =
              parent === 'legs'
                ? `Leg ${index + 1}`
                : parent === 'fills'
                ? `Fill ${index + 1}`
                : `${parent}[${index}]`;
            return `${groupLabel} • ${directLabel}`;
          }
        }

        return directLabel;
      }

      if (segments.length > 0) {
        const parts: string[] = [];
        for (const segment of segments) {
          if (typeof segment === 'number') {
            parts.push(`#${segment + 1}`);
          } else {
            const formatted = segment
              .replace(/\[\d+\]/g, '')
              .split('_')
              .filter((chunk) => chunk.length > 0)
              .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
              .join(' ');
            parts.push(formatted);
          }
        }
        return parts.join(' › ');
      }

      return undefined;
    },
    [fieldLabelMap],
  );

  const missingLegPath = (index: number, suffix: string) => `legs[${index}].${suffix}`;
  const missingFillPath = (index: number, suffix: string) => `fills[${index}].${suffix}`;

  const saveDisabled =
    saving ||
    missing.size > 0 ||
    supabaseUnavailable ||
    supabaseChecking ||
    supabaseSignedOut ||
    loadingExisting ||
    (isUpdateMode && Boolean(loadError));

  const handleSave = React.useCallback(async () => {
    if (saving || loadingExisting) return;
    if (missing.size > 0) {
      setSaveStatus({
        type: 'error',
        message: 'Complete all required fields before saving.',
      });
      return;
    }
    if (isUpdateMode && loadError) {
      setSaveStatus({
        type: 'error',
        message: loadError,
      });
      return;
    }
    if (supabaseUnavailable) {
      setSaveStatus({
        type: 'error',
        message: 'Supabase is not configured. Configure environment variables to enable saving.',
      });
      return;
    }
    if (supabaseChecking) {
      setSaveStatus({
        type: 'error',
        message: 'Supabase session is being restored. Try again in a moment.',
      });
      return;
    }
    if (!user) {
      setSaveStatus({ type: 'error', message: 'Sign in to save this structure.' });
      return;
    }

    setSaving(true);
    setSaveStatus({ type: 'idle' });

    try {
      const payload = payloadForValidation as Partial<ImportPayload>;
      const result = await importTrades(
        payload as ImportPayload,
        isUpdateMode && existingPositionId ? { positionId: existingPositionId } : undefined,
      );
      if (result.ok) {
        setSaveStatus({
          type: 'success',
          message: isUpdateMode ? 'Structure updated successfully.' : 'Structure saved successfully.',
        });
        onSaved?.(result.position_id);
      } else {
        const details = formatSaveErrorDetails((result as { details?: unknown }).details, {
          getLabel: getFieldLabel,
          getValue: (_path, segments) => getValue(payload, segments),
        });
        setSaveStatus({
          type: 'error',
          message: result.error || 'Failed to save structure.',
          details: details ?? undefined,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save structure.';
      setSaveStatus({ type: 'error', message });
    } finally {
      setSaving(false);
    }
  }, [
    missing,
    payloadForValidation,
    saving,
    supabaseChecking,
    supabaseUnavailable,
    onSaved,
    user,
  ]);

  const handleToggleIncludeVenue = React.useCallback(() => {
    setSaveStatus((prev) => (prev.type === 'idle' ? prev : { type: 'idle' }));
    setIncludeVenue((prev) => !prev);
  }, []);

  const overlayTitle = isUpdateMode
    ? `Update structure for ${position.underlying}`
    : `Structure entry for ${position.underlying}`;
  const primaryButtonLabel = saving
    ? isUpdateMode
      ? 'Updating…'
      : 'Saving…'
    : isUpdateMode
    ? 'Update'
    : 'Save';

  return (
    <Overlay open={open} onClose={onClose} title={overlayTitle}>
      <div
        className="flex max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white"
        style={{ width: 'min(960px, calc(100vw - 3rem))' }}
      >
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isUpdateMode
                ? `Update saved structure for ${position.underlying}`
                : `Structure entry for ${position.underlying}`}
            </h2>
            <p className="text-xs text-slate-500">
              {isUpdateMode
                ? 'Review and update the saved program, position, legs, and fills. Fields marked with * are required.'
                : 'Fill in details for program, position, legs, and fills. Fields marked with * are required.'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            {!supabaseUnavailable && user?.email ? (
              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
                <span className="font-medium text-slate-700">{user.email}</span>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="text-xs font-semibold text-slate-500 transition hover:text-slate-700"
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
              {missing.size > 0 ? (
                <span className="rounded-full bg-rose-50 px-3 py-1 font-medium text-rose-600">
                  {missing.size} required field{missing.size === 1 ? '' : 's'} missing
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-600">
                  All required fields complete
                </span>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saveDisabled}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-slate-500 ${
                  saveDisabled
                    ? 'border-slate-200 bg-slate-100 text-slate-400'
                    : 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                {primaryButtonLabel}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto bg-slate-50 px-6 py-6">
            <div className="space-y-6">
              {loadingExisting ? (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                  Loading saved structure details…
                </div>
              ) : null}
              {loadError ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {loadError}
                </div>
              ) : null}
              {saveStatus.type === 'error' ? (
                <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <p className="font-medium">
                    {saveStatus.message ?? 'Unable to save structure. Please try again.'}
                  </p>
                  {saveStatus.details ? (
                    <pre className="whitespace-pre-wrap text-xs leading-5 text-rose-600">
                      {saveStatus.details}
                    </pre>
                  ) : null}
                </div>
              ) : null}
              {saveStatus.type === 'success' ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {saveStatus.message ?? 'Structure saved successfully.'}
                </div>
              ) : null}
              {(supabaseUnavailable || supabaseChecking || supabaseSignedOut) && (
                <div className="space-y-2 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
                  {supabaseUnavailable ? (
                    <>
                      <p className="font-semibold text-slate-700">Supabase unavailable</p>
                      <p>
                        Program lookups and strategy autocomplete are disabled. Provide any required identifiers manually or
                        configure <code className="rounded bg-slate-100 px-1 py-0.5">VITE_SUPABASE_URL</code> and{' '}
                        <code className="rounded bg-slate-100 px-1 py-0.5">VITE_SUPABASE_PUBLISHABLE_KEY</code> to enable live
                        resources.
                      </p>
                    </>
                  ) : supabaseChecking ? (
                    <>
                      <p className="font-semibold text-slate-700">Restoring Supabase session…</p>
                      <p>Realtime lookups will become available once your saved credentials are verified.</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-slate-700">Supabase sign-in required for lookups</p>
                      <p>
                        You can continue editing the payload manually. Sign in from the main workspace header to enable program
                        and strategy search.
                      </p>
                    </>
                  )}
                </div>
              )}

              <Section
                title="Structure lifecycle"
                description="Specify whether this payload opens a new structure or closes an existing one."
              >
                <div className="flex flex-wrap items-center gap-2">
                  {STRUCTURE_LIFECYCLES.map((option) => {
                    const active = lifecycle === option;
                    const label = option === 'open' ? 'Open structure' : 'Close structure';
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => updateField('position.lifecycle', option)}
                        className={`rounded-full border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 ${
                          active
                            ? 'border-slate-900 bg-slate-900 text-white shadow-sm focus:ring-slate-500'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 focus:ring-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {missing.has('position.lifecycle') ? (
                  <p className="text-xs text-rose-600">Select whether this entry opens or closes a structure.</p>
                ) : (
                  <p className="text-xs text-slate-500">
                    {lifecycle === 'open'
                      ? 'This payload will create a new open structure.'
                      : 'Select the matching open structure to link this close entry.'}
                  </p>
                )}

                <div className="space-y-2 pt-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Linked structures{lifecycle === 'open' ? ' (optional)' : ''}
                  </label>
                  {visibleQuickLinkOptions.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select
                          value={quickLinkTarget}
                          onChange={(event) => {
                            setQuickLinkTarget(event.target.value);
                            setLinkStatus({ type: 'idle' });
                          }}
                          className={`mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                            usingDummyLinkOptions ? 'opacity-80' : ''
                          }`}
                        >
                          <option value="">Select open structure…</option>
                          {visibleQuickLinkOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={handleQuickLink}
                          disabled={
                            linking ||
                            !quickLinkTarget ||
                            !isUpdateMode ||
                            supabaseUnavailable ||
                            supabaseChecking ||
                            !user ||
                            usingDummyLinkOptions
                          }
                          className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                            linking ||
                            !quickLinkTarget ||
                            !isUpdateMode ||
                            supabaseUnavailable ||
                            supabaseChecking ||
                            !user ||
                            usingDummyLinkOptions
                              ? 'cursor-not-allowed bg-slate-300'
                              : 'bg-slate-900 hover:bg-slate-800'
                          }`}
                        >
                          {linking ? 'Linking…' : 'OK'}
                        </button>
                      </div>
                      {usingDummyLinkOptions ? (
                        <p className="text-xs text-slate-500">
                          No open Supabase structures were found. Showing sample values so you can preview the linking
                          controls.
                        </p>
                      ) : null}
                      {linkStatus.type === 'error' ? (
                        <p className="text-xs text-rose-600">{linkStatus.message}</p>
                      ) : null}
                      {linkStatus.type === 'success' ? (
                        <p className="text-xs text-emerald-600">{linkStatus.message}</p>
                      ) : null}
                      {!isUpdateMode ? (
                        <p className="text-xs text-slate-500">
                          Save this structure first to enable quick linking with other saved structures.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {visibleLinkableStructureOptions.length > 0 ? (
                    <>
                      <select
                        multiple
                        value={linkedStructureIds}
                        onChange={handleLinkedStructureChange}
                        className={`mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                          lifecycle === 'close' && missing.has('position.close_target_structure_id')
                            ? 'border-rose-500 focus:ring-rose-400'
                            : 'border-slate-200 focus:ring-slate-400'
                        } ${usingDummyLinkOptions ? 'opacity-80' : ''}`}
                      >
                        {visibleLinkableStructureOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500">
                        {lifecycle === 'close'
                          ? 'Select the open structure this close entry is paired with. You can add more related structures if needed.'
                          : 'Optionally link this structure to other open structures.'}
                      </p>
                      {lifecycle === 'close' && !usingDummyLinkOptions ? (
                        <div className="space-y-1 pt-2">
                          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            Closing target
                          </label>
                          <select
                            value={closeTargetStructureId ?? ''}
                            onChange={handleCloseTargetChange}
                            disabled={linkedStructureIds.length === 0}
                            className={`mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                              missing.has('position.close_target_structure_id')
                                ? 'border-rose-500 focus:ring-rose-400'
                                : 'border-slate-200 focus:ring-slate-400'
                            } ${linkedStructureIds.length === 0 ? 'opacity-60' : ''}`}
                          >
                            <option value="">Select closing target…</option>
                            {linkedStructureIds.map((id) => (
                              <option key={id} value={id}>
                                {linkableStructureLookup.get(id) ?? id}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-slate-500">
                            Choose which linked structure should be marked as closed.
                          </p>
                        </div>
                      ) : null}
                      {lifecycle === 'close' && missing.has('position.close_target_structure_id') ? (
                        <p className="text-xs text-rose-600">Select at least one linked structure to close.</p>
                      ) : null}
                      <p className="text-xs text-slate-500">
                        Hold Ctrl (Windows) or Cmd (macOS) to select multiple structures.
                      </p>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      No open structures available to link.
                    </div>
                  )}
                  {usingDummyLinkOptions ? (
                    <p className="text-xs text-slate-500">
                      Save at least one structure as open to link it when recording a close. Once Supabase returns open
                      structures, these sample values will be replaced automatically.
                    </p>
                  ) : null}
                </div>
              </Section>

              <Section title="Program" description="Program metadata required before importing trades.">
                <div className="grid gap-4 md:grid-cols-2">
                  {programFields.map((field) => (
                  <Field
                    key={field.path}
                    meta={field}
                    value={getValue(form, parsePath(field.path))}
                    missing={missing.has(field.path)}
                    onChange={(value) =>
                      field.path === 'program.program_name'
                        ? handleProgramNameChange(value as string)
                        : updateField(field.path, value)
                    }
                  />
                ))}
              </div>
            </Section>

            <Section title="Position" description="Core structure-level details for the trade grouping.">
              <div className="grid gap-4 md:grid-cols-2">
                {positionFields.map((field) => (
                  <Field
                    key={field.path}
                    meta={field}
                    value={getValue(form, parsePath(field.path))}
                    missing={missing.has(field.path)}
                    onChange={(value) =>
                      field.path === 'position.strategy_name'
                        ? handleStrategyNameChange(value as string)
                        : updateField(field.path, value)
                    }
                  />
                ))}
                <CheckboxField
                  meta={riskDefinedMeta}
                  value={Boolean(getValue(form, parsePath(riskDefinedMeta.path)))}
                  missing={missing.has(riskDefinedMeta.path)}
                  onChange={(value) => updateField(riskDefinedMeta.path, value)}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {positionSecondaryFields.map((field) => (
                  <Field
                    key={field.path}
                    meta={field}
                    value={getValue(form, parsePath(field.path))}
                    missing={missing.has(field.path)}
                    onChange={(value) => updateField(field.path, value)}
                  />
                ))}
              </div>
            </Section>

            <Section
              title="Venue (optional)"
              description="Toggle on to include venue details for new venue creation or association."
            >
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
                <span>Include venue details in payload</span>
                <button
                  type="button"
                  onClick={handleToggleIncludeVenue}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                    includeVenue ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  {includeVenue ? 'Included' : 'Excluded'}
                </button>
              </div>
              {includeVenue ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {venueFields.map((field) => (
                    <Field
                      key={field.path}
                      meta={field}
                      value={getValue(form, parsePath(field.path))}
                      missing={missing.has(field.path)}
                      onChange={(value) => updateField(field.path, value)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Venue block is optional. Enable it if you need to create or link to a trading venue record.
                </p>
              )}
            </Section>

            <Section
              title="Legs"
              description="Each leg requires contract details. Adjust sequences if you want to reorder."
            >
              <div className="space-y-6">
                {(form.legs ?? []).map((leg, index) => (
                  <div
                    key={index}
                    className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Leg {index + 1}
                    </h4>
                    <div className="grid gap-4 md:grid-cols-3">
                      {REQUIRED_LEG_SUFFIXES.map((suffix) => {
                        const path = missingLegPath(index, suffix);
                        const meta: FieldMeta =
                          suffix === 'side'
                            ? {
                                label: 'Side',
                                path,
                                valueType: 'string',
                                type: 'select',
                                options: ['buy', 'sell'],
                                required: true,
                              }
                            : suffix === 'option_type'
                            ? {
                                label: 'Option Type',
                                path,
                                valueType: 'string',
                                type: 'select',
                                options: OPTION_TYPES,
                                required: true,
                              }
                            : suffix === 'expiry'
                            ? {
                                label: 'Expiry (YYYY-MM-DD)',
                                path,
                                valueType: 'string',
                                required: true,
                              }
                            : suffix === 'strike'
                            ? {
                                label: 'Strike',
                                path,
                                valueType: 'number',
                                type: 'number',
                                required: true,
                              }
                            : suffix === 'qty'
                            ? {
                                label: 'Quantity',
                                path,
                                valueType: 'number',
                                type: 'number',
                                required: true,
                                step: '0.01',
                                inputMode: 'decimal',
                              }
                            : suffix === 'price'
                            ? {
                                label: 'Price',
                                path,
                                valueType: 'number',
                                type: 'number',
                                required: true,
                              }
                            : {
                                label: 'Leg Sequence',
                                path,
                                valueType: 'integer',
                                type: 'number',
                                required: true,
                              };
                        return (
                          <Field
                            key={path}
                            meta={meta}
                            value={getValue(form, parsePath(path))}
                            missing={missing.has(path)}
                            onChange={(value) => updateField(path, value)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section
              title="Fills"
              description="Individual fills generated from the source transactions. Update quantities, timestamps, or references as needed."
            >
              {(form.fills?.length ?? 0) === 0 ? (
                <p className="text-xs text-slate-500">No fills detected for this structure.</p>
              ) : (
                <div className="space-y-6">
                  {(form.fills ?? []).map((fill, index) => (
                    <div
                      key={index}
                      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Fill {index + 1}
                      </h4>
                      <div className="grid gap-4 md:grid-cols-3">
                        {REQUIRED_FILL_SUFFIXES.map((suffix) => {
                          const path = missingFillPath(index, suffix);
                          const meta: FieldMeta =
                            suffix === 'qty'
                              ? {
                                  label: 'Quantity',
                                  path,
                                  valueType: 'number',
                                  type: 'number',
                                  required: true,
                                  step: 'any',
                                  inputMode: 'decimal',
                                }
                              : suffix === 'price'
                              ? {
                                  label: 'Price',
                                  path,
                                  valueType: 'number',
                                  type: 'number',
                                  required: true,
                                }
                              : {
                                  label: 'Timestamp',
                                  path,
                                  valueType: 'string',
                                  required: true,
                                  placeholder: 'ISO 8601',
                                };
                          return (
                            <Field
                              key={path}
                              meta={meta}
                              value={getValue(form, parsePath(path))}
                              missing={missing.has(path)}
                              onChange={(value) => updateField(path, value)}
                            />
                          );
                        })}
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field
                          meta={{ label: 'Leg Sequence', path: `fills[${index}].leg_seq`, valueType: 'integer', type: 'number' }}
                          value={getValue(form, parsePath(`fills[${index}].leg_seq`))}
                          missing={missing.has(`fills[${index}].leg_seq`)}
                          onChange={(value) => updateField(`fills[${index}].leg_seq`, value)}
                        />
                        <Field
                          meta={{
                            label: 'Side',
                            path: `fills[${index}].side`,
                            valueType: 'string',
                            type: 'select',
                            options: ['buy', 'sell'],
                          }}
                          value={getValue(form, parsePath(`fills[${index}].side`))}
                          missing={missing.has(`fills[${index}].side`)}
                          onChange={(value) => updateField(`fills[${index}].side`, value)}
                        />
                        <Field
                          meta={{
                            label: 'Execution Mode',
                            path: `fills[${index}].execution_mode`,
                            valueType: 'string',
                            type: 'select',
                            options: EXECUTION_MODES,
                          }}
                          value={getValue(form, parsePath(`fills[${index}].execution_mode`))}
                          missing={missing.has(`fills[${index}].execution_mode`)}
                          onChange={(value) => updateField(`fills[${index}].execution_mode`, value)}
                        />
                        <Field
                          meta={{ label: 'Provider', path: `fills[${index}].provider`, valueType: 'string' }}
                          value={getValue(form, parsePath(`fills[${index}].provider`))}
                          missing={missing.has(`fills[${index}].provider`)}
                          onChange={(value) => updateField(`fills[${index}].provider`, value)}
                        />
                        <Field
                          meta={{ label: 'Venue ID', path: `fills[${index}].venue_id`, valueType: 'string' }}
                          value={getValue(form, parsePath(`fills[${index}].venue_id`))}
                          missing={missing.has(`fills[${index}].venue_id`)}
                          onChange={(value) => updateField(`fills[${index}].venue_id`, value)}
                        />
                        <Field
                          meta={{ label: 'Order ID', path: `fills[${index}].order_id`, valueType: 'string' }}
                          value={getValue(form, parsePath(`fills[${index}].order_id`))}
                          missing={missing.has(`fills[${index}].order_id`)}
                          onChange={(value) => updateField(`fills[${index}].order_id`, value)}
                        />
                        <Field
                          meta={{ label: 'Trade ID', path: `fills[${index}].trade_id`, valueType: 'string' }}
                          value={getValue(form, parsePath(`fills[${index}].trade_id`))}
                          missing={missing.has(`fills[${index}].trade_id`)}
                          onChange={(value) => updateField(`fills[${index}].trade_id`, value)}
                        />
                        <Field
                          meta={{ label: 'RFQ ID', path: `fills[${index}].rfq_id`, valueType: 'string' }}
                          value={getValue(form, parsePath(`fills[${index}].rfq_id`))}
                          missing={missing.has(`fills[${index}].rfq_id`)}
                          onChange={(value) => updateField(`fills[${index}].rfq_id`, value)}
                        />
                        <Field
                          meta={{ label: 'Deal ID', path: `fills[${index}].deal_id`, valueType: 'string' }}
                          value={getValue(form, parsePath(`fills[${index}].deal_id`))}
                          missing={missing.has(`fills[${index}].deal_id`)}
                          onChange={(value) => updateField(`fills[${index}].deal_id`, value)}
                        />
                        <Field
                          meta={{ label: 'Fees', path: `fills[${index}].fees`, valueType: 'number', type: 'number' }}
                          value={getValue(form, parsePath(`fills[${index}].fees`))}
                          missing={missing.has(`fills[${index}].fees`)}
                          onChange={(value) => updateField(`fills[${index}].fees`, value)}
                        />
                        <Field
                          meta={{ label: 'Notes', path: `fills[${index}].notes`, valueType: 'string', type: 'textarea' }}
                          value={getValue(form, parsePath(`fills[${index}].notes`))}
                          missing={missing.has(`fills[${index}].notes`)}
                          onChange={(value) => updateField(`fills[${index}].notes`, value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
            </div>
          </div>
        </div>
    </Overlay>
  );
}

