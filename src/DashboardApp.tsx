import React from 'react'
import Papa from 'papaparse'
import { Toggle } from './components/Toggle'
import { UploadBox } from './components/UploadBox'
import { ColumnMapper } from './components/ColumnMapper'
import { ReviewOverlay, type ReviewStructureOption } from './components/ReviewOverlay'
import { SupabaseLogin } from './features/auth/SupabaseLogin'
import { useAuth } from './features/auth/useAuth'
import { tryGetSupabaseClient } from './lib/supabase'
import {
  Position, TxnRow, Lot,
  useLocalStorage, devQuickTests,
  parseActionSide, toNumber, parseInstrumentByExchange, normalizeSecond,
  daysTo, daysSince, fifoMatchAndRealize, classifyStatus,
  Exchange, getLegMarkRef, fmtGreek, legGreekExposure
} from './utils'
import { PositionRow } from './components/PositionRow'
import { ccGetBest } from './lib/venues/coincall'
import { dbGetBest } from './lib/venues/deribit'
import { archiveStructure, fetchSavedStructures, appendTradesToStructure } from './lib/positions'
import { resolveClientAccess } from './features/auth/access'

const CLIENT_LIST_STORAGE_KEY = 'tm_client_names_v1'
const SELECTED_CLIENT_STORAGE_KEY = 'tm_selected_client_v1'
const RAW_ROWS_STORAGE_KEY = 'deribit_raw_rows_by_client_v1'
const POSITIONS_STORAGE_KEY = 'deribit_positions_by_client_v1'
const DEFAULT_CLIENT_NAME = 'General'

const GREEK_SUMMARY_FIELDS = [
  { key: 'delta', label: 'Delta', symbol: 'Δ' },
  { key: 'gamma', label: 'Gamma', symbol: 'Γ' },
  { key: 'theta', label: 'Theta', symbol: 'Θ' },
  { key: 'vega', label: 'Vega', symbol: 'V' },
  { key: 'rho', label: 'Rho', symbol: 'Ρ' },
] as const

type GreekKey = typeof GREEK_SUMMARY_FIELDS[number]['key']

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
  const [savedStructures, setSavedStructures] = React.useState<Position[]>([]);
  const [savedStructuresLoading, setSavedStructuresLoading] = React.useState(false);
  const [savedStructuresError, setSavedStructuresError] = React.useState<string | null>(null);
  const [savedStructuresVersion, setSavedStructuresVersion] = React.useState(0);
  const [archiving, setArchiving] = React.useState<Record<string, boolean>>({});
  const [showMapper, setShowMapper] = React.useState<{ headers: string[] } | null>(null);
  const [showReview, setShowReview] = React.useState<{
    rows: TxnRow[];
    excludedRows: TxnRow[];
    duplicateTradeIds?: string[];
  } | null>(null);
  const [alertsOnly, setAlertsOnly] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [visibleCols, setVisibleCols] = useLocalStorage<string[]>("visible_cols_v2", [
    "status","structure","dte","legs","strategy","pnl","pnlpct","delta","gamma","theta","vega","rho","playbook"
  ]);
  const [selectedExchange, setSelectedExchange] = React.useState<Exchange>('deribit');
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

  function handleFiles(files: FileList) {
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
      setShowMapper({ headers });
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

  const filterRowsWithExistingTradeIds = React.useCallback(
    async (rows: TxnRow[]) => {
      if (!supabase) {
        return { filtered: rows, duplicates: [] as TxnRow[] };
      }

      const uniqueTradeIds = Array.from(
        new Set(
          rows
            .map((row) => row.trade_id?.trim())
            .filter((id): id is string => Boolean(id)),
        ),
      );

      if (uniqueTradeIds.length === 0) {
        return { filtered: rows, duplicates: [] as TxnRow[] };
      }

      const clientFilter = activeClientName?.trim();
      const restrictByClient = Boolean(clientFilter) && !isAdmin;
      const duplicates = new Set<string>();
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
          if (id) duplicates.add(id);
        }
      }

      if (!duplicates.size) {
        return { filtered: rows, duplicates: [] as TxnRow[] };
      }

      const filtered = rows.filter((row) => {
        const id = row.trade_id?.trim();
        return !id || !duplicates.has(id);
      });

      const duplicateRows = rows.filter((row) => {
        const id = row.trade_id?.trim();
        return Boolean(id && duplicates.has(id));
      });

      return { filtered, duplicates: duplicateRows };
    },
    [supabase, activeClientName, isAdmin],
  );

  async function startImport(mapping: Record<string, string>) {
    const exchange = (mapping as any).__exchange || 'deribit';
    setSelectedExchange(exchange as Exchange);
    const mappedRaw: TxnRow[] = rawRows.map((r) => {
      const rawSide = String(r[mapping.side] ?? '');
      const { action, side } = parseActionSide(rawSide);
      return {
        instrument: String(r[mapping.instrument] ?? '').trim(),
        side: side || '',
        action,
        amount: toNumber(r[mapping.amount]),
        price: toNumber(r[mapping.price]),
        fee: mapping.fee ? toNumber(r[mapping.fee]) : 0,
        timestamp: mapping.timestamp ? String(r[mapping.timestamp]) : undefined,
        trade_id: mapping.trade_id ? String(r[mapping.trade_id]) : undefined,
        order_id: mapping.order_id ? String(r[mapping.order_id]) : undefined,
        info: mapping.info ? String(r[mapping.info]) : undefined,
        exchange: exchange as Exchange,
      } as TxnRow;
    }).filter((r) => r.instrument && r.amount && r.price && (r.side === 'buy' || r.side === 'sell'));

    const timeCleaned: TxnRow[] = mappedRaw.filter((r) => {
      if (!r.timestamp) return true;
      const t = String(r.timestamp).trim();
      return !t.endsWith('08:00:00');
    });

    const optionsOnly: TxnRow[] = [];
    const excludedRows: TxnRow[] = [];
    for (const row of timeCleaned) {
      const parsed = parseInstrumentByExchange(exchange as Exchange, row.instrument);
      if (parsed) optionsOnly.push(row); else excludedRows.push(row);
    }

    const { filtered, duplicates } = await filterRowsWithExistingTradeIds(optionsOnly);
    const duplicateTradeIds = Array.from(
      new Set(
        duplicates
          .map((row) => row.trade_id?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    );

    setShowMapper(null);
    setShowReview({
      rows: filtered,
      excludedRows,
      duplicateTradeIds: duplicateTradeIds.length ? duplicateTradeIds : undefined,
    });
  }

  async function finalizeImport(selectedRows: TxnRow[]) {
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

    const linkedRows = rows.filter((row) => Boolean(row.linkedStructureId));
    const localRows = rows.filter((row) => !row.linkedStructureId);

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
      const pnlPct = netPremium > 0 ? (realizedPnl / netPremium) * 100 : null;
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
      ];

      return haystacks.some((candidate) => candidate.toLowerCase().includes(normalizedQuery));
    },
    [alertsOnly, normalizedQuery],
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

  const selectableStructureOptions = React.useMemo<ReviewStructureOption[]>(() => {
    if (!savedStructures.length) return [];
    const normalizedClient = (activeClientName ?? DEFAULT_CLIENT_NAME).trim() || DEFAULT_CLIENT_NAME;

    const labelForStructure = (structure: Position) => {
      const structureCode = structure.structureId ?? structure.id;
      const expiry = structure.expiryISO || '—';
      const exchangeLabel = structure.exchange ? structure.exchange.toUpperCase() : '—';
      return `#${structureCode} • ${structure.underlying} • ${expiry} • ${exchangeLabel}`;
    };

    return savedStructures
      .filter((structure) => {
        const structureClient = (structure.clientName ?? DEFAULT_CLIENT_NAME).trim() || DEFAULT_CLIENT_NAME;
        if (structureClient !== normalizedClient) return false;
        const isArchived = Boolean(structure.archived || structure.archivedAt);
        if (isArchived) return false;
        return true;
      })
      .map((structure) => ({
        value: structure.id,
        label: labelForStructure(structure),
      }));
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
  }, [setLegMarks, setMarkFetch]);

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
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="absolute left-3 top-2.5 text-slate-400">🔎</span>
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
                {tableHead}
                <tbody>
                  {filteredSaved.map((p) => (
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
                      <td colSpan={visibleCols.length + 3} className="p-4 text-sm text-slate-500">
                        No live positions match your filters.
                      </td>
                    </tr>
                  ) : null}
                  {filteredLive.map((p) => (
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
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showReview && (
        <ReviewOverlay
          rows={showReview.rows}
          excludedRows={showReview.excludedRows}
          duplicateTradeIds={showReview.duplicateTradeIds}
          onConfirm={finalizeImport}
          onCancel={() => setShowReview(null)}
          availableStructures={selectableStructureOptions}
        />
      )}

      {showMapper && (
        <ColumnMapper
          headers={showMapper.headers}
          onConfirm={startImport}
          onCancel={() => setShowMapper(null)}
        />
      )}
    </div>
  );
}
