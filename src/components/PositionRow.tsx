import React from 'react'
import { Position, fmtPremium, fmtNumber, toCoincallSymbol, toDeribitInstrument, positionUnrealizedPnL, legUnrealizedPnL, positionGreeks, fmtGreek } from '../utils'
import { NumberCell } from './NumberCell'

type MarkMap = Record<string, { price: number | null; multiplier: number | null }>;

function CellSpinner() {
  return (
    <svg className="animate-spin h-4 w-4 inline-block text-slate-400" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10"
              stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function PositionRow({ p, onUpdate, visibleCols, marks, markLoading}: { p: Position; onUpdate: (id: string, updates: Partial<Position>) => void; visibleCols: string[]; marks?: Record<string, { price: number | null; multiplier: number | null }>; markLoading?: boolean;}) {
  const [open, setOpen] = React.useState(false);
  const statusTone = p.status === "OPEN" ? "success" : p.status === "ATTENTION" ? "warning" : "destructive";

  // Compute unrealized for this position using current marks
  const posUnrealized = React.useMemo(
    () => (marks ? positionUnrealizedPnL(p, marks, toCoincallSymbol) : 0),
    [marks, p]
  );

  // Total PnL = realized + unrealized
  const posTotalPnl = p.realizedPnl + posUnrealized;

  const kitGreeks = React.useMemo(
    () => (marks ? positionGreeks(p, marks, toCoincallSymbol) : { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 }),
    [marks, p]
  );

  return (
    <>
      <tr className="border-b last:border-0 hover:bg-slate-50">
        <td className="p-3 align-top">
          <button onClick={() => setOpen((v) => !v)} className="text-slate-500">{open ? "▾" : "▸"}</button>
        </td>
        {visibleCols.includes("status") && (
          <td className="p-3 align-top"><div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${statusTone === 'success' ? 'bg-emerald-500' : statusTone === 'warning' ? 'bg-amber-500' : 'bg-rose-500'}`} />
            <span className="text-slate-700 text-sm">{p.status}</span>
          </div></td>
        )}
        {visibleCols.includes("symbol") && <td className="p-3 align-top font-medium text-slate-800">{p.underlying}</td>}
        {visibleCols.includes("kit") && <td className="p-3 align-top">{p.kitId}</td>}
        {visibleCols.includes("dte") && <td className="p-3 align-top">{p.dte}</td>}
        {visibleCols.includes("type") && <td className="p-3 align-top">{p.type}</td>}
        {visibleCols.includes("legs") && <td className="p-3 align-top">{p.legsCount}</td>}
        {visibleCols.includes("strategy") && (
          <td className="p-3 align-top">
            <input
              value={p.strategy || ""}
              onChange={(e) => onUpdate(p.id, { strategy: e.target.value })}
              placeholder="e.g., Iron Condor"
              className="border rounded-lg px-2 py-1 text-sm w-40"
            />
          </td>
        )}
        {visibleCols.includes("pnl") && (
          <td className={`p-3 align-top ${posTotalPnl < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {fmtPremium(posTotalPnl, p.underlying)}
            <div className="text-xs text-slate-500">
              <span title="Realized">{fmtPremium(p.realizedPnl, p.underlying)}</span>
              {' + '}
              <span title="Unrealized (from Marks">{fmtPremium(posUnrealized, p.underlying)}</span>
            </div>
          </td>
        )}
        {visibleCols.includes("pnlpct") && <td className={`p-3 align-top ${p.pnlPct && p.pnlPct < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{p.pnlPct == null ? '—' : `${p.pnlPct.toFixed(2)}%`}</td>}
        {visibleCols.includes("delta") && <td className="p-3 align-top">{fmtNumber(kitGreeks.delta)}</td>}
        {visibleCols.includes("gamma") && <td className="p-3 align-top">{fmtGreek(kitGreeks.gamma, 6)}</td>}
        {visibleCols.includes("theta") && <td className="p-3 align-top">{fmtNumber(kitGreeks.theta)}</td>}
        {visibleCols.includes("vega") && <td className="p-3 align-top">{fmtNumber(kitGreeks.vega)}</td>}
        {visibleCols.includes("rho") && <td className="p-3 align-top">{fmtNumber(kitGreeks.rho)}</td>}
        {visibleCols.includes("playbook") && (
          <td className="p-3 align-top">
            <input
              value={p.playbook || ""}
              onChange={(e) => onUpdate(p.id, { playbook: e.target.value })}
              placeholder="https://…"
              className="border rounded-lg px-2 py-1 text-sm w-44"
            />
          </td>
        )}
        <td className="p-3 align-top text-right">
          <button onClick={() => onUpdate(p.id, { status: p.status === 'OPEN' ? 'ATTENTION' as any : p.status === 'ATTENTION' ? 'ALERT' as any : 'OPEN' as any })} className="text-slate-500">⋯</button>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td />
          <td colSpan={20} className="p-3">
            <div className="grid md:grid-cols-3 gap-3">
              <div className="bg-white border rounded-xl p-3">
                <div className="text-xs text-slate-500">Underlying</div>
                <div className="text-sm font-medium">{p.underlying}</div>
                <div className="mt-2 text-xs text-slate-500">Expiry</div>
                <div className="text-sm font-medium">{p.expiryISO} ({p.dte} DTE)</div>
                <div className="mt-2 text-xs text-slate-500">Exchange</div>
                <div className="text-sm font-medium capitalize">{p.exchange ?? '—'}</div>
                <div className="mt-2 text-xs text-slate-500">Net Premium</div>
                <div className="text-sm font-medium">{fmtPremium(p.netPremium, p.underlying)}</div>
              </div>
              <div className="bg-white border rounded-xl p-3 md:col-span-2">
                <div className="text-xs text-slate-500 mb-2">Legs</div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="text-left p-2">Leg</th>
                        <th className="text-left p-2">Net Qty</th>
                        <th className="text-left p-2">Realized PnL</th>
                        <th className="text-left p-2">Net Premium</th>
                        <th className="text-left p-2">Mark</th>
                        <th className="text-left p-2">uPnL</th>
                        <th className="text-left p-2">Open Lots</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.legs.map((l) => (
                        <React.Fragment key={l.key}>
                          {/* Aggregated leg row (unchanged) */}
                          <tr className="border-t">
                            <td className="p-2">{l.strike} {l.optionType}</td>
                            <td className="p-2">{l.qtyNet}</td>
                            <td className={`p-2 ${l.realizedPnl < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {fmtPremium(l.realizedPnl, p.underlying)}
                            </td>
                            <td className="p-2">{fmtPremium(l.netPremium, p.underlying)}</td>
                            <td className="p-2">
                              {(() => {
                                let k: string | null = null;
                                if (p.exchange === 'coincall') {
                                  const sym = toCoincallSymbol(p.underlying, p.expiryISO, l.strike, l.optionType);
                                  k = `coincall:${sym}`;
                                } else if (p.exchange === 'deribit') {
                                  const instr = toDeribitInstrument(p.underlying, p.expiryISO, l.strike, l.optionType);
                                  k = `deribit:${instr}`;
                                } else return '—';
                                const v = marks?.[k]?.price ?? null;
                                if (v == null) return markLoading ? <CellSpinner /> : '—';
                                return v.toLocaleString(undefined, { maximumFractionDigits: 8 });
                              })()}
                            </td>
                            <td className="p-2 text-right">
                              {(() => {
                                let k: string | null = null;
                                if (p.exchange === 'coincall') {
                                  const sym = toCoincallSymbol(p.underlying, p.expiryISO, l.strike, l.optionType);
                                  k = `coincall:${sym}`;
                                } else if (p.exchange === 'deribit') {
                                  const instr = toDeribitInstrument(p.underlying, p.expiryISO, l.strike, l.optionType);
                                  k = `deribit:${instr}`;
                                } else return '—';
                                const info = k ? marks?.[k] : undefined;
                                if (!info || info.price == null) return markLoading ? <CellSpinner /> : '—';
                                const mult = (p.exchange === 'coincall') ? info.multiplier : 1;
                                const u = legUnrealizedPnL(l, info.price, mult);
                                return (
                                  <span className={u < 0 ? 'text-rose-600' : 'text-emerald-600'}>
                                    {fmtPremium(u, p.underlying)}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="p-2">
                              {l.openLots.length
                                ? l.openLots.map((o, i) => (
                                    <span key={i} className="inline-block mr-2">
                                      {o.sign === 1 ? 'Long' : 'Short'} {o.qty}@{fmtNumber(o.price)}
                                    </span>
                                  ))
                                : '—'}
                            </td>
                          </tr>

                          {/* NEW: individual trade pills with a Kit chip */}
                          <tr className="border-t-0">
                          {/* legs table has 6 columns -> span across all */}
                          <td colSpan={7} className="p-2 text-left">
                              <div className="flex flex-wrap gap-2">
                                {l.trades?.map((t, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center gap-2 rounded-full border px-2 py-1 bg-slate-50"
                                    title={t.timestamp || ''}
                                  >
                                    {/* Kit chip */}
                                    <span className="text-[10px] rounded-full px-2 py-[2px] border bg-white text-slate-700">
                                      Kit #{t.kitId ?? '—'}
                                      {String(t.exchange ?? p.exchange ?? '').toUpperCase() || '—'}
                                    </span>

                                    {/* time (hh:mm:ss) */}
                                    <span className="text-[11px] text-slate-500">
                                      {(t.timestamp || '').slice(11, 19) || '—'}
                                    </span>

                                    {/* action/side + amount@price */}
                                    <span className="text-xs text-slate-800">
                                      {(t.action ? t.action + ' ' : '') + t.side} {t.amount}@{fmtNumber(t.price)}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
