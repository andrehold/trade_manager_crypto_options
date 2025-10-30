import React from 'react';
import { X } from 'lucide-react';
import Overlay from './Overlay';
import type { Position, TxnRow } from '../utils';
import { computeMissing } from '../features/import/missing';
import type { ImportPayload } from '../lib/import';
import { tryGetSupabaseClient } from '../lib/supabase';
import { useAuth } from '../features/auth/useAuth';
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
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) return ts;
  return new Date(parsed).toISOString();
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
      const parsed = Number(raw);
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
}: {
  open: boolean;
  onClose: () => void;
  position: Position;
  allPositions: Position[];
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
  const { user, loading: authLoading, supabaseConfigured } = useAuth();
  const supabase = React.useMemo(
    () => (supabaseConfigured ? tryGetSupabaseClient() : null),
    [supabaseConfigured],
  );

  React.useEffect(() => {
    if (!supabase || !user) return;
    let active = true;
    const loadPrograms = async () => {
      try {
        const { data, error } = await supabase
          .from('programs')
          .select('program_id, program_name')
          .order('program_name');
        if (!active) return;
        if (error) {
          console.error('Failed to load program resources', error);
          return;
        }
        setProgramOptions(data ?? []);
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
    setForm(buildInitialPayload(position));
    setIncludeVenue(false);
  }, [position]);

  const updateField = React.useCallback((path: string, value: any) => {
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
  const linkableStructureOptions = React.useMemo(
    () =>
      allPositions
        .filter((candidate) => candidate.status === 'OPEN' && candidate.id !== position.id)
        .map((candidate) => {
          const parts = [
            candidate.structureId ? `#${candidate.structureId}` : 'No structure #',
            candidate.underlying,
          ];
          if (candidate.expiryISO) parts.push(candidate.expiryISO);
          if (candidate.exchange) parts.push(candidate.exchange.toUpperCase());
          return {
            value: candidate.structureId ?? candidate.id,
            label: parts.join(' • '),
          };
        }),
    [allPositions, position.id],
  );

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

  const handleLinkedStructureChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
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
    [closeTargetStructureId, lifecycle, updateField],
  );

  const handleCloseTargetChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      updateField(
        'position.close_target_structure_id',
        event.target.value ? event.target.value : undefined,
      );
    },
    [updateField],
  );

  const payloadForValidation = React.useMemo(
    () => ensureVenue(form, includeVenue),
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

  const missingLegPath = (index: number, suffix: string) => `legs[${index}].${suffix}`;
  const missingFillPath = (index: number, suffix: string) => `fills[${index}].${suffix}`;

  const supabaseUnavailable = !supabaseConfigured || !supabase;
  const supabaseChecking = !supabaseUnavailable && authLoading;
  const supabaseSignedOut = !supabaseUnavailable && !authLoading && !user;

  return (
    <Overlay open={open} onClose={onClose} title={`Structure entry for ${position.underlying}`}>
      <div
        className="flex max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white"
        style={{ width: 'min(960px, calc(100vw - 3rem))' }}
      >
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Structure entry for {position.underlying}</h2>
              <p className="text-xs text-slate-500">
                Fill in details for program, position, legs, and fills. Fields marked with * are required.
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
                  {linkableStructureOptions.length > 0 ? (
                    <>
                      <select
                        multiple
                        value={linkedStructureIds}
                        onChange={handleLinkedStructureChange}
                        className={`mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                          lifecycle === 'close' && missing.has('position.close_target_structure_id')
                            ? 'border-rose-500 focus:ring-rose-400'
                            : 'border-slate-200 focus:ring-slate-400'
                        }`}
                      >
                        {linkableStructureOptions.map((option) => (
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
                      {lifecycle === 'close' ? (
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
                  {linkableStructureOptions.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Save at least one structure as open to link it when recording a close.
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
                  onClick={() => setIncludeVenue((prev) => !prev)}
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

