import React from 'react'
import Papa from 'papaparse'
import { Toggle } from './components/Toggle'
import { UploadBox } from './components/UploadBox'
import { ColumnMapper } from './components/ColumnMapper'
import { ReviewOverlay, type ReviewStructureOption } from './components/ReviewOverlay'
import { ImportedTransactionsOverlay } from './components/ImportedTransactionsOverlay'
import { SupabaseLogin } from './features/auth/SupabaseLogin'
import { useAuth } from './features/auth/useAuth'
import { tryGetSupabaseClient } from './lib/supabase'
import {
  Position, TxnRow, Lot,
  useLocalStorage, devQuickTests,
  parseActionSide, toNumber, parseInstrumentByExchange, normalizeSecond,
  daysTo, daysSince, fifoMatchAndRealize, classifyStatus, calculatePnlPct,
  Exchange, getLegMarkRef, fmtGreek, legGreekExposure, toDeribitInstrument,
  positionGreeks, positionUnrealizedPnL, formatInstrumentLabel
} from './utils'
import { PositionRow } from './components/PositionRow'
import { PlaybookDrawer } from './components/PlaybookDrawer'
import { ccGetBest } from './lib/venues/coincall'
import { dbGetBest, dbGetTicker } from './lib/venues/deribit'
import {
  archiveStructure,
  fetchSavedStructures,
  appendTradesToStructure,
  backfillLegExpiries,
  saveTransactionLogs,
  saveUnprocessedTrades,
  buildStructureChipSummary,
  buildStructureSummaryLines,
  fetchProgramPlaybooks,
  type ProgramPlaybook,
} from './lib/positions'
import { resolveClientAccess } from './features/auth/access'
import {
  deriveSyntheticDeliveryTradeId,
  extractIdentifier,
  sanitizeIdentifier,
} from './lib/positions/identifiers'

const CLIENT_LIST_STORAGE_KEY = 'tm_client_names_v1'
const SELECTED_CLIENT_STORAGE_KEY = 'tm_selected_client_v1'
const RAW_ROWS_STORAGE_KEY = 'deribit_raw_rows_by_client_v1'
const POSITIONS_STORAGE_KEY = 'deribit_positions_by_client_v1'
const EXCHANGE_POSITIONS_STORAGE_KEY = 'tm_exchange_positions_by_client_v1'
const DEFAULT_CLIENT_NAME = 'General'

const GREEK_SUMMARY_FIELDS = [
  { key: 'delta', label: 'Delta', symbol: 'Δ' },
  { key: 'gamma', label: 'Gamma', symbol: 'Γ' },
  { key: 'theta', label: 'Theta', symbol: 'Θ' },
  { key: 'vega', label: 'Vega', symbol: 'V' },
  { key: 'rho', label: 'Rho', symbol: 'Ρ' },
] as const

type GreekKey = typeof GREEK_SUMMARY_FIELDS[number]['key']

type SavedSortKey =
  | 'status'
  | 'structure'
  | 'dte'
  | 'legs'
  | 'strategy'
  | 'pnl'
  | 'pnlpct'
  | 'delta'
  | 'gamma'
  | 'theta'
  | 'vega'
  | 'rho'
  | 'playbook'

type ExchangePositionSnapshot = {
  id: string;
  exchange: Exchange | 'unknown';
  instrument: string;
  expiryISO: string | null;
  size: number | null;
  side: string;
  avgPrice: number | null;
  markPrice: number | null;
  indexPrice: number | null;
};

type DashboardAppProps = {
  onOpenPlaybookIndex?: () => void
}

export default function DashboardApp({ onOpenPlaybookIndex }: DashboardAppProps = {}) {
  React.useEffect(() => { devQuickTests(); }, []);

  const { user, loading: authLoading, supabaseConfigured } = useAuth();
  const { isAdmin, clientName: lockedClientName } = React.useMemo(
    () => resolveClientAccess(user),
    [user],
  );
  const supabase = React.useMemo(
    () => (supabaseConfigured ? tryGetSupabaseClient() : null),
    [supabaseConfigured],
  );

  const [clientOptions, setClientOptions] = useLocalStorage<string[]>(
    CLIENT_LIST_STORAGE_KEY,
    [DEFAULT_CLIENT_NAME],
  );
  const [selectedClient, setSelectedClient] = useLocalStorage<string>(
    SELECTED_CLIENT_STORAGE_KEY,
    DEFAULT_CLIENT_NAME,
  );

  React.useEffect(() => {
    if (isAdmin) return;
    const enforced = (lockedClientName ?? DEFAULT_CLIENT_NAME).trim() || DEFAULT_CLIENT_NAME;
    setClientOptions((prev) => {
      if (prev.length === 1 && prev[0] === enforced) return prev;
      return [enforced];
    });
    setSelectedClient((prev) => (prev === enforced ? prev : enforced));
  }, [isAdmin, lockedClientName, setClientOptions, setSelectedClient]);

  const [rawRowsByClient, setRawRowsByClient] = useLocalStorage<Record<string, any[]>>(
    RAW_ROWS_STORAGE_KEY,
    {} as Record<string, any[]>,
  );
  const activeClientName = React.useMemo(() => {
    if (isAdmin) {
      const preferred = selectedClient?.trim();
      return preferred && preferred.length > 0
        ? preferred
        : clientOptions[0] ?? DEFAULT_CLIENT_NAME;
    }
    const locked = lockedClientName?.trim();
    if (locked && locked.length > 0) return locked;
    return selectedClient || DEFAULT_CLIENT_NAME;
  }, [clientOptions, isAdmin, lockedClientName, selectedClient]);

  const overlayClientScope = React.useMemo(
    () => ({ activeClient: activeClientName, isAdmin }),
    [activeClientName, isAdmin],
  );
  const rawRows = rawRowsByClient[activeClientName] ?? [];
  const setRawRows = React.useCallback(
    (next: any[] | ((prev: any[]) => any[])) => {
      setRawRowsByClient((prev) => {
        const current = prev[activeClientName] ?? [];
        const resolved = typeof next === 'function' ? (next as (prev: any[]) => any[])(current) : next;
        return { ...prev, [activeClientName]: resolved };
      });
    },
    [activeClientName, setRawRowsByClient],
  );

  const [positionsByClient, setPositionsByClient] = useLocalStorage<Record<string, Position[]>>(
    POSITIONS_STORAGE_KEY,
    {} as Record<string, Position[]>,
  );
  const positions = positionsByClient[activeClientName] ?? [];
  const setPositions = React.useCallback(
    (next: Position[] | ((prev: Position[]) => Position[])) => {
      setPositionsByClient((prev) => {
        const current = prev[activeClientName] ?? [];
        const resolved = typeof next === 'function' ? (next as (prev: Position[]) => Position[])(current) : next;
        return { ...prev, [activeClientName]: resolved };
      });
    },
    [activeClientName, setPositionsByClient],
  );
  const [exchangePositionsByClient, setExchangePositionsByClient] = useLocalStorage<Record<string, ExchangePositionSnapshot[]>>(
    EXCHANGE_POSITIONS_STORAGE_KEY,
    {} as Record<string, ExchangePositionSnapshot[]>,
  );
  const exchangePositions = exchangePositionsByClient[activeClientName] ?? [];
  const setExchangePositions = React.useCallback(
    (next: ExchangePositionSnapshot[] | ((prev: ExchangePositionSnapshot[]) => ExchangePositionSnapshot[])) => {
      setExchangePositionsByClient((prev) => {
        const current = prev[activeClientName] ?? [];
        const resolved = typeof next === 'function' ? (next as (prev: ExchangePositionSnapshot[]) => ExchangePositionSnapshot[])(current) : next;
        return { ...prev, [activeClientName]: resolved };
      });
    },
    [activeClientName, setExchangePositionsByClient],
  );
  const [savedStructures, setSavedStructures] = React.useState<Position[]>([]);
  const [savedStructuresLoading, setSavedStructuresLoading] = React.useState(false);
  const [savedStructuresError, setSavedStructuresError] = React.useState<string | null>(null);
  const [savedStructuresVersion, setSavedStructuresVersion] = React.useState(0);
  const [programPlaybooks, setProgramPlaybooks] = React.useState<Map<string, ProgramPlaybook>>(new Map());
  const [programPlaybooksLoading, setProgramPlaybooksLoading] = React.useState(false);
  const [programPlaybooksError, setProgramPlaybooksError] = React.useState<string | null>(null);
  const [archiving, setArchiving] = React.useState<Record<string, boolean>>({});
  const [showMapper, setShowMapper] = React.useState<{ headers: string[]; mode: 'import' | 'backfill' } | null>(null);
  const [showReview, setShowReview] = React.useState<{
    rows: TxnRow[];
    excludedRows: TxnRow[];
    duplicateTradeIds?: string[];
    duplicateOrderIds?: string[];
    importHistorical?: boolean;
    allowAllocations?: boolean;
  } | null>(null);
  const [showImportedOverlay, setShowImportedOverlay] = React.useState(false);
  const [importedRows, setImportedRows] = React.useState<
    Array<{
      id: string;
      timestamp: string | null;
      instrument: string;
      side: string;
      amount: number | null;
      price: number | null;
      fee: number | null;
      tradeId: string | null;
      orderId: string | null;
      status: 'linked' | 'unprocessed';
      structureId?: string | null;
      structureLabel?: string | null;
      warning?: string | null;
    }>
  >([]);
  const [importedLoading, setImportedLoading] = React.useState(false);
  const [importedError, setImportedError] = React.useState<string | null>(null);
  const [backfillStatus, setBackfillStatus] = React.useState<{
    type: 'idle' | 'running' | 'success' | 'error';
    message?: string;
  }>({ type: 'idle' });
  const [activePlaybookPosition, setActivePlaybookPosition] = React.useState<Position | null>(null);
  const [alertsOnly, setAlertsOnly] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [showInstrumentSuggestions, setShowInstrumentSuggestions] = React.useState(false);
  const [savedSort, setSavedSort] = React.useState<{ key: SavedSortKey; direction: 'asc' | 'desc' }>({
    key: 'pnlpct',
    direction: 'desc',
  });
  const [visibleCols, setVisibleCols] = useLocalStorage<string[]>("visible_cols_v2", [
    "status","structure","dte","legs","strategy","pnl","pnlpct","delta","gamma","theta","vega","rho","playbook"
  ]);
  const [selectedExchange, setSelectedExchange] = React.useState<Exchange>('deribit');
  const [btcSpot, setBtcSpot] = React.useState<number | null>(null);
  const [btcSpotUpdatedAt, setBtcSpotUpdatedAt] = React.useState<Date | null>(null);
  // price per unique leg "exchange:symbol"
  const [legMarks, setLegMarks] = React.useState<Record<string, {price: number|null, multiplier: number|null; greeks?: {
    delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number;
    } }>>({});
  const [markFetch, setMarkFetch] = React.useState({
    inProgress: false,
    total: 0,
    done: 0,
    errors: 0,
  });
  const positionUploadRef = React.useRef<HTMLInputElement | null>(null);
  const backfillUploadRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!clientOptions.length) {
      setClientOptions([DEFAULT_CLIENT_NAME]);
      setSelectedClient(DEFAULT_CLIENT_NAME);
      return;
    }
    if (!selectedClient || !clientOptions.includes(selectedClient)) {
      setSelectedClient(clientOptions[0]);
    }
  }, [clientOptions, selectedClient, setClientOptions, setSelectedClient]);

  React.useEffect(() => {
    if (!isAdmin) return;
    const discovered = savedStructures
      .map((structure) => (structure.clientName ?? '').trim())
      .filter((name) => name.length > 0 && !clientOptions.includes(name));
    if (discovered.length) {
      setClientOptions((prev) => {
        const next = [...prev];
        for (const name of discovered) {
          if (!next.includes(name)) next.push(name);
        }
        return next;
      });
    }
  }, [savedStructures, clientOptions, setClientOptions, isAdmin]);

  const handleAddClient = React.useCallback(async () => {
    if (!isAdmin) {
      alert('Client management is restricted to admin users.');
      return;
    }
    const nextName = prompt('Client name');
    const trimmed = nextName?.trim();
    if (!trimmed) return;

    let isNewClient = false;
    setClientOptions((prev) => {
      if (prev.includes(trimmed)) return prev;
      isNewClient = true;
      return [...prev, trimmed];
    });
    setSelectedClient(trimmed);

    if (!isNewClient) return;

    if (!supabase) {
      console.warn('Supabase is not configured; skipping client database sync.');
      return;
    }

    if (!user) {
      alert('Sign in to Supabase to sync new clients.');
      return;
    }

    const { error } = await supabase
      .from('clients')
      .insert({ client_name: trimmed })
      .select('client_id')
      .single();

    if (error && error.code !== '23505') {
      alert(`Failed to add client to database: ${error.message}`);
    }
  }, [isAdmin, setClientOptions, setSelectedClient, supabase, user]);

  function handleFiles(files: FileList, mode: 'import' | 'backfill' = 'import') {
    const file = files[0];
    const common: any = {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h: string) => h.replace(/^\ufeff/, '').trim(),
    };

    const onParsed = (rows: any[]) => {
      if (!rows || !rows.length) {
        alert('No rows found in CSV. Check the delimiter (comma vs semicolon) and header row.');
        return;
      }
      setRawRows(rows);
      const headers = Object.keys(rows[0] || {});
      setShowMapper({ headers, mode });
    };

    Papa.parse(file, {
      ...common,
      complete: (res: any) => {
        const rows = res.data as any[];
        const fields: string[] = (res.meta && res.meta.fields) ? (res.meta.fields as string[]) : Object.keys(rows[0] || {});
        if (!fields || fields.length <= 1) {
          Papa.parse(file, {
            ...common,
            delimiter: ';',
            complete: (res2: any) => onParsed(res2.data as any[]),
            error: (e: any) => alert('CSV parse error (semicolon fallback): ' + (e && e.message ? e.message : String(e))),
          });
        } else {
          onParsed(rows);
        }
      },
      error: (e: any) => alert('CSV parse error: ' + (e && e.message ? e.message : String(e))),
    });
  }

  const handleBackfillFiles = React.useCallback(
    (files: FileList) => {
      handleFiles(files, 'backfill');
    },
    [],
  );

  const toOptionalNumber = React.useCallback((value: any) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const parsed = toNumber(value);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);

  const parseExchangePositionRow = React.useCallback((row: any, index: number): ExchangePositionSnapshot | null => {
    const instrument = String(row.instrument_name ?? row.displayName ?? row.symbol ?? row.instrument ?? '').trim();
    if (!instrument) return null;

    const exchange: Exchange | 'unknown' = row.instrument_name
      ? 'deribit'
      : row.tradeSide !== undefined || row.displayName || row.symbol
      ? 'coincall'
      : 'unknown';
    const exchangeForParser = exchange === 'unknown' ? 'deribit' : exchange;
    const parsed = parseInstrumentByExchange(exchangeForParser, instrument);

    const endTimeRaw = toOptionalNumber(row.endTime);
    const expiryFromEnd = endTimeRaw
      ? new Date(endTimeRaw < 1e12 ? endTimeRaw * 1000 : endTimeRaw).toISOString().slice(0, 10)
      : null;
    const expiryISO = parsed?.expiryISO ?? expiryFromEnd ?? null;

    const sizeRaw = row.size ?? row.qty ?? row.position ?? row.amount;
    const sizeValue = toOptionalNumber(sizeRaw);
    const size = sizeValue !== null ? Math.abs(sizeValue) : null;

    let side = String(row.direction ?? row.side ?? '').toLowerCase();
    if (!side && row.tradeSide !== undefined) {
      const tradeSide = toOptionalNumber(row.tradeSide);
      if (tradeSide === 1) side = 'buy';
      if (tradeSide === 2) side = 'sell';
    }
    if (!side && sizeValue !== null) {
      side = sizeValue < 0 ? 'sell' : 'buy';
    }

    const avgPrice = toOptionalNumber(row.avgPrice ?? row.average_price_usd ?? row.average_price ?? row.avg_price);
    const markPrice = toOptionalNumber(row.markPrice ?? row.mark_price);
    const indexPrice = toOptionalNumber(row.indexPrice ?? row.index_price);

    return {
      id: `${exchange}-${instrument}-${index}`,
      exchange,
      instrument,
      expiryISO,
      size,
      side: side || '—',
      avgPrice,
      markPrice,
      indexPrice,
    };
  }, [toOptionalNumber]);

  const handlePositionFiles = React.useCallback((files: FileList) => {
    const file = files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h: string) => h.replace(/^\ufeff/, '').trim(),
      complete: (res: any) => {
        const rows = res.data as any[];
        if (!rows || !rows.length) {
          alert('No rows found in CSV. Check the delimiter (comma vs semicolon) and header row.');
          return;
        }
        const mapped = rows
          .map((row, idx) => parseExchangePositionRow(row, idx))
          .filter((row): row is ExchangePositionSnapshot => Boolean(row));
        setExchangePositions(mapped);
      },
    });
  }, [parseExchangePositionRow, setExchangePositions]);

  const filterRowsWithExistingTradeIds = React.useCallback(
    async (rows: TxnRow[], options: { allowAllocations?: boolean } = {}) => {
      if (!supabase) {
        return {
          filtered: rows,
          duplicates: [] as TxnRow[],
          duplicateTradeIds: [] as string[],
          duplicateOrderIds: [] as string[],
        };
      }

      const uniqueTradeIds = Array.from(
        new Set(
          rows
            .map((row) => row.trade_id?.trim())
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const uniqueOrderIds = Array.from(
        new Set(
          rows
            .map((row) => row.order_id?.trim())
            .filter((id): id is string => Boolean(id)),
        ),
      );

      if (uniqueTradeIds.length === 0 && uniqueOrderIds.length === 0) {
        return {
          filtered: rows,
          duplicates: [] as TxnRow[],
          duplicateTradeIds: [] as string[],
          duplicateOrderIds: [] as string[],
        };
      }

      const clientFilter = activeClientName?.trim();
      const restrictByClient = Boolean(clientFilter) && !isAdmin;
      const duplicateTradeIds = new Set<string>();
      const duplicateOrderIds = new Set<string>();
      const chunkSize = 99;

      for (let start = 0; start < uniqueTradeIds.length; start += chunkSize) {
        const chunk = uniqueTradeIds.slice(start, start + chunkSize);
        let query = supabase
          .from('fills')
          .select(restrictByClient ? 'trade_id, positions!inner(client_name)' : 'trade_id')
          .in('trade_id', chunk);

        if (restrictByClient && clientFilter) {
          query = query.eq('positions.client_name', clientFilter);
        }

        const { data, error } = await query;
        if (error) {
          console.warn('Failed to check existing trade IDs in fills table.', error);
          return { filtered: rows, duplicates: [] as TxnRow[] };
        }

        for (const entry of data ?? []) {
          const id = typeof entry.trade_id === 'string' ? entry.trade_id.trim() : '';
          if (id) duplicateTradeIds.add(id);
        }

        const { data: unprocessed, error: unprocessedErr } = await supabase
          .from('unprocessed_imports')
          .select('trade_id, client_name')
          .in('trade_id', chunk)
          .match(restrictByClient && clientFilter ? { client_name: clientFilter } : {});

        if (unprocessedErr) {
          console.warn('Failed to check existing trade IDs in unprocessed_imports table.', unprocessedErr);
        }

        for (const entry of unprocessed ?? []) {
          const id = typeof entry.trade_id === 'string' ? entry.trade_id.trim() : '';
          const isSameClient = !restrictByClient || !clientFilter || entry.client_name === clientFilter;
          if (id && isSameClient) duplicateTradeIds.add(id);
        }
      }

      for (let start = 0; start < uniqueOrderIds.length; start += chunkSize) {
        const chunk = uniqueOrderIds.slice(start, start + chunkSize);
        let query = supabase
          .from('fills')
          .select(restrictByClient ? 'order_id, positions!inner(client_name)' : 'order_id')
          .in('order_id', chunk);

        if (restrictByClient && clientFilter) {
          query = query.eq('positions.client_name', clientFilter);
        }

        const { data, error } = await query;
        if (error) {
          console.warn('Failed to check existing order IDs in fills table.', error);
          return {
            filtered: rows,
            duplicates: [] as TxnRow[],
            duplicateTradeIds: [] as string[],
            duplicateOrderIds: [] as string[],
          };
        }

        for (const entry of data ?? []) {
          const id = typeof entry.order_id === 'string' ? entry.order_id.trim() : '';
          if (id) duplicateOrderIds.add(id);
        }

        const { data: unprocessed, error: unprocessedErr } = await supabase
          .from('unprocessed_imports')
          .select('order_id, client_name')
          .in('order_id', chunk)
          .match(restrictByClient && clientFilter ? { client_name: clientFilter } : {});

        if (unprocessedErr) {
          console.warn('Failed to check existing order IDs in unprocessed_imports table.', unprocessedErr);
        }

        for (const entry of unprocessed ?? []) {
          const id = typeof entry.order_id === 'string' ? entry.order_id.trim() : '';
          const isSameClient = !restrictByClient || !clientFilter || entry.client_name === clientFilter;
          if (id && isSameClient) duplicateOrderIds.add(id);
        }
      }

      if (!duplicateTradeIds.size && !duplicateOrderIds.size) {
        return {
          filtered: rows,
          duplicates: [] as TxnRow[],
          duplicateTradeIds: [] as string[],
          duplicateOrderIds: [] as string[],
        };
      }

      if (options.allowAllocations) {
        return {
          filtered: rows,
          duplicates: [] as TxnRow[],
          duplicateTradeIds: Array.from(duplicateTradeIds),
          duplicateOrderIds: Array.from(duplicateOrderIds),
        };
      }

      const filtered = rows.filter((row) => {
        const id = row.trade_id?.trim();
        const orderId = row.order_id?.trim();
        const hasTrade = Boolean(id && duplicateTradeIds.has(id));
        const hasOrder = Boolean(orderId && duplicateOrderIds.has(orderId));
        return !hasTrade && !hasOrder;
      });

      const duplicateRows = rows.filter((row) => {
        const id = row.trade_id?.trim();
        const orderId = row.order_id?.trim();
        const isTradeDuplicate = Boolean(id && duplicateTradeIds.has(id));
        const isOrderDuplicate = Boolean(orderId && duplicateOrderIds.has(orderId));
        return isTradeDuplicate || isOrderDuplicate;
      });

      return {
        filtered,
        duplicates: duplicateRows,
        duplicateTradeIds: Array.from(duplicateTradeIds),
        duplicateOrderIds: Array.from(duplicateOrderIds),
      };
    },
    [supabase, activeClientName, isAdmin],
  );

  const resolveIdentifierFromMapping = React.useCallback(
    (row: Record<string, unknown>, mappingKey: string | undefined, type: 'trade' | 'order') => {
      const direct = mappingKey ? sanitizeIdentifier(row[mappingKey]) : null;
      if (direct) return direct;

      if (mappingKey) {
        const target = mappingKey.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        for (const [key, value] of Object.entries(row)) {
          const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          if (normalized === target) {
            const sanitized = sanitizeIdentifier(value);
            if (sanitized) return sanitized;
          }
        }
      }

      return extractIdentifier(row as any, type);
    },
    [],
  );

  const mapRowsFromMapping = React.useCallback(
    (mapping: Record<string, string>, mode: 'import' | 'backfill' = 'import') => {
      const exchange = (mapping as any).__exchange || 'deribit';
      let rowsWithInstrument = 0;
      const mappedRaw: TxnRow[] = rawRows
        .map((r) => {
          const rawSide = String(r[mapping.side] ?? '');
          const { action, side } = parseActionSide(rawSide);
          const mappedTradeId = resolveIdentifierFromMapping(r as Record<string, unknown>, mapping.trade_id, 'trade');
          const mappedOrderId = resolveIdentifierFromMapping(r as Record<string, unknown>, mapping.order_id, 'order');

          const hasInstrument = Boolean(String(r[mapping.instrument] ?? '').trim());
          if (!hasInstrument) {
            return null;
          }
          rowsWithInstrument += 1;

          const provisionalRow: TxnRow = {
            instrument: String(r[mapping.instrument] ?? '').trim(),
            side: side || '',
            action,
            amount: mapping.amount ? toNumber(r[mapping.amount]) : 0,
            price: mapping.price ? toNumber(r[mapping.price]) : 0,
            fee: mapping.fee ? toNumber(r[mapping.fee]) : 0,
            timestamp: mapping.timestamp ? String(r[mapping.timestamp]) : undefined,
            trade_id: mappedTradeId ?? undefined,
            order_id: mappedOrderId ?? undefined,
            info: mapping.info ? String(r[mapping.info]) : undefined,
            exchange: exchange as Exchange,
          }

          const syntheticTradeId =
            provisionalRow.trade_id ??
            deriveSyntheticDeliveryTradeId(provisionalRow, r as Record<string, unknown>) ??
            undefined

          const baseRow = {
            ...provisionalRow,
            trade_id: syntheticTradeId,
          } as TxnRow;

          if (mode === 'backfill') {
            return baseRow;
          }

          const hasSide = baseRow.side === 'buy' || baseRow.side === 'sell';
          const hasAmount = Number.isFinite(baseRow.amount) && Math.abs(baseRow.amount) > 0;
          const hasPrice = Number.isFinite(baseRow.price);
          if (!hasSide || !hasAmount || !hasPrice) {
            return null;
          }
          return baseRow;
        })
        .filter((row): row is TxnRow => Boolean(row));

      // Keep all rows, including 08:00 delivery/settlement records, so they are visible in the review overlay.
      const timeCleaned: TxnRow[] = mappedRaw;

      const optionsOnly: TxnRow[] = [];
      const excludedRows: TxnRow[] = [];
      for (const row of timeCleaned) {
        const parsed = parseInstrumentByExchange(exchange as Exchange, row.instrument);
        if (parsed) optionsOnly.push(row); else excludedRows.push(row);
      }

      return {
        exchange: exchange as Exchange,
        rows: optionsOnly,
        excludedRows,
        stats: {
          totalRows: rawRows.length,
          rowsWithInstrument,
          parsedOptionRows: optionsOnly.length,
        },
      };
    },
    [rawRows, resolveIdentifierFromMapping],
  );

  const saveRawTransactionLogs = React.useCallback(
    async (mapping: Record<string, string>, exchange: Exchange) => {
      if (!supabase) {
        console.warn('Supabase is not configured; skipping transaction log save.');
        return;
      }
      if (!user) {
        console.warn('Sign in to save transaction logs.');
        return;
      }

      const hasValue = (value: unknown) => {
        if (value == null) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        return true;
      };

      const isEmptyRow = (row: Record<string, unknown>) =>
        !Object.values(row).some((value) => hasValue(value));

      const entries = rawRows
        .filter((row) => row && !isEmptyRow(row as Record<string, unknown>))
        .map((row) => {
          const instrumentKey = mapping.instrument;
          const timestampKey = mapping.timestamp;
          const instrument = instrumentKey ? String((row as any)[instrumentKey] ?? '').trim() : '';
          const timestamp = timestampKey ? String((row as any)[timestampKey] ?? '').trim() : '';
          return {
            exchange,
            raw: row as Record<string, unknown>,
            instrument: instrument || null,
            timestamp: timestamp || null,
            tradeId: resolveIdentifierFromMapping(row as Record<string, unknown>, mapping.trade_id, 'trade'),
            orderId: resolveIdentifierFromMapping(row as Record<string, unknown>, mapping.order_id, 'order'),
          };
        });

      if (!entries.length) {
        return;
      }

      const result = await saveTransactionLogs(supabase, {
        entries,
        clientScope: { clientName: activeClientName, isAdmin },
        createdBy: user.id,
      });

      if (!result.ok) {
        console.warn('Failed to save transaction logs.', result.error);
      }
    },
    [activeClientName, isAdmin, rawRows, resolveIdentifierFromMapping, saveTransactionLogs, supabase, user],
  );

  async function startImport(mapping: Record<string, string>) {
    const exchange = (mapping as any).__exchange || 'deribit';
    const importHistorical = Boolean((mapping as any).__importHistorical);
    const allowAllocations = Boolean((mapping as any).__allowAllocations);
    setSelectedExchange(exchange as Exchange);
    await saveRawTransactionLogs(mapping, exchange as Exchange);
    const { rows, excludedRows } = mapRowsFromMapping(mapping, 'import');
    if (importHistorical) {
      setShowMapper(null);
      setShowReview({
        rows,
        excludedRows,
        importHistorical: true,
        allowAllocations,
      });
      return;
    }

    const { filtered, duplicateTradeIds, duplicateOrderIds } = await filterRowsWithExistingTradeIds(rows, {
      allowAllocations,
    });

    setShowMapper(null);
    setShowReview({
      rows: filtered,
      excludedRows,
      duplicateTradeIds: duplicateTradeIds.length ? duplicateTradeIds : undefined,
      duplicateOrderIds: duplicateOrderIds.length ? duplicateOrderIds : undefined,
      importHistorical: false,
      allowAllocations,
    });
  }

  const loadImportedTransactions = React.useCallback(async () => {
    if (!supabase) {
      setImportedError('Supabase is not configured.');
      return;
    }
    if (!user) {
      setImportedError('Sign in to view imported transactions.');
      return;
    }

    setImportedLoading(true);
    setImportedError(null);
    try {
      const parseNumeric = (value: number | string | null | undefined) => {
        if (value == null) return null;
        const numeric = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      };

      const clientFilter = activeClientName?.trim();
      const restrictByClient = Boolean(clientFilter) && !isAdmin;

      let positionQuery = supabase
        .from('positions')
        .select('position_id, underlier, client_name');

      if (restrictByClient && clientFilter) {
        positionQuery = positionQuery.eq('client_name', clientFilter);
      }

      const { data: positionsData, error: positionsError } = await positionQuery;
      if (positionsError) {
        throw positionsError;
      }

      const positionsList = positionsData ?? [];
      const positionIds = positionsList.map((row) => row.position_id).filter(Boolean);
      const underlierMap = new Map<string, string>();
      for (const row of positionsList) {
        if (row.position_id) {
          underlierMap.set(row.position_id, row.underlier ?? '');
        }
      }

      const legsMap = new Map<string, { expiry: string | null; strike: number | null; optionType: string | null }>();
      if (positionIds.length > 0) {
        const { data: legsData, error: legsError } = await supabase
          .from('legs')
          .select('position_id, leg_seq, expiry, strike, option_type')
          .in('position_id', positionIds);
        if (legsError) {
          throw legsError;
        }
        for (const leg of legsData ?? []) {
          const key = `${leg.position_id}::${leg.leg_seq}`;
          legsMap.set(key, {
            expiry: leg.expiry ?? null,
            strike: parseNumeric(leg.strike),
            optionType: leg.option_type ?? null,
          });
        }
      }

      let fills: Array<{
        position_id: string;
        leg_seq: number | null;
        ts: string | null;
        qty: number | string | null;
        price: number | string | null;
        fees: number | string | null;
        side: string | null;
        trade_id: string | null;
        order_id: string | null;
        open_close: string | null;
      }> = [];

      if (positionIds.length > 0) {
        const { data: fillsData, error: fillsError } = await supabase
          .from('fills')
          .select('position_id, leg_seq, ts, qty, price, fees, side, trade_id, order_id, open_close')
          .in('position_id', positionIds)
          .order('ts', { ascending: false })
          .limit(500);
        if (fillsError) {
          throw fillsError;
        }
        fills = fillsData ?? [];
      }

      let unprocessedQuery = supabase
        .from('unprocessed_imports')
        .select('id, instrument, side, amount, price, fee, timestamp, trade_id, order_id, client_name')
        .order('timestamp', { ascending: false })
        .limit(500);
      if (restrictByClient && clientFilter) {
        unprocessedQuery = unprocessedQuery.eq('client_name', clientFilter);
      }

      const { data: unprocessedRows, error: unprocessedError } = await unprocessedQuery;
      if (unprocessedError) {
        throw unprocessedError;
      }

      const savedStructureMap = new Map<string, string>();
      for (const position of savedStructures) {
        const label = `${position.underlying} • ${position.structureId ?? position.id}`;
        savedStructureMap.set(position.id, label);
      }

      const linkedRows = fills.map((fill, idx) => {
        const legKey = `${fill.position_id}::${fill.leg_seq ?? ''}`;
        const leg = legsMap.get(legKey);
        const underlier = underlierMap.get(fill.position_id) ?? '';
        const expiry = leg?.expiry ?? null;
        const strike = leg?.strike ?? null;
        const optionType = leg?.optionType ?? null;
        const instrument =
          underlier && expiry && Number.isFinite(strike ?? NaN) && optionType
            ? toDeribitInstrument(underlier, expiry, strike ?? 0, optionType)
            : '—';
        const warning =
          instrument === '—' ? 'Missing leg details for instrument.' : null;
        const structureLabel = savedStructureMap.get(fill.position_id) ?? fill.position_id;
        return {
          id: `fill-${fill.position_id}-${fill.leg_seq ?? 'x'}-${idx}`,
          timestamp: fill.ts ?? null,
          instrument,
          side: fill.side ?? '—',
          amount: parseNumeric(fill.qty),
          price: parseNumeric(fill.price),
          fee: parseNumeric(fill.fees),
          tradeId: fill.trade_id ?? null,
          orderId: fill.order_id ?? null,
          status: 'linked' as const,
          structureId: fill.position_id,
          structureLabel,
          warning,
        };
      });

      const unprocessedList = (unprocessedRows ?? []).map((row: any) => ({
        id: `unprocessed-${row.id ?? row.trade_id ?? row.order_id ?? Math.random().toString(36).slice(2)}`,
        timestamp: row.timestamp ?? null,
        instrument: row.instrument ?? '—',
        side: row.side ?? '—',
        amount: parseNumeric(row.amount),
        price: parseNumeric(row.price),
        fee: parseNumeric(row.fee),
        tradeId: row.trade_id ?? null,
        orderId: row.order_id ?? null,
        status: 'unprocessed' as const,
        structureId: null,
        structureLabel: null,
        warning: null,
      }));

      const merged = [...linkedRows, ...unprocessedList].sort((a, b) => {
        const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
        const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
        return tb - ta;
      });

      setImportedRows(merged);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load imported transactions.';
      setImportedError(message);
    } finally {
      setImportedLoading(false);
    }
  }, [activeClientName, isAdmin, savedStructures, supabase, user]);

  const startBackfill = React.useCallback(
    async (mapping: Record<string, string>) => {
      if (!supabase) {
        alert('Supabase is not configured. Configure environment variables to run backfill.');
        return;
      }
      if (!user) {
        alert('Sign in to Supabase to run backfill.');
        return;
      }

      const { rows, stats } = mapRowsFromMapping(mapping, 'backfill');
      if (!rows.length) {
        if (stats.totalRows > 0 && stats.rowsWithInstrument === 0) {
          setBackfillStatus({
            type: 'error',
            message: 'No instrument column mapped. Map the instrument column and try again.',
          });
        } else if (stats.rowsWithInstrument > 0 && stats.parsedOptionRows === 0) {
          setBackfillStatus({
            type: 'error',
            message: 'No option instruments parsed. Check the exchange selection or instrument format.',
          });
        } else {
          setBackfillStatus({ type: 'error', message: 'No valid rows found for backfill.' });
        }
        setShowMapper(null);
        return;
      }

      const hasIdentifiers = rows.some((row) => row.trade_id || row.order_id);
      if (!hasIdentifiers) {
        setBackfillStatus({
          type: 'error',
          message: 'No trade/order IDs found. Map trade_id or order_id columns to run backfill.',
        });
        setShowMapper(null);
        return;
      }

      setBackfillStatus({ type: 'running', message: 'Backfill in progress…' });
      setShowMapper(null);
      try {
        const result = await backfillLegExpiries(supabase, {
          rows,
          clientScope: { clientName: activeClientName, isAdmin },
        });

        if (!result.ok) {
          setBackfillStatus({ type: 'error', message: result.error });
          return;
        }

        setBackfillStatus({
          type: 'success',
          message: `Backfill complete: updated ${result.updated} legs.`,
        });
        if (showImportedOverlay) {
          void loadImportedTransactions();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Backfill failed.';
        setBackfillStatus({ type: 'error', message });
      }
    },
    [activeClientName, backfillLegExpiries, isAdmin, loadImportedTransactions, mapRowsFromMapping, showImportedOverlay, supabase, user],
  );

  React.useEffect(() => {
    if (!showImportedOverlay) return;
    void loadImportedTransactions();
  }, [loadImportedTransactions, showImportedOverlay]);

  async function finalizeImport(selectedRows: TxnRow[], unprocessedRows: TxnRow[]) {
    const rows: TxnRow[] = selectedRows.map((r, index) => {
      const normalized = normalizeSecond(r.timestamp);
      const fallbackStructure = normalized === 'NO_TS' ? `NO_TS_${index + 1}` : normalized;
      const structureId = String(r.structureId ?? fallbackStructure);
      const linkedStructureId =
        typeof r.linkedStructureId === 'string' && r.linkedStructureId.trim().length > 0
          ? r.linkedStructureId.trim()
          : undefined;
      return {
        ...r,
        structureId,
        linkedStructureId,
      };
    });

    console.log('[Import] Prepared rows from review overlay', {
      selectedRows,
      preparedRows: rows,
      unprocessedRows,
    });

    if (unprocessedRows.length > 0) {
      if (!supabase) {
        alert('Supabase is not configured. Configure environment variables to save unprocessed trades.');
        return;
      }

      if (!user) {
        alert('Sign in to Supabase to save unprocessed trades.');
        return;
      }

      console.log('[Import] Saving unprocessed trades to Supabase', {
        rows: unprocessedRows,
        clientScope: { clientName: activeClientName, isAdmin },
        createdBy: user.id,
      });

      const saveResult = await saveUnprocessedTrades(supabase, {
        rows: unprocessedRows,
        clientScope: { clientName: activeClientName, isAdmin },
        createdBy: user.id,
      });

      if (!saveResult.ok) {
        alert(`Failed to save unprocessed trades: ${saveResult.error}`);
        return;
      }
    }

    const linkedRows = rows.filter((row) => Boolean(row.linkedStructureId));
    const localRows = rows.filter((row) => !row.linkedStructureId);

    if (!linkedRows.length && !localRows.length) {
      setShowReview(null);
      return;
    }

    if (linkedRows.length > 0) {
      if (!supabase) {
        alert('Supabase is not configured. Configure environment variables to link trades to saved structures.');
        return;
      }

      if (!user) {
        alert('Sign in to Supabase to link trades to saved structures.');
        return;
      }

      const byStructure = new Map<string, TxnRow[]>();
      for (const row of linkedRows) {
        const targetId = row.linkedStructureId!;
        if (!byStructure.has(targetId)) byStructure.set(targetId, []);
        byStructure.get(targetId)!.push(row);
      }

      for (const [structureId, groupedRows] of byStructure.entries()) {
        console.log('[Import] Appending trades to saved structure', {
          structureId,
          rows: groupedRows,
          clientScope: { clientName: activeClientName, isAdmin },
        });

        const result = await appendTradesToStructure(supabase, {
          structureId,
          rows: groupedRows,
          clientScope: { clientName: activeClientName, isAdmin },
        });

        if (!result.ok) {
          alert(`Failed to update saved structure ${structureId}: ${result.error}`);
          return;
        }
      }

      refreshSavedStructures();
    }

    for (const row of localRows) {
      const parsed = parseInstrumentByExchange(selectedExchange, row.instrument);
      if (parsed) {
        row.underlying = parsed.underlying;
        row.expiry = parsed.expiryISO;
        row.strike = parsed.strike;
        row.optionType = parsed.optionType as any;
      }
    }

    const grouped = buildPositionsFromTransactions(localRows);
    setPositions(grouped);
    setShowReview(null);
  }

  const refreshSavedStructures = React.useCallback(() => {
    setSavedStructuresVersion((prev) => prev + 1);
  }, []);

  const handleArchiveStructure = React.useCallback(
    async (positionId: string) => {
      if (!supabase) {
        alert('Supabase is not configured. Configure environment variables to archive saved structures.');
        return;
      }

      if (!user) {
        alert('Sign in to Supabase to archive saved structures.');
        return;
      }

      const target = savedStructures.find((s) => s.id === positionId);
      const label = target ? `${target.underlying} • ${target.structureId ?? positionId}` : positionId;
      const confirmed = window.confirm(`Archive saved structure ${label}?\n\nArchived structures are hidden from this list.`);
      if (!confirmed) return;

      setArchiving((prev) => ({ ...prev, [positionId]: true }));
      try {
        const result = await archiveStructure(supabase, {
          positionId,
          archivedBy: user.id,
          clientScope: { clientName: activeClientName, isAdmin },
        });

        if (!result.ok) {
          alert(`Failed to archive structure: ${result.error}`);
          return;
        }

        refreshSavedStructures();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to archive structure.';
        alert(message);
      } finally {
        setArchiving((prev) => {
          const next = { ...prev };
          delete next[positionId];
          return next;
        });
      }
    },
    [supabase, user, savedStructures, refreshSavedStructures, activeClientName, isAdmin],
  );

  React.useEffect(() => {
    if (!supabase || !user) {
      setSavedStructures([]);
      setSavedStructuresError(null);
      setSavedStructuresLoading(false);
      return;
    }

    let ignore = false;
    setSavedStructuresLoading(true);
    fetchSavedStructures(supabase, { clientName: activeClientName, isAdmin })
      .then((result) => {
        if (ignore) return;
        if (result.ok) {
          setSavedStructures(result.positions);
          setSavedStructuresError(null);
        } else {
          setSavedStructures([]);
          setSavedStructuresError(result.error);
        }
      })
      .catch((err) => {
        if (ignore) return;
        const message = err instanceof Error ? err.message : 'Failed to load saved structures.';
        setSavedStructures([]);
        setSavedStructuresError(message);
      })
      .finally(() => {
        if (ignore) return;
        setSavedStructuresLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [supabase, user, savedStructuresVersion, selectedClient, isAdmin, activeClientName]);

  React.useEffect(() => {
    if (!supabase || !user) {
      setProgramPlaybooks(new Map());
      setProgramPlaybooksError(null);
      setProgramPlaybooksLoading(false);
      return;
    }

    const programIds = Array.from(
      new Set(
        savedStructures
          .map((structure) => structure.programId)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
      ),
    );

    if (programIds.length === 0) {
      setProgramPlaybooks(new Map());
      setProgramPlaybooksError(null);
      setProgramPlaybooksLoading(false);
      return;
    }

    let active = true;
    setProgramPlaybooksLoading(true);
    setProgramPlaybooksError(null);

    fetchProgramPlaybooks(supabase, programIds)
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setProgramPlaybooksError(result.error);
          setProgramPlaybooks(new Map());
          return;
        }

        const grouped = new Map<string, ProgramPlaybook>();
        for (const playbook of result.playbooks) {
          grouped.set(playbook.programId, playbook);
        }
        setProgramPlaybooks(grouped);
      })
      .catch((err) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Failed to load playbook resources.';
        setProgramPlaybooksError(message);
        setProgramPlaybooks(new Map());
      })
      .finally(() => {
        if (active) setProgramPlaybooksLoading(false);
      });

    return () => {
      active = false;
    };
  }, [supabase, user, savedStructures]);

  React.useEffect(() => {
    if (!supabase || !user) return;

    const programId = activePlaybookPosition?.programId;
    if (!programId || programPlaybooks.has(programId)) return;

    let active = true;
    setProgramPlaybooksLoading(true);
    setProgramPlaybooksError(null);

    fetchProgramPlaybooks(supabase, [programId])
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setProgramPlaybooksError(result.error);
          return;
        }

        setProgramPlaybooks((prev) => {
          const next = new Map(prev);
          for (const playbook of result.playbooks) {
            next.set(playbook.programId, playbook);
          }
          return next;
        });
      })
      .catch((err) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Failed to load playbook resources.';
        setProgramPlaybooksError(message);
      })
      .finally(() => {
        if (active) setProgramPlaybooksLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activePlaybookPosition?.programId, programPlaybooks, supabase, user]);

  const handleOpenPlaybookDrawer = React.useCallback((position: Position) => {
    setActivePlaybookPosition(position);
  }, []);

  const handleClosePlaybookDrawer = React.useCallback(() => {
    setActivePlaybookPosition(null);
  }, []);

  const buildPositionsFromTransactions = React.useCallback((rows: TxnRow[]): Position[] => {
    const byPos = new Map<string, TxnRow[]>();
    for (const r of rows) {
      if (!r.underlying || !r.expiry || r.strike == null || !r.optionType) continue;
      const ex = (r.exchange ?? 'deribit') as Exchange;
      const structureKey = String(r.structureId ?? 'auto');
      const key = `${ex}__${r.underlying}__${structureKey}`;
      if (!byPos.has(key)) byPos.set(key, []);
      byPos.get(key)!.push(r);
    }

    const out: Position[] = [];
    for (const [key, txns] of byPos.entries()) {
      const [exchange, underlying, structureId] = key.split("__");

      const uniqueExpiries = Array.from(new Set(txns.map((t) => t.expiry).filter(Boolean))) as string[];
      const sortedExpiries = [...uniqueExpiries].sort();
      const fallbackExpiry = txns[0]?.expiry ?? null;
      const primaryExpiry = sortedExpiries[0] ?? fallbackExpiry ?? '';

      const byLeg = new Map<string, TxnRow[]>();
      for (const t of txns) {
        const expiryKey = t.expiry ?? 'NO_EXPIRY';
        const lkey = `${expiryKey}__${t.strike}-${t.optionType}`;
        if (!byLeg.has(lkey)) byLeg.set(lkey, []);
        byLeg.get(lkey)!.push(t);
      }

      const legs: any[] = [];
      let earliestTimestamp: string | null = null;
      for (const [lkey, ltx] of byLeg.entries()) {
        const [legExpiryRaw, strikeOpt] = lkey.split("__");
        const [strikeStr, opt] = strikeOpt.split("-");
        const strike = Number(strikeStr);
        const legExpiry = legExpiryRaw === 'NO_EXPIRY' ? undefined : legExpiryRaw;
        const openLots: any[] = [];
        let realizedPnl = 0;
        let netPremium = 0;
        let qtyNet = 0;

        for (const tr of ltx) {
          const sign: 1 | -1 = tr.side === "buy" ? 1 : -1;
          const lot = { qty: Math.abs(tr.amount), price: tr.price, sign };
          netPremium += (sign === -1 ? +1 : -1) * (tr.price * Math.abs(tr.amount));
          if (tr.timestamp) {
            const currentEarliest = earliestTimestamp ? new Date(earliestTimestamp) : null;
            const candidate = new Date(tr.timestamp);
            if (!Number.isNaN(candidate.getTime())) {
              if (!currentEarliest || candidate.getTime() < currentEarliest.getTime()) {
                earliestTimestamp = tr.timestamp;
              }
            }
          }
          if (openLots.length === 0 || openLots[0].sign === sign) {
            openLots.push({ ...lot });
          } else {
            const { realized, remainder } = fifoMatchAndRealize(openLots as any, lot as any);
            realizedPnl += realized;
            if (remainder) openLots.push(remainder as any);
          }
          qtyNet += sign * Math.abs(tr.amount);
        }

        const legExchange = (ltx[0].exchange || exchange) as Exchange;
        legs.push({
          key: lkey,
          strike,
          optionType: opt as any,
          openLots,
          realizedPnl,
          netPremium,
          qtyNet,
          trades: ltx,
          exchange: legExchange,
          expiry: legExpiry,
        });
      }

      const legsCount = legs.length;
      const realizedPnl = legs.reduce((a: number, l: any) => a + l.realizedPnl, 0);
      const netPremiumSigned = legs.reduce((a: number, l: any) => a + l.netPremium, 0);
      const netPremium = Math.abs(netPremiumSigned);
      const pnlPct = calculatePnlPct(realizedPnl, legs, netPremium);
      const dte = primaryExpiry ? daysTo(primaryExpiry) : 0;
      const status = classifyStatus(dte, pnlPct, realizedPnl);

      const openSinceDays = earliestTimestamp ? daysSince(earliestTimestamp) : null;

      out.push({
        id: key,
        underlying,
        expiryISO: primaryExpiry,
        dte,
        legs,
        legsCount,
        type: legsCount > 1 ? "Multi-leg" : "Single",
        openSinceDays,
        strategy: undefined,
        realizedPnl,
        netPremium,
        pnlPct,
        status,
        greeks: { delta: null, gamma: null, theta: null, vega: null, rho: null },
        playbook: undefined,
        structureId,
        exchange: exchange as Exchange,
        source: 'local',
        closedAt: null,
        expiries: sortedExpiries,
        clientName: activeClientName,
      });
    }
    out.sort((a, b) => a.dte - b.dte);
    return out;
  }, [selectedClient]);

  const normalizedQuery = query.toLowerCase().trim();
  const isActiveLeg = React.useCallback((leg: Leg) => {
    const qtyNet = Number(leg.qtyNet);
    if (!Number.isFinite(qtyNet) || qtyNet === 0) return false;
    if (!leg.expiry) return true;
    const parsedExpiry = Date.parse(leg.expiry);
    if (!Number.isFinite(parsedExpiry)) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return parsedExpiry >= today.getTime();
  }, []);

  const savedStructureInstruments = React.useMemo(() => {
    const instruments = new Set<string>();
    for (const position of savedStructures) {
      for (const leg of position.legs ?? []) {
        if (!isActiveLeg(leg)) continue;
        for (const trade of leg.trades ?? []) {
          const instrument = String(trade.instrument ?? '').trim();
          if (instrument) instruments.add(instrument);
        }
      }
    }
    return Array.from(instruments).sort((a, b) => a.localeCompare(b));
  }, [savedStructures, isActiveLeg]);

  const instrumentSuggestions = React.useMemo(() => {
    if (!normalizedQuery) return [];
    return savedStructureInstruments
      .filter((instrument) => instrument.toLowerCase().includes(normalizedQuery))
      .slice(0, 8);
  }, [normalizedQuery, savedStructureInstruments]);

  const handleInstrumentSelection = React.useCallback((instrument: string) => {
    setQuery(instrument);
    setShowInstrumentSuggestions(false);
  }, []);

  const handleSearchKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return;
      if (instrumentSuggestions.length === 0) return;
      handleInstrumentSelection(instrumentSuggestions[0]);
    },
    [handleInstrumentSelection, instrumentSuggestions],
  );

  const getPositionInstruments = React.useCallback((p: Position) => {
    const instruments: string[] = [];
    for (const leg of p.legs ?? []) {
      if (!isActiveLeg(leg)) continue;
      for (const trade of leg.trades ?? []) {
        const instrument = String(trade.instrument ?? '').trim();
        if (instrument) instruments.push(instrument);
      }
    }
    return instruments;
  }, [isActiveLeg]);
  const matchesFilter = React.useCallback(
    (p: Position) => {
      if (alertsOnly && p.status === "OPEN") return false;
      if (!normalizedQuery) return true;

      const haystacks: string[] = [
        p.underlying,
        p.strategy ?? "",
        p.structureId ?? "",
        p.clientName ?? "",
        ...p.legs.map((l) => `${l.strike}${l.optionType}`),
        ...getPositionInstruments(p),
      ];

      return haystacks.some((candidate) => candidate.toLowerCase().includes(normalizedQuery));
    },
    [alertsOnly, getPositionInstruments, normalizedQuery],
  );

  const matchesClientSelection = React.useCallback(
    (p: Position) => {
      if (!selectedClient) return true;
      const name = (p.clientName ?? DEFAULT_CLIENT_NAME).trim() || DEFAULT_CLIENT_NAME;
      return name === selectedClient;
    },
    [selectedClient],
  );

  const filteredLive = React.useMemo(
    () => positions.filter(matchesClientSelection).filter(matchesFilter),
    [matchesClientSelection, matchesFilter, positions],
  );

  const filteredSaved = React.useMemo(
    () => savedStructures.filter(matchesClientSelection).filter(matchesFilter),
    [matchesClientSelection, matchesFilter, savedStructures],
  );

  const sortedSaved = React.useMemo(() => {
    const numericValue = (value: number | null | undefined) =>
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : savedSort.direction === 'asc'
        ? Number.POSITIVE_INFINITY
        : Number.NEGATIVE_INFINITY;
    const statusRank: Record<Position['status'], number> = {
      OPEN: 1,
      ATTENTION: 2,
      ALERT: 3,
      CLOSED: 4,
    };
    const withStats = filteredSaved.map((position) => {
      const posUnrealized = positionUnrealizedPnL(position, legMarks);
      const posTotalPnl = position.realizedPnl + posUnrealized;
      const legsPremium = position.legs?.reduce(
        (sum, leg) => sum + (Number.isFinite(leg.netPremium) ? leg.netPremium : 0),
        0,
      ) ?? 0;
      const premiumAbs = (() => {
        if (Number.isFinite(position.netPremium) && Math.abs(position.netPremium as number) > 0) {
          return Math.abs(position.netPremium as number);
        }
        if (Math.abs(legsPremium) > 0) return Math.abs(legsPremium);
        return 0;
      })();
      const pnlPct = calculatePnlPct(posTotalPnl, position.legs ?? [], premiumAbs);
      const greeks = positionGreeks(position, legMarks);
      const strategySummary = buildStructureSummaryLines(position);
      const programLabel = position.source === 'supabase' ? (position.programName ?? '').trim() : '';
      const strategyLabel = strategySummary
        ? [strategySummary.header, strategySummary.legs ?? ''].join(' ').trim()
        : (programLabel || position.strategy || '').trim();
      const playbookLabel = (position.playbook ?? position.programId ?? '').toString().trim();
      return { position, pnlPct, greeks, posTotalPnl, strategyLabel, playbookLabel, statusRank: statusRank[position.status] };
    });

    const directionFactor = savedSort.direction === 'asc' ? 1 : -1;

    return withStats
      .sort((a, b) => {
        const compareString = (left: string, right: string) =>
          directionFactor * left.localeCompare(right, undefined, { sensitivity: 'base' });
        switch (savedSort.key) {
          case 'status':
            return directionFactor * (a.statusRank - b.statusRank);
          case 'structure':
            return compareString(a.position.structureId ?? '', b.position.structureId ?? '');
          case 'dte':
            return directionFactor * (numericValue(a.position.dte) - numericValue(b.position.dte));
          case 'legs':
            return directionFactor * (numericValue(a.position.legsCount) - numericValue(b.position.legsCount));
          case 'strategy':
            return compareString(a.strategyLabel, b.strategyLabel);
          case 'pnl':
            return directionFactor * (numericValue(a.posTotalPnl) - numericValue(b.posTotalPnl));
          case 'pnlpct':
            return directionFactor * (numericValue(a.pnlPct) - numericValue(b.pnlPct));
          case 'delta':
            return directionFactor * (numericValue(a.greeks.delta) - numericValue(b.greeks.delta));
          case 'gamma':
            return directionFactor * (numericValue(a.greeks.gamma) - numericValue(b.greeks.gamma));
          case 'theta':
            return directionFactor * (numericValue(a.greeks.theta) - numericValue(b.greeks.theta));
          case 'vega':
            return directionFactor * (numericValue(a.greeks.vega) - numericValue(b.greeks.vega));
          case 'rho':
            return directionFactor * (numericValue(a.greeks.rho) - numericValue(b.greeks.rho));
          case 'playbook':
            return compareString(a.playbookLabel, b.playbookLabel);
          default:
            return 0;
        }
      })
      .map(({ position }) => position);
  }, [filteredSaved, legMarks, savedSort.direction, savedSort.key]);

  const sortedExchangePositions = React.useMemo(() => {
    const fallback = Number.MAX_SAFE_INTEGER;
    return [...exchangePositions].sort((a, b) => {
      const aTime = a.expiryISO ? new Date(a.expiryISO).getTime() : fallback;
      const bTime = b.expiryISO ? new Date(b.expiryISO).getTime() : fallback;
      if (aTime !== bTime) return aTime - bTime;
      return a.instrument.localeCompare(b.instrument);
    });
  }, [exchangePositions]);

  const exchangePositionGroups = React.useMemo(() => {
    const groups: { label: string; positions: ExchangePositionSnapshot[] }[] = [];
    for (const position of sortedExchangePositions) {
      const label = position.expiryISO ?? 'No expiry date';
      const current = groups[groups.length - 1];
      if (!current || current.label !== label) {
        groups.push({ label, positions: [position] });
      } else {
        current.positions.push(position);
      }
    }
    return groups;
  }, [sortedExchangePositions]);

  const formatQuantity = React.useCallback((value: number | null) => {
    if (value === null) return '—';
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }, []);

  const formatPrice = React.useCallback((value: number | null) => {
    if (value === null) return '—';
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, []);

  const formatSpotPrice = React.useCallback((value: number | null) => {
    if (value === null) return '—';
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }, []);

  const fetchBtcSpot = React.useCallback(async () => {
    try {
      const ticker = await dbGetTicker('BTC-PERPETUAL');
      const nextPrice = ticker?.index_price ?? ticker?.mark_price ?? ticker?.last_price ?? null;
      if (nextPrice !== null && Number.isFinite(nextPrice)) {
        setBtcSpot(nextPrice);
        setBtcSpotUpdatedAt(new Date());
      }
    } catch (error) {
      console.error('[btc spot] fetch failed', error);
    }
  }, []);

  const savedStructureGroups = React.useMemo(
    () =>
      sortedSaved.reduce(
        (acc, position) => {
          if (position.status === 'CLOSED') {
            acc.closed.push(position);
          } else {
            acc.open.push(position);
          }
          return acc;
        },
        { open: [] as Position[], closed: [] as Position[] },
      ),
    [sortedSaved],
  );

  const savedStructureColSpan = React.useMemo(() => visibleCols.length + 2, [visibleCols.length]);
  const livePositionColSpan = React.useMemo(() => visibleCols.length + 2, [visibleCols.length]);

  const portfolioGreeks = React.useMemo(() => {
    const totals: Record<GreekKey, number> = {
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    };
    const hasValues: Record<GreekKey, boolean> = {
      delta: false,
      gamma: false,
      theta: false,
      vega: false,
      rho: false,
    };

    for (const position of filteredSaved) {
      for (const leg of position.legs) {
        const ref = getLegMarkRef(position, leg);
        if (!ref) continue;
        const mark = legMarks[ref.key];
        if (!mark) continue;

        const greeks = mark.greeks || {};
        const multiplier = ref.exchange === 'coincall' ? mark.multiplier : ref.defaultMultiplier;

        for (const field of GREEK_SUMMARY_FIELDS) {
          const perContract = greeks[field.key];
          if (typeof perContract !== 'number' || !Number.isFinite(perContract)) continue;
          totals[field.key] += legGreekExposure(leg, perContract, multiplier);
          hasValues[field.key] = true;
        }
      }
    }

    return { totals, hasValues };
  }, [filteredSaved, legMarks]);

  const noopUpdate = React.useCallback((_id: string, _updates: Partial<Position>) => {
    // Saved structures are read-only in the UI.
  }, []);

  const positionsForMarks = React.useMemo(
    () => [...filteredSaved, ...positions],
    [filteredSaved, positions],
  );

  const positionsForLinking = positionsForMarks;

  const livePositionGroups = React.useMemo(() => {
    const groups: { label: string; positions: Position[] }[] = [];
    for (const position of filteredLive) {
      const label = position.expiryISO ? position.expiryISO : 'No expiry date';
      const current = groups[groups.length - 1];
      if (!current || current.label !== label) {
        groups.push({ label, positions: [position] });
      } else {
        current.positions.push(position);
      }
    }
    return groups;
  }, [filteredLive]);

  const activeProgramPlaybook = React.useMemo(() => {
    const programId = activePlaybookPosition?.programId;
    if (!programId) return null as ProgramPlaybook | null;
    return programPlaybooks.get(programId) ?? null;
  }, [activePlaybookPosition?.programId, programPlaybooks]);

  const selectableStructureOptions = React.useMemo<ReviewStructureOption[]>(() => {
    if (!savedStructures.length) return [];
    const normalizedClient = (activeClientName ?? DEFAULT_CLIENT_NAME).trim() || DEFAULT_CLIENT_NAME;

    const labelForStructure = (structure: Position) => {
      const structureCode = structure.structureId ?? structure.id;
      const summary = buildStructureChipSummary(structure) ?? 'Structure details unavailable';
      return `[${structureCode}] / ${summary}`;
    };

    return savedStructures
      .filter((structure) => {
        const structureClient = (structure.clientName ?? DEFAULT_CLIENT_NAME).trim() || DEFAULT_CLIENT_NAME;
        if (structureClient !== normalizedClient) return false;
        const isArchived = Boolean(structure.archived || structure.archivedAt);
        if (isArchived) return false;
        return true;
      })
      .map((structure) => {
        const legInstrumentKeys = structure.legs
          .map((leg) =>
            leg.expiry
              ? formatInstrumentLabel(structure.underlying, leg.expiry, leg.strike, leg.optionType)
              : null,
          )
          .filter((key): key is string => Boolean(key));
        return {
          value: structure.id,
          label: labelForStructure(structure),
          legInstrumentKeys,
        };
      });
  }, [activeClientName, savedStructures]);

  const tableHead = (
    <thead className="bg-slate-50 text-slate-600">
      <tr>
        <th className="p-3 text-left w-10"> </th>
        {visibleCols.includes("status") && <th className="p-3 text-left">Status</th>}
        {visibleCols.includes("structure") && <th className="p-3 text-left">Structure</th>}
        {visibleCols.includes("dte") && <th className="p-3 text-left">DTE/Since</th>}
        {visibleCols.includes("legs") && <th className="p-3 text-left">Legs</th>}
        {visibleCols.includes("strategy") && <th className="p-3 text-left">Strategy</th>}
        {visibleCols.includes("pnl") && <th className="p-3 text-left">PnL</th>}
        {visibleCols.includes("pnlpct") && <th className="p-3 text-left">PnL %</th>}
        {visibleCols.includes("delta") && (
          <th className="p-3 text-left">
            <abbr title="Delta" className="cursor-help">Δ</abbr>
          </th>
        )}
        {visibleCols.includes("gamma") && (
          <th className="p-3 text-left">
            <abbr title="Gamma" className="cursor-help">Γ</abbr>
          </th>
        )}
        {visibleCols.includes("theta") && (
          <th className="p-3 text-left">
            <abbr title="Theta" className="cursor-help">Θ</abbr>
          </th>
        )}
        {visibleCols.includes("vega") && (
          <th className="p-3 text-left">
            <abbr title="Vega" className="cursor-help">V</abbr>
          </th>
        )}
        {visibleCols.includes("rho") && (
          <th className="p-3 text-left">
            <abbr title="Rho" className="cursor-help">ρ</abbr>
          </th>
        )}
        {visibleCols.includes("playbook") && <th className="p-3 text-left">Playbook</th>}
        <th className="p-3 text-right w-12">
          <span className="sr-only">Save position</span>
        </th>
      </tr>
    </thead>
  );

  const renderSavedSortHeader = (label: string, key: SavedSortKey) => {
    const isAsc = savedSort.key === key && savedSort.direction === 'asc';
    const isDesc = savedSort.key === key && savedSort.direction === 'desc';
    return (
      <div className="inline-flex items-center gap-2">
        <span>{label}</span>
        <span className="inline-flex flex-col -space-y-1">
          <button
            type="button"
            className={`text-[10px] leading-none ${isAsc ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
            aria-label={`Sort ${label} ascending`}
            onClick={() => setSavedSort({ key, direction: 'asc' })}
          >
            ▲
          </button>
          <button
            type="button"
            className={`text-[10px] leading-none ${isDesc ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
            aria-label={`Sort ${label} descending`}
            onClick={() => setSavedSort({ key, direction: 'desc' })}
          >
            ▼
          </button>
        </span>
      </div>
    );
  };

  const savedTableHead = (
    <thead className="bg-slate-50 text-slate-600">
      <tr>
        <th className="p-3 text-left w-10"> </th>
        {visibleCols.includes("status") && <th className="p-3 text-left">{renderSavedSortHeader('Status', 'status')}</th>}
        {visibleCols.includes("structure") && <th className="p-3 text-left">{renderSavedSortHeader('Structure', 'structure')}</th>}
        {visibleCols.includes("dte") && <th className="p-3 text-left">{renderSavedSortHeader('DTE/Since', 'dte')}</th>}
        {visibleCols.includes("legs") && <th className="p-3 text-left">{renderSavedSortHeader('Legs', 'legs')}</th>}
        {visibleCols.includes("strategy") && <th className="p-3 text-left">{renderSavedSortHeader('Strategy', 'strategy')}</th>}
        {visibleCols.includes("pnl") && <th className="p-3 text-left">{renderSavedSortHeader('PnL', 'pnl')}</th>}
        {visibleCols.includes("pnlpct") && <th className="p-3 text-left">{renderSavedSortHeader('PnL %', 'pnlpct')}</th>}
        {visibleCols.includes("delta") && (
          <th className="p-3 text-left">
            {renderSavedSortHeader('Δ', 'delta')}
          </th>
        )}
        {visibleCols.includes("gamma") && (
          <th className="p-3 text-left">
            {renderSavedSortHeader('Γ', 'gamma')}
          </th>
        )}
        {visibleCols.includes("theta") && (
          <th className="p-3 text-left">
            {renderSavedSortHeader('Θ', 'theta')}
          </th>
        )}
        {visibleCols.includes("vega") && (
          <th className="p-3 text-left">
            {renderSavedSortHeader('V', 'vega')}
          </th>
        )}
        {visibleCols.includes("rho") && (
          <th className="p-3 text-left">
            {renderSavedSortHeader('ρ', 'rho')}
          </th>
        )}
        {visibleCols.includes("playbook") && <th className="p-3 text-left">{renderSavedSortHeader('Playbook', 'playbook')}</th>}
        <th className="p-3 text-right w-12">
          <span className="sr-only">Save position</span>
        </th>
      </tr>
    </thead>
  );

  const updatePosition = React.useCallback((id: string, updates: Partial<Position>) => {
    setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, [setPositions]);

  function ColumnPicker() {
    const all = [
      { key: "status", label: "Status" },
      { key: "structure", label: "Structure" },
      { key: "dte", label: "DTE/Since" },
      { key: "legs", label: "Legs" },
      { key: "strategy", label: "Strategy" },
      { key: "pnl", label: "PnL $" },
      { key: "pnlpct", label: "PnL %" },
      { key: "delta", label: "Δ" },
      { key: "gamma", label: "Γ" },
      { key: "theta", label: "Θ" },
      { key: "vega", label: "V" },
      { key: "rho", label: "ρ" },
      { key: "playbook", label: "Playbook" },
    ];
    return (
      <details className="ml-auto">
        <summary className="text-sm text-slate-600 cursor-pointer select-none">Columns</summary>
        <div className="absolute mt-2 bg-white border rounded-xl shadow p-3 z-10">
          {all.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm py-1">
              <input
                type="checkbox"
                checked={visibleCols.includes(c.key)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setVisibleCols((prev) => checked ? [...prev, c.key] : prev.filter((k) => k !== c.key));
                }}
              />
              {c.label}
            </label>
          ))}
        </div>
      </details>
    );
  }

  const fetchAllMarksForPositions = React.useCallback(async (ps: Position[]) => {
    setMarkFetch({ inProgress: true, total: 0, done: 0, errors: 0 });
    await fetchBtcSpot();

    type FetchEntry = {
      key: string;
      fetcher: () => Promise<{ price: number | null; multiplier: number | null; greeks?: any }>;
    };

    const entries: FetchEntry[] = [];
    const seen = new Set<string>();

    for (const position of ps) {
      for (const leg of position.legs) {
        const ref = getLegMarkRef(position, leg);
        if (!ref) continue;

        if (seen.has(ref.key)) continue;
        seen.add(ref.key);

        if (ref.exchange === 'coincall') {
          entries.push({ key: ref.key, fetcher: () => ccGetBest(ref.symbol) });
        } else if (ref.exchange === 'deribit') {
          entries.push({ key: ref.key, fetcher: () => dbGetBest(ref.symbol) });
        }
      }
    }

    setMarkFetch(prev => ({ ...prev, total: entries.length }));
    if (entries.length === 0) {
      setMarkFetch(prev => ({ ...prev, inProgress: false }));
      return;
    }

    const MAX = 5; // throttle concurrency
    const results: Record<string, { price: number | null; multiplier: number | null; greeks?: any }> = {};

    for (let i = 0; i < entries.length; i += MAX) {
      const slice = entries.slice(i, i + MAX);
      const vals = await Promise.all(
        slice.map(async ({ key, fetcher }) => {
          try {
            const value = await fetcher();
            return { key, value, ok: true as const };
          } catch (e) {
            console.error('[marks] fetch failed for', key, e);
            return { key, value: { price: null, multiplier: null }, ok: false as const };
          }
        })
      );

      let errs = 0;
      for (const { key, value, ok } of vals) {
        results[key] = value;
        if (!ok) errs++;
      }

      setMarkFetch(prev => ({
        ...prev,
        done: Math.min(prev.done + slice.length, prev.total),
        errors: prev.errors + errs,
      }));
    }

    if (Object.keys(results).length) {
      setLegMarks(prev => ({ ...prev, ...results }));
    }

    setMarkFetch(prev => ({ ...prev, inProgress: false }));
  }, [fetchBtcSpot, setLegMarks, setMarkFetch]);

  function Spinner({ className = "h-4 w-4" }: { className?: string }) {
    return (
      <svg className={`animate-spin ${className} text-slate-600`} viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10"
                stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    );
  }

  const handleSignOut = React.useCallback(() => {
    if (!supabase) return;
    void supabase.auth.signOut();
  }, [supabase]);

  if (!supabaseConfigured || !supabase) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">
          <p className="text-base font-semibold text-slate-700">Supabase configuration required</p>
          <p>
            Set <code className="rounded bg-slate-100 px-1 py-0.5">VITE_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5">VITE_SUPABASE_PUBLISHABLE_KEY</code> to enable
            authentication and program lookups.
          </p>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">
          <p className="text-base font-semibold text-slate-700">Checking Supabase session…</p>
          <p>Hold tight while we verify your saved Supabase credentials.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-slate-950">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
          <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-500/30 blur-3xl" />
          <div className="absolute bottom-[-120px] right-[-80px] h-[520px] w-[520px] rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="absolute -bottom-32 left-[-60px] h-80 w-80 rounded-full bg-emerald-500/20 blur-3xl" />
        </div>

        <div className="absolute inset-0 bg-slate-950/50 backdrop-blur">
          <div className="absolute inset-x-6 top-28 hidden gap-6 opacity-60 lg:flex">
            <div className="flex flex-1 flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 text-left text-xs text-slate-200/80">
              <div className="h-3 w-32 rounded-full bg-white/20" />
              <div className="grid grid-cols-2 gap-3">
                <div className="h-24 rounded-2xl border border-white/5 bg-slate-900/40" />
                <div className="h-24 rounded-2xl border border-white/5 bg-slate-900/40" />
                <div className="h-24 rounded-2xl border border-white/5 bg-slate-900/40" />
                <div className="h-24 rounded-2xl border border-white/5 bg-slate-900/40" />
              </div>
              <div className="h-3 w-20 rounded-full bg-white/20" />
            </div>
            <div className="hidden w-64 flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 text-xs text-slate-200/80 xl:flex">
              <div className="h-3 w-24 rounded-full bg-white/20" />
              <div className="space-y-3">
                <div className="h-10 rounded-2xl border border-white/5 bg-slate-900/40" />
                <div className="h-10 rounded-2xl border border-white/5 bg-slate-900/40" />
                <div className="h-10 rounded-2xl border border-white/5 bg-slate-900/40" />
                <div className="h-10 rounded-2xl border border-white/5 bg-slate-900/40" />
              </div>
              <div className="h-3 w-14 rounded-full bg-white/20" />
            </div>
          </div>
        </div>

        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center text-slate-200">
          <div className="max-w-xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-400">Authentication required</p>
            <h1 className="text-3xl font-semibold tracking-tight">Sign in to continue</h1>
            <p className="text-sm text-slate-400">
              Unlock program lookups, structure imports, and live mark fetching with your workspace credentials.
            </p>
          </div>
          <SupabaseLogin />
          <p className="text-xs text-slate-500">Access is limited to authorized trading workspaces.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-6 py-4 flex items-center gap-4 border-b bg-white sticky top-0 z-30">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-slate-900 text-white font-bold">⚡️</span>
        <h1 className="text-xl font-semibold">Open Options Trades</h1>
        <span className="text-xs text-slate-500 border rounded-lg px-2 py-1 ml-2">Demo • Frontend Only</span>
        <div
          className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600"
          title={btcSpotUpdatedAt ? `BTC spot as of ${btcSpotUpdatedAt.toLocaleTimeString()}` : 'BTC spot updates with Get Live Marks'}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">BTC Spot</span>
          <span className="font-semibold text-slate-900">
            {btcSpot === null ? '—' : `$${formatSpotPrice(btcSpot)}`}
          </span>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Client</span>
            <select
              className="bg-transparent text-sm font-semibold text-slate-900 focus:outline-none"
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              disabled={!isAdmin}
            >
              {clientOptions.map((client) => (
                <option key={client} value={client}>
                  {client}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleAddClient}
            className={`rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold transition ${
              isAdmin
                ? 'text-slate-600 hover:bg-slate-100'
                : 'text-slate-400 cursor-not-allowed bg-slate-50'
            }`}
            disabled={!isAdmin}
            title={isAdmin ? undefined : 'Client creation is limited to admin users'}
          >
            + New
          </button>
          {!isAdmin ? (
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Locked
            </span>
          ) : null}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <span>Alerts only</span>
            <Toggle checked={alertsOnly} onChange={setAlertsOnly} />
          </div>
          <button className="rounded-xl bg-slate-900 text-white px-3 py-2 text-sm shadow">Add Trade</button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
            <span className="font-medium text-slate-700">{user.email ?? 'Signed in'}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-xs font-semibold text-slate-500 transition hover:text-slate-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1 max-w-xl">
          <input
            className="w-full border rounded-2xl pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900"
            placeholder="Search symbol, strategy, strike…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowInstrumentSuggestions(true);
            }}
            onFocus={() => setShowInstrumentSuggestions(true)}
            onBlur={() => setShowInstrumentSuggestions(false)}
            onKeyDown={handleSearchKeyDown}
          />
          <span className="absolute left-3 top-2.5 text-slate-400">🔎</span>
          {showInstrumentSuggestions && instrumentSuggestions.length > 0 ? (
            <div className="absolute left-0 right-0 z-20 mt-2 rounded-2xl border border-slate-200 bg-white shadow-lg">
              <ul className="max-h-56 overflow-y-auto py-2 text-sm text-slate-700">
                {instrumentSuggestions.map((instrument) => (
                  <li key={instrument}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-slate-100"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleInstrumentSelection(instrument)}
                    >
                      <span className="font-medium text-slate-800">{instrument}</span>
                      <span className="text-xs text-slate-400">Instrument</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3 relative">
          <ColumnPicker />
          {onOpenPlaybookIndex ? (
            <button
              type="button"
              onClick={onOpenPlaybookIndex}
              className="rounded-xl border px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
            >
              Playbook Library
            </button>
          ) : null}
          <button
            className="rounded-xl border px-3 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-60"
            onClick={refreshSavedStructures}
            disabled={savedStructuresLoading || !supabase || !user}
            title="Manually refresh saved structures from Supabase"
          >
            {savedStructuresLoading ? (
              <>
                <Spinner className="h-3.5 w-3.5" />
                <span>Fetching…</span>
              </>
            ) : (
              <>Fetch</>
            )}
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-60"
            onClick={() => fetchAllMarksForPositions(positionsForMarks)}
            disabled={markFetch.inProgress}
            title="Fetch current mark/greeks for all visible legs (Coincall & Deribit)"
          >
            {markFetch.inProgress ? (
              <>
                <Spinner />
                <span>Fetching {markFetch.done}/{markFetch.total}</span>
              </>
            ) : (
              <>Get Live Marks</>
            )}
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-60"
            onClick={() => {
              setBackfillStatus({ type: 'idle' });
              setShowImportedOverlay(true);
            }}
            disabled={!supabase || !user}
            title="Review imported and unprocessed transactions"
          >
            Imported Transactions
          </button>
          <button
            onClick={() => { setPositions([]); setRawRows([]); }}
            className="text-sm text-slate-600 underline"
          >Clear {selectedClient} data</button>
        </div>
      </div>
      {/* Progress bar sits directly under the toolbar */}
      {markFetch.inProgress && (
        <div className="mt-2">
          <div className="h-1 bg-slate-200 rounded">
            <div
              className="h-1 bg-slate-900 rounded transition-all"
              style={{
                width: markFetch.total
                  ? `${Math.round((markFetch.done / markFetch.total) * 100)}%`
                  : "10%",
              }}
            />
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Fetched {markFetch.done}/{markFetch.total}
            {markFetch.errors ? <> • errors {markFetch.errors}</> : null}
          </div>
        </div>
      )}

      <div className="px-6 pt-3">
        <div className="bg-white rounded-2xl shadow border overflow-hidden">
          <div className="flex flex-col gap-1 px-4 py-3 border-b text-sm font-medium text-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <span>Portfolio Greeks</span>
            <span className="text-xs font-normal text-slate-500">Based on saved structures</span>
          </div>
          <div className="overflow-x-auto">
            <div className="flex min-w-[520px] divide-x divide-slate-100">
              {GREEK_SUMMARY_FIELDS.map(({ key, label, symbol }) => {
                const valueText = portfolioGreeks.hasValues[key]
                  ? fmtGreek(portfolioGreeks.totals[key])
                  : '—';
                return (
                  <div key={key} className="flex-1 px-4 py-4 text-center">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center justify-center gap-1">
                      <span className="text-sm text-slate-700">{symbol}</span>
                      {label}
                    </div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{valueText}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-3">
        <details className="bg-white rounded-2xl shadow border overflow-hidden">
          <summary className="flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 cursor-pointer select-none">
            <span>Exchange Positions</span>
            <span className="text-xs font-normal text-slate-500">
              {exchangePositions.length ? `${exchangePositions.length} loaded` : 'No positions loaded'}
            </span>
          </summary>
          <div className="border-t">
            <div className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-slate-500">
                Upload current positions from Coincall or Deribit CSV exports.
              </span>
              <button
                className="rounded-xl border px-3 py-2 text-sm inline-flex items-center gap-2"
                onClick={() => positionUploadRef.current?.click()}
              >
                Upload CSV
              </button>
              <input
                ref={positionUploadRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files && handlePositionFiles(e.target.files)}
              />
            </div>
            {sortedExchangePositions.length === 0 ? (
              <div className="px-4 pb-4 text-sm text-slate-500">
                No exchange positions available yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500 border-t border-slate-100">
                    <tr className="text-left">
                      <th className="p-3">Exchange</th>
                      <th className="p-3">Instrument</th>
                      <th className="p-3">Expiry</th>
                      <th className="p-3">Size</th>
                      <th className="p-3">Side</th>
                      <th className="p-3">Avg Price</th>
                      <th className="p-3">Mark Price</th>
                      <th className="p-3">Index Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exchangePositionGroups.map((group) => (
                      <React.Fragment key={group.label}>
                        <tr className="bg-slate-100/80 border-t border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <td colSpan={8} className="px-3 py-2 text-left">
                            <div className="flex items-center gap-3">
                              <span>Expiry date: {group.label}</span>
                              <span className="h-px flex-1 bg-slate-300" aria-hidden />
                            </div>
                          </td>
                        </tr>
                        {group.positions.map((position) => {
                          const sideLower = position.side.toLowerCase();
                          const sideClass = sideLower === 'buy'
                            ? 'text-emerald-600'
                            : sideLower === 'sell'
                            ? 'text-rose-600'
                            : 'text-slate-600';
                          return (
                            <tr key={position.id} className="border-t border-slate-100">
                              <td className="p-3 text-xs font-semibold uppercase text-slate-500">{position.exchange}</td>
                              <td className="p-3 font-medium text-slate-800">{position.instrument}</td>
                              <td className="p-3 text-slate-700">{position.expiryISO ?? '—'}</td>
                              <td className="p-3 text-slate-700">{formatQuantity(position.size)}</td>
                              <td className={`p-3 font-semibold ${sideClass}`}>{position.side}</td>
                              <td className="p-3 text-slate-700">{formatPrice(position.avgPrice)}</td>
                              <td className="p-3 text-slate-700">{formatPrice(position.markPrice)}</td>
                              <td className="p-3 text-slate-700">{formatPrice(position.indexPrice)}</td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      </div>

      <div className="px-6 py-3">
        <div className="bg-white rounded-2xl shadow border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b text-sm font-medium text-slate-700">
            <span>Saved Structures</span>
            {savedStructuresLoading ? (
              <span className="text-xs text-slate-500">Refreshing…</span>
            ) : null}
          </div>
          {savedStructuresError ? (
            <div className="px-4 py-3 text-sm text-rose-600">{savedStructuresError}</div>
          ) : null}
          {programPlaybooksError ? (
            <div className="px-4 py-3 text-sm text-amber-700 bg-amber-50 border-t border-amber-200">
              {programPlaybooksError}
            </div>
          ) : null}
          {filteredSaved.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500">
              {savedStructures.length > 0
                ? 'No saved structures match your filters.'
                : savedStructuresLoading
                ? 'Loading saved structures…'
                : 'No saved structures yet. Use the save action on a live position to create one.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                {savedTableHead}
                <tbody>
                  {savedStructureGroups.open.map((p) => (
                    <PositionRow
                      key={`saved-${p.id}`}
                      p={p}
                      onUpdate={noopUpdate}
                      visibleCols={visibleCols}
                      marks={legMarks}
                      markLoading={markFetch.inProgress}
                      allPositions={positionsForLinking}
                      readOnly
                      disableSave
                      onArchive={handleArchiveStructure}
                      archiving={Boolean(archiving[p.id])}
                      clientScope={overlayClientScope}
                      onPlaybookOpen={handleOpenPlaybookDrawer}
                    />
                  ))}
                  {savedStructureGroups.closed.length ? (
                    <tr className="bg-slate-100/80 border-y border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <td colSpan={savedStructureColSpan} className="px-3 py-2 text-left">
                        <div className="flex items-center gap-3">
                          <span>Closed structures</span>
                          <span className="h-px flex-1 bg-slate-300" aria-hidden />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {savedStructureGroups.closed.map((p) => (
                    <PositionRow
                      key={`saved-${p.id}`}
                      p={p}
                      onUpdate={noopUpdate}
                      visibleCols={visibleCols}
                      marks={legMarks}
                      markLoading={markFetch.inProgress}
                      allPositions={positionsForLinking}
                      readOnly
                      disableSave
                      onArchive={handleArchiveStructure}
                      archiving={Boolean(archiving[p.id])}
                      clientScope={overlayClientScope}
                      onPlaybookOpen={handleOpenPlaybookDrawer}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {positions.length === 0 && (
        <div className="px-6 pb-6">
          <UploadBox onFiles={handleFiles} />
          <p className="text-xs text-slate-500 mt-3">Tip: You can re-open the Column Picker later to adjust visible columns.</p>
        </div>
      )}

      {positions.length > 0 && (
        <div className="px-6 py-3">
          <div className="bg-white rounded-2xl shadow border overflow-hidden">
            <div className="px-4 py-3 border-b text-sm font-medium text-slate-700">Live Positions</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                {tableHead}
                <tbody>
                  {filteredLive.length === 0 ? (
                    <tr>
                      <td colSpan={livePositionColSpan} className="p-4 text-sm text-slate-500">
                        No live positions match your filters.
                      </td>
                    </tr>
                  ) : null}
                  {livePositionGroups.map((group) => (
                    <React.Fragment key={group.label}>
                      <tr className="bg-slate-100/80 border-y border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <td colSpan={livePositionColSpan} className="px-3 py-2 text-left">
                          <div className="flex items-center gap-3">
                            <span>Expiry date: {group.label}</span>
                            <span className="h-px flex-1 bg-slate-300" aria-hidden />
                          </div>
                        </td>
                      </tr>
                      {group.positions.map((p) => (
                        <PositionRow
                          key={p.id}
                          p={p}
                          onUpdate={updatePosition}
                          visibleCols={visibleCols}
                          marks={legMarks}
                          markLoading={markFetch.inProgress}
                          allPositions={positionsForLinking}
                          onSaved={refreshSavedStructures}
                          clientScope={overlayClientScope}
                        />
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <PlaybookDrawer
        open={Boolean(activePlaybookPosition)}
        onClose={handleClosePlaybookDrawer}
        position={activePlaybookPosition}
        playbook={activeProgramPlaybook}
        loading={programPlaybooksLoading}
        error={programPlaybooksError}
      />

      <ImportedTransactionsOverlay
        open={showImportedOverlay}
        rows={importedRows}
        loading={importedLoading}
        error={importedError}
        backfillStatus={backfillStatus}
        onClose={() => {
          setShowImportedOverlay(false);
          setBackfillStatus({ type: 'idle' });
        }}
        onRefresh={loadImportedTransactions}
        onBackfill={() => backfillUploadRef.current?.click()}
      />
      <input
        ref={backfillUploadRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => e.target.files && handleBackfillFiles(e.target.files)}
      />

      {showReview && (
        <ReviewOverlay
          rows={showReview.rows}
          excludedRows={showReview.excludedRows}
          duplicateTradeIds={showReview.duplicateTradeIds}
          duplicateOrderIds={showReview.duplicateOrderIds}
          importHistorical={showReview.importHistorical}
          allowAllocations={showReview.allowAllocations}
          onConfirm={finalizeImport}
          onCancel={() => setShowReview(null)}
          availableStructures={selectableStructureOptions}
        />
      )}

      {showMapper && (
        <ColumnMapper
          headers={showMapper.headers}
          mode={showMapper.mode}
          onConfirm={(mapping) => {
            if (showMapper.mode === 'backfill') {
              return startBackfill(mapping);
            }
            return startImport(mapping);
          }}
          onCancel={() => setShowMapper(null)}
        />
      )}
    </div>
  );
}
