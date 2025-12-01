import React from 'react'
import { TxnRow, normalizeSecond } from '../utils'

export type ReviewStructureOption = { value: string; label: string }

const autoStructureKey = (row: TxnRow, index: number) => {
  const normalized = normalizeSecond(row.timestamp)
  return normalized === 'NO_TS' ? `NO_TS_${index}` : normalized
}

type ReviewOverlayProps = {
  rows: TxnRow[];
  excludedRows: TxnRow[];
  duplicateTradeIds?: string[];
  onConfirm: (rows: TxnRow[], unprocessedRows: TxnRow[]) => void | Promise<void>;
  onCancel: () => void;
  availableStructures?: ReviewStructureOption[];
}

export function ReviewOverlay(props: ReviewOverlayProps) {
  const { rows, excludedRows, onConfirm, onCancel, duplicateTradeIds } = props
  const [activeTab, setActiveTab] = React.useState<'included'|'excluded'>('included');
  const [selected, setSelected] = React.useState<boolean[]>(() => rows.map(() => true));
  const [notProcessed, setNotProcessed] = React.useState<boolean[]>(() => rows.map(() => false));
  const [importing, setImporting] = React.useState(false);

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
  const [linkedStructures, setLinkedStructures] = React.useState<(string | null)[]>(() => rows.map(() => null));

  // recompute defaults anytime rows change
  React.useEffect(() => {
    setStructureNumbers(autoStructureDefaults);
    setLinkedStructures(rows.map(() => null));
    setNotProcessed(rows.map(() => false));
  }, [autoStructureDefaults, rows]);

  const availableStructures = React.useMemo(
    () => props.availableStructures ?? [],
    [props.availableStructures],
  );

  const availableStructureMap = React.useMemo(() => {
    const map = new Map<string, ReviewStructureOption>();
    for (const option of availableStructures) {
      map.set(option.value, option);
    }
    return map;
  }, [availableStructures]);

  React.useEffect(() => {
    setLinkedStructures((prev) =>
      prev.map((value) => (value && availableStructureMap.has(value) ? value : null)),
    );
  }, [availableStructureMap]);

  const toggleAll = (v: boolean) => {
    setSelected(Array(rows.length).fill(v));
    setNotProcessed((prev) => prev.map((value, idx) => (v ? value : false)));
  };
  const selectedCount = selected.filter(Boolean).length;
  const selectedUnprocessed = selected.filter((v, idx) => v && notProcessed[idx]).length;
  const selectedForImport = selected.filter((v, idx) => v && !notProcessed[idx]).length;

  const handleImport = async () => {
    if (importing) return;
    const idx = rows.map((_, i) => i).filter((i) => selected[i]);
    const payload = idx
      .filter((i) => !notProcessed[i])
      .map((i) => {
        const selectedStructureId = linkedStructures[i] ?? undefined;
        const fallbackStructure = String(structureNumbers[i] ?? 1);
        const normalizedLinkedId = selectedStructureId && selectedStructureId.length ? selectedStructureId : undefined;
        return {
          ...rows[i],
          structureId: normalizedLinkedId ?? fallbackStructure,
          linkedStructureId: normalizedLinkedId,
        };
      });

    const unprocessedRows = idx
      .filter((i) => notProcessed[i])
      .map((i) => rows[i]);

    if (!payload.length && !unprocessedRows.length) return;

    try {
      setImporting(true);
      await onConfirm(payload, unprocessedRows);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import trades.';
      alert(message);
    } finally {
      setImporting(false);
    }
  };

  const TableHead = () => (
    <thead className="bg-slate-50 text-slate-600 sticky top-0">
      <tr>
        <th className="p-2">Import</th>
        <th className="p-2 text-left">Unprocessed</th>
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

  const SideCell = ({ action, side }: { action?: TxnRow['action']; side: TxnRow['side'] }) => {
    const chipClasses =
      action === 'open'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : action === 'close'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';

    return (
      <div className="flex items-center gap-2">
        {action ? (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${chipClasses}`}
          >
            {action}
          </span>
        ) : null}
        <span className="capitalize">{side}</span>
      </div>
    );
  };

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
              <button className="px-3 py-1 border rounded-lg" onClick={() => toggleAll(true)}>Select all</button>
              <button className="px-3 py-1 border rounded-lg" onClick={() => toggleAll(false)}>Select none</button>
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
                    const selectedStructureId = linkedStructures[i];
                    const selectedStructureLabel = selectedStructureId
                      ? availableStructureMap.get(selectedStructureId)?.label ?? selectedStructureId
                      : null;
                    const hasSavedStructures = availableStructures.length > 0;
                    const isUnprocessed = notProcessed[i];
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-2 align-top">
                          <input
                            type="checkbox"
                            checked={selected[i]}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const cp = [...prev];
                                cp[i] = e.target.checked;
                                if (!e.target.checked) {
                                  setNotProcessed((prevFlag) => {
                                    const next = [...prevFlag];
                                    next[i] = false;
                                    return next;
                                  });
                                }
                                return cp;
                              })
                            }
                          />
                        </td>
                        <td className="p-2 align-top">
                          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={isUnprocessed}
                              onChange={(e) =>
                                setNotProcessed((prev) => {
                                  const cp = [...prev];
                                  cp[i] = e.target.checked;
                                  return cp;
                                })
                              }
                              disabled={!selected[i]}
                            />
                            <span>Mark unprocessed</span>
                          </label>
                        </td>
                        <td className="p-2">{r.timestamp || '—'}</td>
                        <td className="p-2 align-top">
                          <div className="flex flex-col gap-1">
                            <select
                              className="border rounded-lg px-2 py-1 text-sm bg-white disabled:bg-slate-50"
                              value={selectedStructureId ?? ''}
                              onChange={(e) =>
                                setLinkedStructures((prev) => {
                                  const cp = [...prev];
                                  const nextValue = e.target.value;
                                  cp[i] = nextValue.length ? nextValue : null;
                                  return cp;
                                })
                              }
                              disabled={!hasSavedStructures || isUnprocessed}
                            >
                              <option value="">{`Auto • ${structure}`}</option>
                              {availableStructures.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <span className={`text-xs ${selectedStructureId ? 'text-emerald-600' : 'text-slate-500'}`}>
                              {isUnprocessed
                                ? 'Will be saved as unprocessed and excluded from future imports.'
                                : selectedStructureId
                                ? `Linked to ${selectedStructureLabel}. Structure # input disabled.`
                                : hasSavedStructures
                                ? 'Auto grouping until you choose a saved structure.'
                                : 'No saved structures available for this client.'}
                            </span>
                          </div>
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={1}
                            className={`border rounded-lg px-2 py-1 text-sm w-20 ${selectedStructureId || isUnprocessed ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
                            value={structureNumbers[i] ?? 1}
                            onChange={(e) => setStructureNumbers((prev) => {
                              const cp = [...prev];
                              const v = Number(e.target.value);
                              cp[i] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 1;
                              return cp;
                            })}
                            disabled={Boolean(selectedStructureId) || isUnprocessed}
                            title={selectedStructureId ? 'Structure number comes from the linked saved structure.' : undefined}
                          />
                        </td>
                        <td className="p-2">{r.instrument}</td>
                        <td className="p-2"><SideCell action={r.action} side={r.side} /></td>
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
              <button
                onClick={handleImport}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
                disabled={importing || selectedCount === 0}
              >
                {importing
                  ? 'Importing…'
                  : `Save selected (import ${selectedForImport}, unprocessed ${selectedUnprocessed})`}
              </button>
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
                        <td className="p-2 text-xs text-slate-500">—</td>
                        <td className="p-2">{r.timestamp || '—'}</td>
                        <td className="p-2">{structure}</td>
                        <td className="p-2">—</td>
                        <td className="p-2">{r.instrument}</td>
                        <td className="p-2"><SideCell action={r.action} side={r.side} /></td>
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
