import React from 'react'
import { TxnRow, normalizeSecond } from '../utils'

const autoStructureKey = (row: TxnRow, index: number) => {
  const normalized = normalizeSecond(row.timestamp)
  return normalized === 'NO_TS' ? `NO_TS_${index}` : normalized
}

export function ReviewOverlay({ rows, excludedRows, onConfirm, onCancel, duplicateTradeIds }: {
  rows: TxnRow[];
  excludedRows: TxnRow[];
  duplicateTradeIds?: string[];
  onConfirm: (rows: TxnRow[]) => void;
  onCancel: () => void;
}) {
  const [activeTab, setActiveTab] = React.useState<'included'|'excluded'>('included');
  const [selected, setSelected] = React.useState<boolean[]>(() => rows.map(() => true));

  // per-row structure #, defaulted by same-second grouping (unique fallback when no timestamp is present)
  const autoStructureDefaults = React.useMemo(() => {
    const map = new Map<string, number>();
    let c = 1;
    return rows.map((r, idx) => {
      const k = autoStructureKey(r, idx);
      if (!map.has(k)) map.set(k, c++);
      return map.get(k)!;
    });
  }, [rows]);
  const [structureNumbers, setStructureNumbers] = React.useState<number[]>(autoStructureDefaults);

  // recompute defaults anytime rows change
  React.useEffect(() => {
    setStructureNumbers(autoStructureDefaults);
  }, [autoStructureDefaults]);

  const structures = React.useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, idx) => {
      const k = autoStructureKey(r, idx);
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }, [rows]);

  const toggleAll = (v: boolean) => setSelected(Array(rows.length).fill(v));

  const TableHead = () => (
    <thead className="bg-slate-50 text-slate-600 sticky top-0">
      <tr>
        <th className="p-2"></th>
        <th className="p-2 text-left">Timestamp</th>
        <th className="p-2 text-left">Structure (auto)</th>
        <th className="p-2 text-left">Structure #</th>
        <th className="p-2 text-left">Instrument</th>
        <th className="p-2 text-left">Side</th>
        <th className="p-2 text-left">Amount</th>
        <th className="p-2 text-left">Price</th>
        <th className="p-2 text-left">Fee</th>
        <th className="p-2 text-left">Trade ID</th>
        <th className="p-2 text-left">Order ID</th>
        <th className="p-2 text-left">Info</th>
      </tr>
    </thead>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <h3 className="text-lg font-semibold">Review & Select Lines</h3>
          <div className="ml-auto flex gap-2 text-sm">
            <button className={`px-3 py-1 rounded-lg border ${activeTab==='included' ? 'bg-slate-900 text-white' : ''}`} onClick={() => setActiveTab('included')}>Included ({rows.length})</button>
            <button className={`px-3 py-1 rounded-lg border ${activeTab==='excluded' ? 'bg-slate-900 text-white' : ''}`} onClick={() => setActiveTab('excluded')}>Excluded ({excludedRows.length})</button>
          </div>
        </div>
        {duplicateTradeIds?.length ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm p-3">
            <p className="font-medium">{duplicateTradeIds.length === 1 ? '1 row was hidden because its trade ID already exists in saved fills.' : `${duplicateTradeIds.length} rows were hidden because their trade IDs already exist in saved fills.`}</p>
            <p className="text-xs mt-1">
              Trade IDs: {duplicateTradeIds.slice(0, 5).join(', ')}{duplicateTradeIds.length > 5 ? '…' : ''}
            </p>
          </div>
        ) : null}
        {activeTab==='included' && (
          <>
            <p className="text-sm text-slate-600 mb-3">Uncheck any rows you don’t want to import. Lines with the same second form one “trade structure”.</p>
            <div className="flex gap-2 mb-3 items-center">
              <button className="px-3 py-1 border rounded-lg" onClick={() => setSelected(Array(rows.length).fill(true))}>Select all</button>
              <button className="px-3 py-1 border rounded-lg" onClick={() => setSelected(Array(rows.length).fill(false))}>Select none</button>
              <div className="mx-2 w-px h-5 bg-slate-200" />
              <button
                className="px-3 py-1 border rounded-lg"
                onClick={() => setStructureNumbers(prev => prev.map(() => 1))}
                title="Set every row to structure #1"
              >All → 1</button>
              <button
                className="px-3 py-1 border rounded-lg"
                onClick={() => {
                  const map = new Map<string, number>();
                  let c = 1;
                  setStructureNumbers(rows.map((r, idx) => {
                    const k = autoStructureKey(r, idx);
                    if (!map.has(k)) map.set(k, c++);
                    return map.get(k)!;
                  }));
                }}
                title="Group by same-second timestamp"
              >Auto by time</button>
            </div>
            <div className="max-h-[60vh] overflow-auto border rounded-xl">
              <table className="min-w-full text-sm">
                <TableHead />
                <tbody>
                  {rows.map((r, i) => {
                    const structure = normalizeSecond(r.timestamp);
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-2"><input type="checkbox" checked={selected[i]} onChange={(e) => setSelected((prev) => { const cp = [...prev]; cp[i] = e.target.checked; return cp; })} /></td>
                        <td className="p-2">{r.timestamp || '—'}</td>
                        <td className="p-2">{structure}</td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={1}
                            className="border rounded-lg px-2 py-1 text-sm w-20"
                            value={structureNumbers[i] ?? 1}
                            onChange={(e) => setStructureNumbers((prev) => {
                              const cp = [...prev];
                              const v = Number(e.target.value);
                              cp[i] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 1;
                              return cp;
                            })}
                          />
                        </td>
                        <td className="p-2">{r.instrument}</td>
                        <td className="p-2">{(r.action ? r.action + ' ' : '') + r.side}</td>
                        <td className="p-2">{r.amount}</td>
                        <td className="p-2">{r.price}</td>
                        <td className="p-2">{r.fee ?? 0}</td>
                        <td className="p-2">{r.trade_id || '—'}</td>
                        <td className="p-2">{r.order_id || '—'}</td>
                        <td className="p-2">{r.info || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex gap-3 justify-end">
              <button onClick={onCancel} className="px-4 py-2 rounded-xl border">Back</button>
              <button onClick={() => {
                const idx = rows.map((_, i) => i).filter((i) => selected[i]);
                const payload = idx.map((i) => ({ ...rows[i], structureId: String(structureNumbers[i] ?? 1)}));
                onConfirm(payload);
              }}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white">Import selected ({selected.filter(Boolean).length})</button>
            </div>
          </>
        )}
        {activeTab==='excluded' && (
          <>
            <p className="text-sm text-slate-600 mb-3">These rows were auto-excluded because their instruments aren’t recognized as options (format: UNDERLYING-DDMONYY-STRIKE-C|P). Review-only.</p>
            <div className="max-h-[60vh] overflow-auto border rounded-xl">
              <table className="min-w-full text-sm">
                <TableHead />
                <tbody>
                  {excludedRows.map((r, i) => {
                    const structure = normalizeSecond(r.timestamp);
                    return (
                      <tr key={i} className="border-t opacity-70">
                        <td className="p-2"><input type="checkbox" disabled checked={false} readOnly /></td>
                        <td className="p-2">{r.timestamp || '—'}</td>
                        <td className="p-2">{structure}</td>
                        <td className="p-2">—</td>
                        <td className="p-2">{r.instrument}</td>
                        <td className="p-2">{(r.action ? r.action + ' ' : '') + r.side}</td>
                        <td className="p-2">{r.amount}</td>
                        <td className="p-2">{r.price}</td>
                        <td className="p-2">{r.fee ?? 0}</td>
                        <td className="p-2">{r.trade_id || '—'}</td>
                        <td className="p-2">{r.order_id || '—'}</td>
                        <td className="p-2">{r.info || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex gap-3 justify-end">
              <button onClick={onCancel} className="px-4 py-2 rounded-xl border">Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
