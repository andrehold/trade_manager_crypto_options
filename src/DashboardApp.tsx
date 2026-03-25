import React from 'react'
import Papa from 'papaparse'
import { Toggle } from './components/Toggle'
import { Sidebar } from './components/Sidebar'
import { setAssignLegsContext } from './features/assignLegs/assignLegsStore'
import { setColumnMapperContext } from './features/mapCSV/columnMapperStore'
import { ReviewOverlay, type ReviewStructureOption } from './components/ReviewOverlay'
import { ImportedTransactionsOverlay } from './components/ImportedTransactionsOverlay'
import { SupabaseLogin } from './features/auth/SupabaseLogin'
import { useAuth } from './features/auth/useAuth'
import { tryGetSupabaseClient } from './lib/supabase'
import {
  Position, TxnRow, Lot, Leg, MarksMap,
  useLocalStorage, devQuickTests,
  parseActionSide, toNumber, parseInstrumentByExchange, normalizeSecond,
  daysTo, daysSince, fifoMatchAndRealize, classifyStatus, calculatePnlPct,
  Exchange, getLegMarkRef, fmtGreek, legGreekExposure, toDeribitInstrument,
  positionGreeks, positionUnrealizedPnL, formatInstrumentLabel, legUnrealizedPnL, fmtPremium
} from './utils'
import { PositionRow } from './components/PositionRow'
import { PlaybookDrawer } from './components/PlaybookDrawer'
import { dbGetTicker, dbGetInstruments } from './lib/venues/deribit'
import { fetchDeribitMarks } from './lib/venues/fetchLiveMarks'
import { DashboardHeader } from './components/DashboardHeader'
import { ExpiryDatePicker } from './components/ExpiryDatePicker'
import { ViewSelector, type ActiveView } from './components/ViewSelector'
import { KanbanBoard } from './components/KanbanBoard'
import { GanttTimeline } from './components/GanttTimeline'
import { Spinner } from './components/Spinner'
import { ColumnPicker } from './components/ColumnPicker'
import { PositionTableHead } from './components/PositionTableHead'
import { SortHeader } from './components/SortHeader'
import { RefreshCw, TrendingUp, Upload, GanttChart, Inbox } from 'lucide-react'
import { Button } from './components/ui'
import {
  archiveStructure,
  fetchSavedStructures,
  appendTradesToStructure,
  createStructure,
  backfillLegExpiries,
  saveTransactionLogs,
  saveUnprocessedTrades,
  buildStructureChipSummary,
  buildStructureSummaryLines,
  fetchProgramPlaybooks,
  filterDuplicateRows,
  fetchUnprocessedImports,
  fetchPrograms,
  type ProgramPlaybook,
  type ProgramOption,
} from './lib/positions'
import { StructureDetailsOverlay, type StructureSummary, type StructureMetadata, type StrategyOption } from './components/StructureDetailsOverlay'
import { resolveClientAccess } from './features/auth/access'
import {
  deriveSyntheticDeliveryTradeId,
  extractIdentifier,
  sanitizeIdentifier,
} from './lib/positions/identifiers'
import { MapCSVPage } from './features/mapCSV/MapCSVPage'
import { AssignLegsPage } from './features/assignLegs/AssignLegsPage'
import { PlaybookIndexPage } from './features/playbooks/PlaybookIndexPage'
import { StrategyPlaybookPage } from './features/playbooks/StrategyPlaybookPage'
import { StructureDetailPage } from './features/structureDetail/StructureDetailPage'

export type InnerView =
  | 'mapCSV'
  | 'assignLegs'
  | 'playbookIndex'
  | { type: 'playbookDetail'; slug: string }
  | { type: 'structureDetail'; id: string }

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

type OpenInstrumentSortKey =
  | 'instrument'
  | 'qtyNet'
  | 'absPnl'
  | 'delta'
  | 'gamma'
  | 'theta'
  | 'vega'
  | 'rho'

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
  onOpenPlaybook?: (slug: string) => void
  onOpenAssignLegs?: () => void
  onOpenMapCSV?: () => void
  onOpenStructureDetail?: (id: string) => void
  onNavigateDashboard?: () => void
  innerView?: InnerView
}

export default function DashboardApp({ onOpenPlaybookIndex, onOpenPlaybook, onOpenAssignLegs, onOpenMapCSV, onOpenStructureDetail, onNavigateDashboard, innerView }: DashboardAppProps = {}) {
  React.useEffect(() => { devQuickTests(); }, []);

  // Tracks which sub-step of the mapCSV flow is active (upload zone vs column mapping)
  const [mapCsvStep, setMapCsvStep] = React.useState<'upload' | 'mapping'>('upload');
  React.useEffect(() => {
    if (innerView !== 'mapCSV') setMapCsvStep('upload');
  }, [innerView]);

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
  const [pendingImport, setPendingImport] = React.useState<{
    localRowGroups: Map<string, TxnRow[]>
    linkedRows: TxnRow[]
    unprocessedRows: TxnRow[]
  } | null>(null);
  const [pendingProgramOptions, setPendingProgramOptions] = React.useState<ProgramOption[]>([]);
  const [pendingProgramsLoading, setPendingProgramsLoading] = React.useState(false);
  const [pendingStrategyOptions, setPendingStrategyOptions] = React.useState<StrategyOption[]>([]);
  const [pendingStrategiesLoading, setPendingStrategiesLoading] = React.useState(false);
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
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(true);
  const [alertsOnly, setAlertsOnly] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [showInstrumentSuggestions, setShowInstrumentSuggestions] = React.useState(false);
  const [savedSort, setSavedSort] = React.useState<{ key: SavedSortKey; direction: 'asc' | 'desc' }>({
    key: 'pnlpct',
    direction: 'desc',
  });
  const [openInstrumentSort, setOpenInstrumentSort] = React.useState<{
    key: OpenInstrumentSortKey;
    direction: 'asc' | 'desc';
  }>({
    key: 'instrument',
    direction: 'asc',
  });
  const [visibleCols, setVisibleCols] = useLocalStorage<string[]>("visible_cols_v2", [
    "status","dte","strategy","pnl","pnlpct","delta","gamma","theta","vega","rho","playbook"
  ]);
  const [selectedExchange, setSelectedExchange] = React.useState<Exchange>('deribit');
  const [btcSpot, setBtcSpot] = React.useState<number | null>(null);
  const [btcSpotUpdatedAt, setBtcSpotUpdatedAt] = React.useState<Date | null>(null);
  // price per unique leg "exchange:symbol"
  const [legMarks, setLegMarks] = React.useState<MarksMap>({});
  const [markFetch, setMarkFetch] = React.useState({
    inProgress: false,
    total: 0,
    done: 0,
    errors: 0,
  });
  const positionUploadRef = React.useRef<HTMLInputElement | null>(null);
  const backfillUploadRef = React.useRef<HTMLInputElement | null>(null);

  // ── New UI state ──────────────────────────────────────────────────────────
  const [activeView, setActiveView] = React.useState<ActiveView>('table');
  const [selectedExpiry, setSelectedExpiry] = React.useState<string | null>(null);
  const [apiExpiries, setApiExpiries] = React.useState<string[]>([]);

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

  // Sync client list from Supabase `clients` table on startup (admin only)
  React.useEffect(() => {
    if (!isAdmin || !supabase) return;
    supabase
      .from('clients')
      .select('client_name')
      .then(({ data, error }) => {
        if (error || !data) return;
        const dbNames = data
          .map((r: { client_name: string }) => (r.client_name ?? '').trim())
          .filter(Boolean);
        if (!dbNames.length) return;
        setClientOptions((prev) => {
          const next = [...prev];
          for (const name of dbNames) {
            if (!next.includes(name)) next.push(name);
          }
          return next;
        });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, supabase]);

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
        return { filtered: rows, duplicates: [] as TxnRow[], duplicatesInStructures: [] as TxnRow[], duplicatesInBacklog: [] as TxnRow[], duplicateTradeIds: [] as string[], duplicateOrderIds: [] as string[] };
      }
      return filterDuplicateRows(supabase, rows, {
        clientName: activeClientName,
        isAdmin,
        allowAllocations: options.allowAllocations,
      });
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

          const csvType = mapping.type ? String(r[mapping.type] ?? '').trim().toLowerCase() : undefined;
          const baseRow = {
            ...provisionalRow,
            trade_id: syntheticTradeId,
            csvType,
          } as TxnRow;

          if (mode === 'backfill') {
            return baseRow;
          }

          const isDelivery = csvType === 'delivery';
          const hasSide = baseRow.side === 'buy' || baseRow.side === 'sell';
          const hasAmount = Number.isFinite(baseRow.amount) && Math.abs(baseRow.amount) > 0;
          const hasPrice = Number.isFinite(baseRow.price) && baseRow.price > 0;
          if (!hasSide || !hasAmount || (!hasPrice && !isDelivery)) {
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
    [activeClientName, isAdmin, rawRows, resolveIdentifierFromMapping, supabase, user],
  );

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
        return;
      }

      const hasIdentifiers = rows.some((row) => row.trade_id || row.order_id);
      if (!hasIdentifiers) {
        setBackfillStatus({
          type: 'error',
          message: 'No trade/order IDs found. Map trade_id or order_id columns to run backfill.',
        });
        return;
      }

      setBackfillStatus({ type: 'running', message: 'Backfill in progress…' });
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
    [activeClientName, isAdmin, loadImportedTransactions, mapRowsFromMapping, showImportedOverlay, supabase, user],
  );

  React.useEffect(() => {
    if (!showImportedOverlay) return;
    void loadImportedTransactions();
  }, [loadImportedTransactions, showImportedOverlay]);

  const refreshSavedStructures = React.useCallback(() => {
    setSavedStructuresVersion((prev) => prev + 1);
  }, []);

  // Phase 2: execute the actual save (linked rows, new structures, unprocessed)
  const executeFinalizeImport = React.useCallback(async (
    linkedRows: TxnRow[],
    localRowGroups: Map<string, TxnRow[]>,
    unprocessedRows: TxnRow[],
    metadataByKey?: Map<string, StructureMetadata>,
  ) => {
    if (!supabase) {
      alert('Supabase is not configured. Configure environment variables to save trades.');
      return;
    }
    if (!user) {
      alert('Sign in to Supabase to save trades.');
      return;
    }

    const errors: string[] = [];
    let successCount = 0;

    // — append to existing saved structures —
    if (linkedRows.length > 0) {
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
          console.error('[Import] appendTradesToStructure failed:', structureId, result.error);
          errors.push(`Structure ${structureId}: ${result.error}`);
        } else {
          successCount++;
        }
      }
    }

    // — create new structures —
    for (const [key, groupedRows] of localRowGroups.entries()) {
      const structureType = groupedRows[0]?.structureType;
      const underlying = groupedRows[0]?.underlying ?? '';
      const meta = metadataByKey?.get(key);

      console.log('[Import] Creating new structure in Supabase', {
        rows: groupedRows,
        structureType,
        underlying,
        programId: meta?.programId,
        strategyName: meta?.strategyName,
        clientScope: { clientName: activeClientName, isAdmin },
      });

      const result = await createStructure(supabase, {
        rows: groupedRows,
        structureType,
        exchange: selectedExchange as any,
        clientScope: { clientName: activeClientName, isAdmin },
        createdBy: user.id,
        programId: meta?.programId || undefined,
        strategyName: meta?.strategyName || undefined,
        notes: meta?.notes || undefined,
      });

      if (!result.ok) {
        console.error('[Import] createStructure failed:', underlying || 'unknown', result.error);
        errors.push(`New structure (${underlying || 'unknown'}): ${result.error}`);
      } else {
        successCount++;
      }
    }

    // Only refresh when at least one write committed
    if (successCount > 0) {
      refreshSavedStructures();
    }

    // Save remaining backlog rows as unprocessed AFTER structures are created
    if (unprocessedRows.length > 0 && supabase && user) {
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
        console.warn('[Import] Failed to save unprocessed trades:', saveResult.error);
        errors.push(`Unprocessed trades: ${saveResult.error}`);
      }
    }

    if (errors.length > 0) {
      alert(`Import completed with ${errors.length} error${errors.length > 1 ? 's' : ''}:\n\n${errors.join('\n')}`);
    }
  }, [activeClientName, isAdmin, refreshSavedStructures, selectedExchange, supabase, user]);

  // Phase 1: intercept onConfirm from assign-legs / review overlay
  const finalizeImport = React.useCallback(async (selectedRows: TxnRow[], unprocessedRows?: TxnRow[]) => {
    const processedUnprocessedRows = unprocessedRows ?? []
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
      unprocessedRows: processedUnprocessedRows,
    });

    const enrichedRows = rows.map((row) => {
      const parsed = parseInstrumentByExchange(selectedExchange, row.instrument);
      if (!parsed) return row;
      return {
        ...row,
        underlying: row.underlying ?? parsed.underlying,
        expiry: row.expiry ?? parsed.expiryISO,
        strike: row.strike ?? parsed.strike,
        optionType: (row.optionType ?? parsed.optionType) as TxnRow['optionType'],
        exchange: row.exchange ?? (selectedExchange as TxnRow['exchange']),
      };
    });

    const linkedRows = enrichedRows.filter((row) => Boolean(row.linkedStructureId));
    const localRows = enrichedRows.filter((row) => !row.linkedStructureId);

    if (!linkedRows.length && !localRows.length) {
      return;
    }

    // Group new structures by structureId
    const localRowGroups = new Map<string, TxnRow[]>();
    for (const row of localRows) {
      const key = row.structureId ?? 'default';
      if (!localRowGroups.has(key)) localRowGroups.set(key, []);
      localRowGroups.get(key)!.push(row);
    }

    // If there are new structures, show the details overlay to collect metadata
    if (localRowGroups.size > 0) {
      console.log('[Import] New structures detected, showing details overlay', {
        structureCount: localRowGroups.size,
        linkedCount: linkedRows.length,
        keys: [...localRowGroups.keys()],
      });
      setPendingImport({ localRowGroups, linkedRows, unprocessedRows: processedUnprocessedRows });
      return;
    }

    console.log('[Import] No new structures, executing directly', {
      linkedCount: linkedRows.length,
      localCount: localRows.length,
    });
    // No new structures — just process linked rows + unprocessed directly
    await executeFinalizeImport(linkedRows, localRowGroups, processedUnprocessedRows);
  }, [executeFinalizeImport, selectedExchange, supabase, user]);

  // Fetch programs and strategies when the details overlay opens
  React.useEffect(() => {
    if (!pendingImport || !supabase || !user) return;
    let active = true;
    setPendingProgramsLoading(true);
    fetchPrograms(supabase, user).then((result) => {
      if (!active) return;
      setPendingProgramsLoading(false);
      if (result.ok) {
        setPendingProgramOptions(result.programs);
      } else {
        console.warn('[Import] Failed to load programs:', result.error);
        setPendingProgramOptions([]);
      }
    });
    return () => { active = false; };
  }, [pendingImport, supabase, user]);

  // Called when user confirms metadata in StructureDetailsOverlay
  const handleStructureDetailsConfirm = React.useCallback(async (metadata: Map<string, StructureMetadata>) => {
    if (!pendingImport) return;
    const { localRowGroups, linkedRows, unprocessedRows } = pendingImport;
    setPendingImport(null);
    await executeFinalizeImport(linkedRows, localRowGroups, unprocessedRows, metadata);
  }, [executeFinalizeImport, pendingImport]);

  // Create a new program from the overlay
  const handleCreateProgram = React.useCallback(async (name: string): Promise<ProgramOption | null> => {
    if (!supabase || !user) return null;
    try {
      const { data, error } = await supabase
        .from('programs')
        .insert({ program_name: name })
        .select('program_id, program_name')
        .single();
      if (error) {
        console.error('[Import] Failed to create program:', error.message);
        alert(`Failed to create program: ${error.message}`);
        return null;
      }
      const newProgram = data as ProgramOption;
      setPendingProgramOptions((prev) => [...prev, newProgram].sort((a, b) => a.program_name.localeCompare(b.program_name)));
      return newProgram;
    } catch (err) {
      console.error('[Import] Failed to create program:', err);
      return null;
    }
  }, [supabase, user]);

  const startImport = React.useCallback(async (mapping: Record<string, string>) => {
    const exchange = (mapping as any).__exchange || 'deribit';
    const importHistorical = Boolean((mapping as any).__importHistorical);
    const allowAllocations = Boolean((mapping as any).__allowAllocations);
    setSelectedExchange(exchange as Exchange);
    await saveRawTransactionLogs(mapping, exchange as Exchange);
    const { rows, excludedRows } = mapRowsFromMapping(mapping, 'import');
    if (importHistorical) {
      setAssignLegsContext({
        rows,
        noImportRows: excludedRows,
        processedRows: [],
        exchange: exchange as Exchange,
        savedStructures,
        strategies: pendingStrategyOptions,
        onConfirm: finalizeImport,
        onCancel: () => {},
      });
      onOpenAssignLegs?.();
      return;
    }

    const { filtered, duplicateTradeIds, duplicateOrderIds } = await filterRowsWithExistingTradeIds(rows, {
      allowAllocations,
    });

    setAssignLegsContext({
      rows: filtered,
      noImportRows: excludedRows,
      processedRows: [],
      exchange: exchange as Exchange,
      savedStructures,
      strategies: pendingStrategyOptions,
      onConfirm: finalizeImport,
      onCancel: () => {},
    });
    onOpenAssignLegs?.();
  }, [filterRowsWithExistingTradeIds, finalizeImport, mapRowsFromMapping, onOpenAssignLegs, saveRawTransactionLogs, savedStructures]);

  const [processBacklogLoading, setProcessBacklogLoading] = React.useState(false);

  const handleProcessBacklog = React.useCallback(async () => {
    if (!supabase || !user) {
      alert('Sign in to process unprocessed imports.');
      return;
    }

    setProcessBacklogLoading(true);
    try {
      const result = await fetchUnprocessedImports(supabase, {
        clientName: activeClientName || undefined,
        exchange: selectedExchange,
      });

      if (!result.ok) {
        alert(`Failed to fetch unprocessed imports: ${result.error}`);
        return;
      }

      if (result.rows.length === 0) {
        alert(`No unprocessed imports found for ${selectedExchange}.`);
        return;
      }

      setAssignLegsContext({
        rows: result.rows,
        noImportRows: [],
        processedRows: [],
        exchange: selectedExchange,
        savedStructures,
        strategies: pendingStrategyOptions,
        onConfirm: finalizeImport,
        onCancel: () => {},
      });
      onOpenAssignLegs?.();
    } finally {
      setProcessBacklogLoading(false);
    }
  }, [activeClientName, finalizeImport, onOpenAssignLegs, savedStructures, selectedExchange, supabase, user]);

  const handleFiles = React.useCallback((files: FileList, mode: 'import' | 'backfill' = 'import') => {
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
      setColumnMapperContext({
        headers,
        mode,
        onConfirm: (mapping) => {
          if (mode === 'backfill') {
            startBackfill(mapping as unknown as Record<string, string>);
          } else {
            startImport(mapping as unknown as Record<string, string>);
          }
        },
        onCancel: () => {},
      });
      onOpenMapCSV?.();
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
  }, [onOpenMapCSV, setRawRows, startBackfill, startImport]);

  const handleBackfillFiles = React.useCallback(
    (files: FileList) => {
      handleFiles(files, 'backfill');
    },
    [handleFiles],
  );

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

  // Fetch strategies once when authenticated (shared by AssignLegsPage + StructureDetailsOverlay)
  React.useEffect(() => {
    if (!supabase || !user) {
      setPendingStrategyOptions([]);
      return;
    }
    let active = true;
    setPendingStrategiesLoading(true);
    supabase
      .from('strategies')
      .select('strategy_code, strategy_name')
      .order('strategy_name')
      .then(({ data, error }) => {
        if (!active) return;
        setPendingStrategiesLoading(false);
        if (error) {
          console.warn('[Strategies] Failed to load:', error.message);
          setPendingStrategyOptions([]);
          return;
        }
        setPendingStrategyOptions(
          (data ?? []).filter(
            (row): row is StrategyOption => Boolean(row?.strategy_code && row?.strategy_name),
          ),
        );
      });
    return () => { active = false; };
  }, [supabase, user]);

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
  }, [activeClientName]);

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

  const matchesExpiry = React.useCallback(
    (p: Position) => {
      if (!selectedExpiry) return true;
      return p.legs.some((leg) => leg.expiry === selectedExpiry);
    },
    [selectedExpiry],
  );

  const filteredLive = React.useMemo(
    () => positions.filter(matchesClientSelection).filter(matchesFilter).filter(matchesExpiry),
    [matchesClientSelection, matchesFilter, matchesExpiry, positions],
  );

  const filteredSaved = React.useMemo(
    () => savedStructures.filter(matchesClientSelection).filter(matchesFilter).filter(matchesExpiry),
    [matchesClientSelection, matchesFilter, matchesExpiry, savedStructures],
  );

  // Derived expiry dates from existing data (from saved structure legs + exchange positions)
  const derivedExpiries = React.useMemo(() => {
    const seen = new Set<string>();
    for (const p of savedStructures) {
      for (const leg of p.legs) {
        if (leg.expiry) seen.add(leg.expiry);
      }
    }
    for (const pos of exchangePositions) {
      if (pos.expiryISO) seen.add(pos.expiryISO);
    }
    return [...seen].sort();
  }, [savedStructures, exchangePositions]);

  // Combined expiry list: API-fetched dates take priority, augmented with derived ones
  const allExpiries = React.useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const seen = new Set<string>([...apiExpiries, ...derivedExpiries]);
    return [...seen].filter((d) => d >= today).sort();
  }, [apiExpiries, derivedExpiries]);

  const openInstrumentRows = React.useMemo(() => {
    const instrumentMap = new Map<
      string,
      { instrument: string; qtyNet: number; absPnl: number; greeks: Record<GreekKey, number>; hasMarks: boolean; hasGreeks: boolean }
    >();
    for (const position of filteredSaved) {
      for (const leg of position.legs ?? []) {
        if (!isActiveLeg(leg)) continue;
        const instrument = String(leg.trades?.[0]?.instrument ?? '').trim();
        if (!instrument) continue;
        const qtyNet = Number(leg.qtyNet);
        if (!Number.isFinite(qtyNet) || qtyNet === 0) continue;
        const current = instrumentMap.get(instrument) ?? {
          instrument,
          qtyNet: 0,
          absPnl: 0,
          greeks: { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 },
          hasMarks: false,
          hasGreeks: false,
        };
        current.qtyNet += qtyNet;

        const ref = getLegMarkRef(position, leg);
        if (ref) {
          const mark = legMarks[ref.key];
          const multiplier = ref.exchange === 'coincall' ? mark?.multiplier : ref.defaultMultiplier;
          if (mark?.price != null) {
            current.absPnl += Math.abs(legUnrealizedPnL(leg, mark.price, multiplier));
            current.hasMarks = true;
          }
          if (mark?.greeks) {
            for (const field of GREEK_SUMMARY_FIELDS) {
              current.greeks[field.key] += legGreekExposure(leg, mark.greeks[field.key] ?? undefined, multiplier);
            }
            current.hasGreeks = true;
          }
        }

        instrumentMap.set(instrument, current);
      }
    }
    const rows = Array.from(instrumentMap.values());
    const directionFactor = openInstrumentSort.direction === 'asc' ? 1 : -1;
    const compareString = (left: string, right: string) =>
      directionFactor * left.localeCompare(right, undefined, { sensitivity: 'base' });
    const compareNumber = (left: number, right: number) => directionFactor * (left - right);
    rows.sort((a, b) => {
      switch (openInstrumentSort.key) {
        case 'instrument':
          return compareString(a.instrument, b.instrument);
        case 'qtyNet':
          return compareNumber(a.qtyNet, b.qtyNet);
        case 'absPnl':
          return compareNumber(a.absPnl, b.absPnl);
        case 'delta':
          return compareNumber(a.greeks.delta, b.greeks.delta);
        case 'gamma':
          return compareNumber(a.greeks.gamma, b.greeks.gamma);
        case 'theta':
          return compareNumber(a.greeks.theta, b.greeks.theta);
        case 'vega':
          return compareNumber(a.greeks.vega, b.greeks.vega);
        case 'rho':
          return compareNumber(a.greeks.rho, b.greeks.rho);
        default:
          return 0;
      }
    });
    return rows;
  }, [filteredSaved, isActiveLeg, legMarks, openInstrumentSort.direction, openInstrumentSort.key]);

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

  const filteredExchangePositions = React.useMemo(
    () =>
      selectedExpiry
        ? sortedExchangePositions.filter((p) => p.expiryISO === selectedExpiry)
        : sortedExchangePositions,
    [selectedExpiry, sortedExchangePositions],
  );

  const exchangePositionGroups = React.useMemo(() => {
    const groups: { label: string; positions: ExchangePositionSnapshot[] }[] = [];
    for (const position of filteredExchangePositions) {
      const label = position.expiryISO ?? 'No expiry date';
      const current = groups[groups.length - 1];
      if (!current || current.label !== label) {
        groups.push({ label, positions: [position] });
      } else {
        current.positions.push(position);
      }
    }
    return groups;
  }, [filteredExchangePositions]);

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

  const fetchAvailableExpiries = React.useCallback(async () => {
    try {
      const expiries = await dbGetInstruments('BTC');
      if (expiries.length > 0) setApiExpiries(expiries);
    } catch (error) {
      console.error('[expiries] fetch failed', error);
    }
  }, []);

  // Auto-fetch all Deribit expiries on mount
  React.useEffect(() => {
    void fetchAvailableExpiries();
  }, [fetchAvailableExpiries]);

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

  const handleSavedSort = React.useCallback((key: SavedSortKey, direction: 'asc' | 'desc') => {
    setSavedSort({ key, direction });
  }, []);

  const handleOpenInstrumentSort = React.useCallback((key: OpenInstrumentSortKey, direction: 'asc' | 'desc') => {
    setOpenInstrumentSort({ key, direction });
  }, []);

  const updatePosition = React.useCallback((id: string, updates: Partial<Position>) => {
    setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, [setPositions]);


  const fetchAllMarksForPositions = React.useCallback(async (ps: Position[]) => {
    setMarkFetch({ inProgress: true, total: 0, done: 0, errors: 0 });
    await fetchBtcSpot();

    // Collect unique Deribit instrument symbols
    const seen = new Set<string>();
    const instruments: string[] = [];

    for (const position of ps) {
      for (const leg of position.legs) {
        const ref = getLegMarkRef(position, leg);
        if (!ref || ref.exchange !== 'deribit') continue; // TODO: add CoinCall later
        if (seen.has(ref.symbol)) continue;
        seen.add(ref.symbol);
        instruments.push(ref.symbol);
      }
    }

    if (instruments.length === 0) {
      console.warn('[marks] no Deribit instruments to fetch');
      setMarkFetch({ inProgress: false, total: 0, done: 0, errors: 0 });
      return;
    }

    setMarkFetch(prev => ({ ...prev, total: instruments.length }));

    const results = await fetchDeribitMarks(instruments, (done, total, errors) => {
      setMarkFetch({ inProgress: true, total, done, errors });
    });

    if (Object.keys(results).length) {
      setLegMarks(prev => ({ ...prev, ...results }));
    }

    setMarkFetch(prev => ({ ...prev, inProgress: false }));
  }, [fetchBtcSpot, setLegMarks, setMarkFetch]);


  const handleSignOut = React.useCallback(() => {
    if (!supabase) return;
    void supabase.auth.signOut();
  }, [supabase]);

  if (!supabaseConfigured || !supabase) {
    return (
      <div className="min-h-screen bg-bg-canvas flex items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border-default bg-bg-surface-1 p-8 text-center type-subhead text-text-secondary shadow-sm">
          <p className="type-headline font-semibold text-text-secondary">Supabase configuration required</p>
          <p>
            Set <code className="rounded bg-bg-surface-3 px-1 py-0.5">VITE_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-bg-surface-3 px-1 py-0.5">VITE_SUPABASE_PUBLISHABLE_KEY</code> to enable
            authentication and program lookups.
          </p>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bg-canvas flex items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border-default bg-bg-surface-1 p-8 text-center text-subhead text-text-secondary shadow-[var(--shadow-card)]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
          <p className="text-headline font-semibold text-text-primary">Verifying session</p>
          <p>Checking your saved credentials...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-bg-canvas">
        {/* Ambient glow background */}
        <div className="absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-accent-glow blur-3xl" />
          <div className="absolute bottom-[-120px] right-[-80px] h-[520px] w-[520px] rounded-full bg-status-info-bg blur-3xl opacity-40" />
        </div>

        {/* Ghost dashboard preview */}
        <div className="absolute inset-0 bg-bg-canvas/60 backdrop-blur-sm">
          <div className="absolute inset-x-6 top-28 hidden gap-6 opacity-[0.35] lg:flex">
            <div className="flex flex-1 flex-col gap-4 rounded-2xl border border-border-subtle bg-bg-surface-1-alpha p-6">
              <div className="h-3 w-32 rounded-full bg-bg-surface-3-alpha" />
              <div className="grid grid-cols-2 gap-3">
                <div className="h-24 rounded-xl border border-border-subtle bg-bg-surface-1-alpha" />
                <div className="h-24 rounded-xl border border-border-subtle bg-bg-surface-1-alpha" />
                <div className="h-24 rounded-xl border border-border-subtle bg-bg-surface-1-alpha" />
                <div className="h-24 rounded-xl border border-border-subtle bg-bg-surface-1-alpha" />
              </div>
              <div className="h-3 w-20 rounded-full bg-bg-surface-3-alpha" />
            </div>
            <div className="hidden w-64 flex-col gap-4 rounded-2xl border border-border-subtle bg-bg-surface-1-alpha p-6 xl:flex">
              <div className="h-3 w-24 rounded-full bg-bg-surface-3-alpha" />
              <div className="space-y-3">
                <div className="h-10 rounded-xl border border-border-subtle bg-bg-surface-1-alpha" />
                <div className="h-10 rounded-xl border border-border-subtle bg-bg-surface-1-alpha" />
                <div className="h-10 rounded-xl border border-border-subtle bg-bg-surface-1-alpha" />
                <div className="h-10 rounded-xl border border-border-subtle bg-bg-surface-1-alpha" />
              </div>
              <div className="h-3 w-14 rounded-full bg-bg-surface-3-alpha" />
            </div>
          </div>
        </div>

        {/* Login content */}
        <div className="relative z-[var(--z-dropdown)] flex min-h-screen items-center justify-center p-6">
          <div className="w-full max-w-md space-y-8">
            <div className="space-y-2 text-center">
              <p className="text-caption font-semibold uppercase tracking-[0.35em] text-text-disabled">
                Authentication required
              </p>
              <h1 className="text-display-l font-semibold tracking-tight text-text-primary">
                Sign in to continue
              </h1>
              <p className="text-subhead text-text-tertiary">
                Unlock lookups, structure imports, and live mark fetching.
              </p>
            </div>

            <SupabaseLogin />

            <p className="text-center text-caption text-text-disabled">
              Access is limited to authorized trading workspaces.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Search suggestions dropdown (used in ViewSelector)
  const searchSuggestionsNode = showInstrumentSuggestions && instrumentSuggestions.length > 0 ? (
    <div className="absolute left-0 right-0 z-20 mt-2 rounded-2xl border border-border-strong bg-bg-surface-1 shadow-xl">
      <ul className="max-h-56 overflow-y-auto py-2 type-subhead text-text-secondary">
        {instrumentSuggestions.map((instrument) => (
          <li key={instrument}>
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-bg-surface-1"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleInstrumentSelection(instrument)}
            >
              <span className="font-medium text-text-primary">{instrument}</span>
              <span className="type-caption text-text-tertiary">Instrument</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <div className="flex min-h-screen bg-bg-canvas">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        activeNav={innerView === 'mapCSV' ? 'mapCSV' : innerView === 'assignLegs' ? 'assignLegs' : (innerView === 'playbookIndex' || (typeof innerView === 'object' && innerView?.type === 'playbookDetail')) ? 'playbooks' : 'dashboard'}
        onNavigateDashboard={onNavigateDashboard}
        onNavigatePlaybooks={onOpenPlaybookIndex}
        onNavigateAssignLegs={onOpenAssignLegs}
        onNavigateMapCSV={onOpenMapCSV}
        user={user}
        btcSpot={btcSpot}
        btcSpotUpdatedAt={btcSpotUpdatedAt}
        isAdmin={isAdmin}
        selectedClient={selectedClient}
        clientOptions={clientOptions}
        onSelectClient={setSelectedClient}
        onAddClient={handleAddClient}
        alertsOnly={alertsOnly}
        onToggleAlertsOnly={setAlertsOnly}
        onSignOut={handleSignOut}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col bg-bg-canvas">

        {/* ── Header: arrows + title + portfolio greeks ── */}
        <DashboardHeader
          title={
            innerView === 'mapCSV'
              ? (mapCsvStep === 'mapping' ? 'Mapping' : 'Import CSV')
              : innerView === 'assignLegs'
              ? 'Assign Legs'
              : innerView === 'playbookIndex'
              ? 'Playbooks'
              : typeof innerView === 'object' && innerView?.type === 'playbookDetail'
              ? 'Playbook'
              : typeof innerView === 'object' && innerView?.type === 'structureDetail'
              ? 'Structure'
              : 'Dashboard'
          }
          clientName={activeClientName}
          clientOptions={clientOptions}
          onClientChange={setSelectedClient}
          portfolioGreeks={portfolioGreeks}
        />

        {/* ── Embedded inner views (Map CSV / Assign Legs) ── */}
        {innerView === 'mapCSV' && (
          <MapCSVPage
            embedded
            onBack={() => window.history.back()}
            onOpenAssignLegs={onOpenAssignLegs}
            onStepChange={setMapCsvStep}
            onFinalizeImport={finalizeImport}
            strategies={pendingStrategyOptions}
          />
        )}
        {innerView === 'assignLegs' && (
          <AssignLegsPage
            embedded
            onBack={() => window.history.back()}
          />
        )}
        {innerView === 'playbookIndex' && (
          <PlaybookIndexPage
            embedded
            onBack={() => window.history.back()}
            onSelectPlaybook={onOpenPlaybook ?? (() => {})}
          />
        )}
        {typeof innerView === 'object' && innerView?.type === 'playbookDetail' && (
          <StrategyPlaybookPage
            embedded
            slug={innerView.slug}
            onBackToIndex={onOpenPlaybookIndex ?? (() => {})}
            onBackToDashboard={() => window.history.back()}
            onOpenPlaybook={onOpenPlaybook ?? (() => {})}
          />
        )}
        {typeof innerView === 'object' && innerView?.type === 'structureDetail' && (() => {
          const pos = savedStructures.find((s) => s.id === innerView.id)
          if (!pos) return <div className="flex-1 flex items-center justify-center text-text-secondary type-subhead">Structure not found.</div>
          return (
            <StructureDetailPage
              embedded
              position={pos}
              marks={legMarks}
              markLoading={markFetch.inProgress}
              onBack={() => window.history.back()}
              onArchive={handleArchiveStructure}
              archiving={Boolean(archiving[pos.id])}
              onRefreshMarks={() => fetchAllMarksForPositions([pos])}
            />
          )
        })()}

        {/* ── Dashboard content (only when no inner view) ── */}
        {!innerView && <>

        {/* ── Page title + action buttons ── */}
        <div className="px-6 pt-5 pb-2 flex items-end justify-between gap-4">
          <h2 className="type-display-l font-bold tracking-tight text-text-primary">Dashboard</h2>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Fetch */}
            <Button
              variant="secondary"
              size="sm"
              leftIcon={savedStructuresLoading ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => { refreshSavedStructures(); void fetchAvailableExpiries(); }}
              disabled={savedStructuresLoading || !supabase || !user}
              title="Refresh saved structures and fetch available expiries"
            >
              {savedStructuresLoading ? 'Fetching…' : 'Fetch'}
            </Button>

            {/* Get Live Marks */}
            <Button
              variant="secondary"
              size="sm"
              leftIcon={markFetch.inProgress ? <Spinner className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
              onClick={() => fetchAllMarksForPositions(positionsForMarks)}
              disabled={markFetch.inProgress}
              title="Fetch current mark/greeks for all visible legs"
            >
              {markFetch.inProgress ? `${markFetch.done}/${markFetch.total}` : 'Get Live Marks'}
            </Button>

            {/* Import */}
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Upload className="h-3.5 w-3.5" />}
              onClick={onOpenMapCSV}
              title="Import CSV trade data"
            >
              Import
            </Button>

            {/* Process Backlog */}
            <Button
              variant="secondary"
              size="sm"
              leftIcon={processBacklogLoading ? <Spinner className="h-3.5 w-3.5" /> : <Inbox className="h-3.5 w-3.5" />}
              onClick={handleProcessBacklog}
              disabled={processBacklogLoading || !supabase || !user}
              title="Process unprocessed imports from backlog"
            >
              {processBacklogLoading ? 'Loading…' : 'Process Backlog'}
            </Button>
          </div>
        </div>

        {/* Mark-fetch progress bar */}
        {markFetch.inProgress && (
          <div className="px-6 pb-2">
            <div className="h-1 bg-bg-surface-1 rounded-full overflow-hidden">
              <div
                className="h-1 bg-status-success rounded-full transition-all"
                style={{ width: markFetch.total ? `${Math.round((markFetch.done / markFetch.total) * 100)}%` : '10%' }}
              />
            </div>
            <div className="type-caption text-text-tertiary mt-1">
              Fetched {markFetch.done}/{markFetch.total}
              {markFetch.errors ? <> · {markFetch.errors} errors</> : null}
            </div>
          </div>
        )}

        {/* ── Expiry date chips ── */}
        <ExpiryDatePicker
          expiries={allExpiries}
          selected={selectedExpiry}
          onSelect={setSelectedExpiry}
        />

        {/* ── View selector + search ── */}
        <ViewSelector
          activeView={activeView}
          onViewChange={setActiveView}
          query={query}
          onQueryChange={(q) => { setQuery(q); setShowInstrumentSuggestions(true); }}
          searchSuggestions={searchSuggestionsNode}
          onSearchFocus={() => setShowInstrumentSuggestions(true)}
          onSearchBlur={() => setShowInstrumentSuggestions(false)}
          onSearchKeyDown={handleSearchKeyDown}
        />

        {/* ── Content rectangle ── */}
        <div className="px-6 pb-6 flex-1">
          <div className="bg-bg-surface-1 rounded-xl border border-border-default overflow-hidden">

            {/* ─── TABLE VIEW ─────────────────────────────────────────────── */}
            {activeView === 'table' && (
              <div>
                {/* Section 1: Saved Structures */}
                <div className="border-b border-border-default">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
                    <span className="type-subhead font-semibold text-text-secondary">Saved Structures</span>
                    <div className="flex items-center gap-2">
                      {savedStructuresLoading && <span className="type-caption text-text-tertiary">Refreshing…</span>}
                      <ColumnPicker visibleCols={visibleCols} onVisibleColsChange={setVisibleCols} />
                    </div>
                  </div>
                  {savedStructuresError && (
                    <div className="px-4 py-3 type-subhead text-status-danger">{savedStructuresError}</div>
                  )}
                  {programPlaybooksError && (
                    <div className="px-4 py-3 type-subhead text-status-warning">{programPlaybooksError}</div>
                  )}
                  {filteredSaved.length === 0 ? (
                    <div className="px-4 py-4 type-subhead text-text-tertiary">
                      {savedStructures.length > 0
                        ? 'No saved structures match your filters.'
                        : savedStructuresLoading
                        ? 'Loading saved structures…'
                        : 'No saved structures yet. Use the save action on a live position to create one.'}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full type-subhead">
                        <PositionTableHead<SavedSortKey> visibleCols={visibleCols} sort={{ sortKey: savedSort.key, direction: savedSort.direction, onSort: handleSavedSort }} />
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
                              onViewDetails={onOpenStructureDetail ? (pos) => onOpenStructureDetail(pos.id) : undefined}
                            />
                          ))}
                          {savedStructureGroups.closed.length > 0 && (
                            <tr className="bg-bg-surface-1-alpha border-y border-border-default">
                              <td colSpan={savedStructureColSpan} className="tbl-th">
                                <div className="flex items-center gap-3">
                                  <span>Closed structures</span>
                                  <span className="h-px flex-1 bg-bg-surface-3" aria-hidden />
                                </div>
                              </td>
                            </tr>
                          )}
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
                              onViewDetails={onOpenStructureDetail ? (pos) => onOpenStructureDetail(pos.id) : undefined}
                              onPlaybookOpen={handleOpenPlaybookDrawer}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Section 2: Open Instruments */}
                <div className="border-b border-border-default">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
                    <span className="type-subhead font-semibold text-text-secondary">Open Instruments</span>
                    <span className="type-caption text-text-tertiary">
                      {openInstrumentRows.length > 0 ? `${openInstrumentRows.length} instruments` : 'None'}
                    </span>
                  </div>
                  {openInstrumentRows.length === 0 ? (
                    <div className="px-4 py-4 type-subhead text-text-tertiary">No open instruments.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full type-subhead">
                        <thead className="type-caption uppercase text-text-tertiary border-t border-border-default">
                          <tr className="text-left">
                            <th className="p-3"><SortHeader<OpenInstrumentSortKey> label="Instrument" sortKey="instrument" currentKey={openInstrumentSort.key} direction={openInstrumentSort.direction} onSort={handleOpenInstrumentSort} /></th>
                            <th className="p-3 text-right"><SortHeader<OpenInstrumentSortKey> label="Net Qty" sortKey="qtyNet" currentKey={openInstrumentSort.key} direction={openInstrumentSort.direction} onSort={handleOpenInstrumentSort} /></th>
                            <th className="p-3 text-right"><SortHeader<OpenInstrumentSortKey> label="Abs PnL" sortKey="absPnl" currentKey={openInstrumentSort.key} direction={openInstrumentSort.direction} onSort={handleOpenInstrumentSort} /></th>
                            {GREEK_SUMMARY_FIELDS.map((field) => (
                              <th key={field.key} className="p-3 text-right">
                                <SortHeader<OpenInstrumentSortKey> label={field.symbol} sortKey={field.key as OpenInstrumentSortKey} currentKey={openInstrumentSort.key} direction={openInstrumentSort.direction} onSort={handleOpenInstrumentSort} />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {openInstrumentRows.map((row) => (
                            <tr key={row.instrument} className="border-t border-border-default">
                              <td className="p-3 font-medium text-text-primary">{row.instrument}</td>
                              <td className="p-3 text-right text-text-secondary">{formatQuantity(row.qtyNet)}</td>
                              <td className="p-3 text-right text-text-secondary">{row.hasMarks ? fmtPremium(row.absPnl) : '—'}</td>
                              {GREEK_SUMMARY_FIELDS.map((field) => (
                                <td key={field.key} className="p-3 text-right text-text-secondary">
                                  {row.hasGreeks ? fmtGreek(row.greeks[field.key]) : '—'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Section 3: Exchange Positions */}
                <div className="border-b border-border-default">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
                    <span className="type-subhead font-semibold text-text-secondary">Exchange Positions</span>
                    <div className="flex items-center gap-3">
                      <span className="type-caption text-text-tertiary">
                        {exchangePositions.length ? `${exchangePositions.length} loaded` : 'None'}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="type-caption"
                        onClick={() => positionUploadRef.current?.click()}
                      >
                        Upload CSV
                      </Button>
                      <input
                        ref={positionUploadRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={(e) => e.target.files && handlePositionFiles(e.target.files)}
                      />
                    </div>
                  </div>
                  {filteredExchangePositions.length === 0 ? (
                    <div className="px-4 py-4 type-subhead text-text-tertiary">
                      No exchange positions.{' '}
                      <span className="text-text-disabled">Upload a Deribit or Coincall CSV export above.</span>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full type-subhead">
                        <thead className="type-caption uppercase text-text-tertiary border-t border-border-default">
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
                              <tr className="bg-bg-surface-1-alpha border-t border-border-default type-caption font-semibold uppercase tracking-wide text-text-tertiary">
                                <td colSpan={8} className="px-3 py-2 text-left">
                                  <div className="flex items-center gap-3">
                                    <span>Expiry: {group.label}</span>
                                    <span className="h-px flex-1 bg-bg-surface-3" aria-hidden />
                                  </div>
                                </td>
                              </tr>
                              {group.positions.map((position) => {
                                const sideLower = position.side.toLowerCase();
                                const sideClass = sideLower === 'buy'
                                  ? 'text-status-success'
                                  : sideLower === 'sell'
                                  ? 'text-status-danger'
                                  : 'text-text-tertiary';
                                return (
                                  <tr key={position.id} className="border-t border-border-default">
                                    <td className="p-3 type-caption font-semibold uppercase text-text-tertiary">{position.exchange}</td>
                                    <td className="p-3 font-medium text-text-primary">{position.instrument}</td>
                                    <td className="p-3 text-text-secondary">{position.expiryISO ?? '—'}</td>
                                    <td className="p-3 text-text-secondary">{formatQuantity(position.size)}</td>
                                    <td className={`p-3 font-semibold ${sideClass}`}>{position.side}</td>
                                    <td className="p-3 text-text-secondary">{formatPrice(position.avgPrice)}</td>
                                    <td className="p-3 text-text-secondary">{formatPrice(position.markPrice)}</td>
                                    <td className="p-3 text-text-secondary">{formatPrice(position.indexPrice)}</td>
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

                {/* Section 4: Live Positions (if any) */}
                {positions.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
                      <span className="type-subhead font-semibold text-text-secondary">Live Positions</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full type-subhead">
                        <PositionTableHead visibleCols={visibleCols} />
                        <tbody>
                          {filteredLive.length === 0 && (
                            <tr>
                              <td colSpan={livePositionColSpan} className="p-4 type-subhead text-text-tertiary">
                                No live positions match your filters.
                              </td>
                            </tr>
                          )}
                          {livePositionGroups.map((group) => (
                            <React.Fragment key={group.label}>
                              <tr className="bg-bg-surface-1-alpha border-y border-border-default type-caption font-semibold uppercase tracking-wide text-text-tertiary">
                                <td colSpan={livePositionColSpan} className="px-3 py-2 text-left">
                                  <div className="flex items-center gap-3">
                                    <span>Expiry: {group.label}</span>
                                    <span className="h-px flex-1 bg-bg-surface-3" aria-hidden />
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
                )}

              </div>
            )}

            {/* ─── KANBAN VIEW ────────────────────────────────────────────── */}
            {activeView === 'kanban' && (
              <KanbanBoard positions={filteredSaved} marks={legMarks} onCardClick={onOpenStructureDetail ? (p) => onOpenStructureDetail(p.id) : undefined} />
            )}

            {/* ─── GANTT VIEW ─────────────────────────────────────────────── */}
            {activeView === 'gantt' && (
              <GanttTimeline
                positions={filteredSaved}
                marks={legMarks}
                expiries={allExpiries}
                onCardClick={onOpenStructureDetail ? (p) => onOpenStructureDetail(p.id) : undefined}
              />
            )}

          </div>
        </div>

      </>}
      </div>

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
      {pendingImport && (
        <StructureDetailsOverlay
          structures={Array.from(pendingImport.localRowGroups.entries()).map(([key, rows]) => {
            const underlying = rows[0]?.underlying ?? 'Unknown';
            const expiries = [...new Set(rows.map((r) => r.expiry).filter(Boolean))];
            const expirySketch = expiries.length > 0 ? expiries.join(', ') : 'No expiry';
            return { key, underlying, expirySketch, legCount: rows.length } satisfies StructureSummary;
          })}
          programs={pendingProgramOptions}
          programsLoading={pendingProgramsLoading}
          strategies={pendingStrategyOptions}
          strategiesLoading={pendingStrategiesLoading}
          initialStrategyCodes={(() => {
            const m = new Map<string, string>();
            for (const [key, rows] of pendingImport.localRowGroups.entries()) {
              const code = rows[0]?.structureType;
              if (code) m.set(key, code);
            }
            return m;
          })()}
          onConfirm={handleStructureDetailsConfirm}
          onBack={() => setPendingImport(null)}
          onCreateProgram={handleCreateProgram}
        />
      )}
    </div>
  );
}
