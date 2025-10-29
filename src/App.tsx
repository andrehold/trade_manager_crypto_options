import React from 'react'
import Papa from 'papaparse'
import { Toggle } from './components/Toggle'
import { UploadBox } from './components/UploadBox'
import { ColumnMapper } from './components/ColumnMapper'
import { ReviewOverlay } from './components/ReviewOverlay'
import { SupabaseLogin } from './features/auth/SupabaseLogin'
import { useAuth } from './features/auth/useAuth'
import { tryGetSupabaseClient } from './lib/supabase'
import {
  Position, TxnRow, Lot,
  useLocalStorage, devQuickTests,
  parseActionSide, toNumber, parseInstrumentByExchange, normalizeSecond,
  daysTo, fifoMatchAndRealize, classifyStatus,
  Exchange, getLegMarkRef
} from './utils'
import { PositionRow } from './components/PositionRow'
import { ccGetBest } from './lib/venues/coincall'
import { dbGetBest } from './lib/venues/deribit'

export default function App() {
  React.useEffect(() => { devQuickTests(); }, []);

  const { user, loading: authLoading, supabaseConfigured } = useAuth();
  const supabase = React.useMemo(
    () => (supabaseConfigured ? tryGetSupabaseClient() : null),
    [supabaseConfigured],
  );

  const [rawRows, setRawRows] = useLocalStorage<any[]>("deribit_raw_rows", []);
  const [positions, setPositions] = useLocalStorage<Position[]>("deribit_positions_v1", []);
  const [showMapper, setShowMapper] = React.useState<{ headers: string[] } | null>(null);
  const [showReview, setShowReview] = React.useState<{ rows: TxnRow[]; excludedRows: TxnRow[] } | null>(null);
  const [alertsOnly, setAlertsOnly] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [visibleCols, setVisibleCols] = useLocalStorage<string[]>("visible_cols_v1", [
    "status","symbol","structure","dte","type","legs","strategy","pnl","pnlpct","delta","gamma","theta","vega","rho","playbook"
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

  function startImport(mapping: Record<string, string>) {
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

    setShowMapper(null);
    setShowReview({ rows: optionsOnly, excludedRows });
  }

  function finalizeImport(selectedRows: TxnRow[]) {
    const rows: TxnRow[] = selectedRows.map((r) => ({
      ...r,
      structureId: String(r.structureId ?? normalizeSecond(r.timestamp))
    }));
    for (const row of rows) {
      const parsed = parseInstrumentByExchange(selectedExchange, row.instrument);
      if (parsed) {
        row.underlying = parsed.underlying;
        row.expiry = parsed.expiryISO;
        row.strike = parsed.strike;
        row.optionType = parsed.optionType as any;
      }
    }
    const grouped = buildPositionsFromTransactions(rows);
    setPositions(grouped);
    setShowReview(null);
  }

  function buildPositionsFromTransactions(rows: TxnRow[]): Position[] {
    const byPos = new Map<string, TxnRow[]>();
    for (const r of rows) {
      if (!r.underlying || !r.expiry || r.strike == null || !r.optionType) continue;
      const ex = (r.exchange ?? 'deribit') as Exchange;
      const structureKey = String(r.structureId ?? 'auto');
      const key = `${ex}__${r.underlying}__${r.expiry}__${structureKey}`;
      if (!byPos.has(key)) byPos.set(key, []);
      byPos.get(key)!.push(r);
    }

    const out: Position[] = [];
    for (const [key, txns] of byPos.entries()) {
      const [exchange, underlying, expiryISO, structureId] = key.split("__");

      const byLeg = new Map<string, TxnRow[]>();
      for (const t of txns) {
        const lkey = `${t.strike}-${t.optionType}`;
        if (!byLeg.has(lkey)) byLeg.set(lkey, []);
        byLeg.get(lkey)!.push(t);
      }

      const legs: any[] = [];
      for (const [lkey, ltx] of byLeg.entries()) {
        const [strikeStr, opt] = lkey.split("-");
        const strike = Number(strikeStr);
        const openLots: any[] = [];
        let realizedPnl = 0;
        let netPremium = 0;
        let qtyNet = 0;

        for (const tr of ltx) {
          const sign: 1 | -1 = tr.side === "buy" ? 1 : -1;
          const lot = { qty: Math.abs(tr.amount), price: tr.price, sign };
          netPremium += (sign === -1 ? +1 : -1) * (tr.price * Math.abs(tr.amount));
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
          key: lkey, strike, optionType: opt as any, 
          openLots, realizedPnl, netPremium, qtyNet, 
          trades: ltx, 
          exchange: legExchange 
        });
      }

      const legsCount = legs.length;
      const realizedPnl = legs.reduce((a: number, l: any) => a + l.realizedPnl, 0);
      const netPremium = legs.reduce((a: number, l: any) => a + l.netPremium, 0);
      const absClosedCash = Math.abs(realizedPnl) > 0 ? Math.abs(realizedPnl) + Math.max(1, Math.abs(netPremium)) / 10 : Math.abs(netPremium);
      const pnlPct = absClosedCash ? (realizedPnl / absClosedCash) * 100 : null;
      const dte = daysTo(expiryISO);
      const status = classifyStatus(dte, pnlPct, realizedPnl);

      out.push({
        id: key,
        underlying,
        expiryISO,
        dte,
        legs,
        legsCount,
        type: legsCount > 1 ? "Multi-leg" : "Single",
        strategy: undefined,
        realizedPnl,
        netPremium,
        pnlPct,
        status,
        greeks: { delta: null, gamma: null, theta: null, vega: null, rho: null },
        playbook: undefined,
        structureId,
        exchange: exchange as Exchange,
      });
    }
    out.sort((a, b) => a.dte - b.dte);
    return out;
  }

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return positions.filter((p) => {
      if (alertsOnly && p.status === "OPEN") return false;
      if (!q) return true;
      return (
        p.underlying.toLowerCase().includes(q) ||
        p.strategy?.toLowerCase().includes(q) ||
        p.legs.some((l) => `${l.strike}${l.optionType}`.toLowerCase().includes(q))
      );
    });
  }, [positions, alertsOnly, query]);

  const updatePosition = React.useCallback((id: string, updates: Partial<Position>) => {
    setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, [setPositions]);

  function ColumnPicker() {
    const all = [
      { key: "status", label: "Status" },
      { key: "symbol", label: "Symbol" },
      { key: "structure", label: "Structure" },
      { key: "dte", label: "DTE" },
      { key: "type", label: "Type" },
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
  }, [legMarks]);

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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex w-full max-w-lg flex-col items-center gap-6 rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">
          <div className="space-y-2">
            <p className="text-base font-semibold text-slate-700">Sign in to Supabase</p>
            <p>
              Use your Supabase email and password to unlock program lookups, structure imports, and live mark fetching.
            </p>
          </div>
          <SupabaseLogin />
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
          <button
            className="rounded-xl border px-3 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-60"
            onClick={() => fetchAllMarksForPositions(positions)}
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
          >Clear data</button>
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
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-3 text-left w-10"> </th>
                    {visibleCols.includes("status") && <th className="p-3 text-left">Status</th>}
                    {visibleCols.includes("symbol") && <th className="p-3 text-left">Symbol</th>}
                    {visibleCols.includes("structure") && <th className="p-3 text-left">Structure</th>}
                    {visibleCols.includes("dte") && <th className="p-3 text-left">DTE</th>}
                    {visibleCols.includes("type") && <th className="p-3 text-left">Type</th>}
                    {visibleCols.includes("legs") && <th className="p-3 text-left">Legs</th>}
                    {visibleCols.includes("strategy") && <th className="p-3 text-left">Strategy</th>}
                    {visibleCols.includes("pnl") && <th className="p-3 text-left">PnL</th>}
                    {visibleCols.includes("pnlpct") && <th className="p-3 text-left">PnL %</th>}
                    {visibleCols.includes("delta") && <th className="p-3 text-left">Δ</th>}
                    {visibleCols.includes("gamma") && <th className="p-3 text-left">Γ</th>}
                    {visibleCols.includes("theta") && <th className="p-3 text-left">Θ</th>}
                    {visibleCols.includes("vega") && <th className="p-3 text-left">V</th>}
                    {visibleCols.includes("rho") && <th className="p-3 text-left">ρ</th>}
                    {visibleCols.includes("playbook") && <th className="p-3 text-left">Playbook</th>}
                    <th className="p-3 text-right w-12">
                      <span className="sr-only">Toggle status</span>
                    </th>
                    <th className="p-3 text-right w-12">
                      <span className="sr-only">Save position</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <PositionRow
                      key={p.id}
                      p={p}
                      onUpdate={updatePosition}
                      visibleCols={visibleCols}
                      marks={legMarks}
                      markLoading={markFetch.inProgress}
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
          onConfirm={finalizeImport}
          onCancel={() => setShowReview(null)}
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
