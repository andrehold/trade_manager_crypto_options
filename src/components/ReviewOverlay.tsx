import React from 'react'
import { TxnRow, normalizeSecond } from '../utils'

export type ReviewStructureOption = { value: string; label: string }

const autoStructureKey = (row: TxnRow, index: number) => {
  const normalized = normalizeSecond(row.timestamp)
  return normalized === 'NO_TS' ? `NO_TS_${index}` : normalized
}

type AllocationEntry = {
  structureId: string | null;
  qty: number;
};

type ReviewOverlayProps = {
  rows: TxnRow[];
  excludedRows: TxnRow[];
  duplicateTradeIds?: string[];
  duplicateOrderIds?: string[];
  importHistorical?: boolean;
  allowAllocations?: boolean;
  onConfirm: (rows: TxnRow[], unprocessedRows: TxnRow[]) => void | Promise<void>;
  onCancel: () => void;
  availableStructures?: ReviewStructureOption[];
}

export function ReviewOverlay(props: ReviewOverlayProps) {
  const {
    rows,
    excludedRows,
    onConfirm,
    onCancel,
    duplicateTradeIds,
    duplicateOrderIds,
    importHistorical,
    allowAllocations,
  } = props
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
  const [allocations, setAllocations] = React.useState<AllocationEntry[][]>(() => rows.map(() => []));

  // recompute defaults anytime rows change
  React.useEffect(() => {
    setStructureNumbers(autoStructureDefaults);
    setLinkedStructures(rows.map(() => null));
    setNotProcessed(rows.map(() => false));
    setAllocations(rows.map(() => []));
  }, [autoStructureDefaults, rows]);

  React.useEffect(() => {
    console.log('[ReviewOverlay] Opened with rows', {
      rows,
      excludedRows,
      duplicateTradeIds,
      duplicateOrderIds,
    });
  }, [rows, excludedRows, duplicateTradeIds, duplicateOrderIds]);

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

  const describeRow = (row: TxnRow) => row.trade_id || row.order_id || row.instrument || 'trade row';

  const handleImport = async () => {
    if (importing) return;
    const idx = rows.map((_, i) => i).filter((i) => selected[i]);
    const allocationErrors: string[] = [];
    const payload: TxnRow[] = [];

    idx
      .filter((i) => !notProcessed[i])
      .forEach((i) => {
        const row = rows[i];
        const rowQty = Math.abs(row.amount ?? 0);
        const rowAllocations = allowAllocations ? allocations[i] ?? [] : [];

        if (allowAllocations && rowAllocations.length > 0) {
          const cleanedAllocations = rowAllocations.map((entry) => ({
            structureId: entry.structureId?.trim() ?? '',
            qty: Number(entry.qty),
          }));

          const invalidAllocation = cleanedAllocations.some(
            (entry) => !entry.structureId || !Number.isFinite(entry.qty) || entry.qty <= 0,
          );

          if (!Number.isFinite(rowQty) || rowQty <= 0) {
            allocationErrors.push(`Allocation row "${describeRow(row)}" is missing a valid quantity.`);
            return;
          }

          const totalAllocated = cleanedAllocations.reduce((sum, entry) => sum + entry.qty, 0);
          if (invalidAllocation) {
            allocationErrors.push(`Allocation row "${describeRow(row)}" has a missing structure or quantity.`);
            return;
          }
          if (Math.abs(totalAllocated - rowQty) > Number.EPSILON) {
            allocationErrors.push(
              `Allocation row "${describeRow(row)}" must total ${rowQty} (currently ${totalAllocated}).`,
            );
            return;
          }

          cleanedAllocations.forEach((entry) => {
            payload.push({
              ...row,
              amount: entry.qty,
              structureId: entry.structureId,
              linkedStructureId: entry.structureId,
            });
          });
          return;
        }

        const selectedStructureId = linkedStructures[i] ?? undefined;
        const fallbackStructure = String(structureNumbers[i] ?? 1);
        const normalizedLinkedId = selectedStructureId && selectedStructureId.length ? selectedStructureId : undefined;
        payload.push({
          ...row,
          structureId: normalizedLinkedId ?? fallbackStructure,
          linkedStructureId: normalizedLinkedId,
        });
      });

    if (allocationErrors.length > 0) {
      alert(`Fix allocation rows before importing:\n${allocationErrors.join('\n')}`);
      return;
    }

    const unprocessedRows = idx
      .filter((i) => notProcessed[i])
      .map((i) => rows[i]);

    if (!payload.length && !unprocessedRows.length) return;

    try {
      setImporting(true);
      console.log('[ReviewOverlay] Submitting import selection', {
        payload,
        unprocessedRows,
      });
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
        {importHistorical ? (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-sm p-3">
            <p className="font-medium">
              Historical mode is enabled. Duplicate trade or order IDs may already exist in your saved imports.
            </p>
          </div>
        ) : null}
        {(duplicateTradeIds?.length || duplicateOrderIds?.length) ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm p-3">
            <p className="font-medium">
              {allowAllocations
                ? 'Trade/order IDs already exist in saved fills or unprocessed trades. Allocation mode keeps these rows so you can split the execution across structures.'
                : (duplicateTradeIds?.length ?? 0) + (duplicateOrderIds?.length ?? 0) === 1
                ? '1 row was hidden because its trade or order ID already exists in saved fills or unprocessed trades.'
                : `${(duplicateTradeIds?.length ?? 0) + (duplicateOrderIds?.length ?? 0)} rows were hidden because their trade or order IDs already exist in saved fills or unprocessed trades.`}
            </p>
            <div className="text-xs mt-1 space-y-1">
              {duplicateTradeIds?.length ? (
                <p>
                  Trade IDs: {duplicateTradeIds.slice(0, 5).join(', ')}{duplicateTradeIds.length > 5 ? '…' : ''}
                </p>
              ) : null}
              {duplicateOrderIds?.length ? (
                <p>
                  Order IDs: {duplicateOrderIds.slice(0, 5).join(', ')}{duplicateOrderIds.length > 5 ? '…' : ''}
                </p>
              ) : null}
            </div>
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
                    const rowAllocations = allocations[i] ?? [];
                    const hasAllocations = allowAllocations && rowAllocations.length > 0;
                    const rowQty = Math.abs(r.amount ?? 0);
                    const totalAllocated = rowAllocations.reduce((sum, entry) => sum + (Number(entry.qty) || 0), 0);
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
                              value={hasAllocations ? '' : selectedStructureId ?? ''}
                              onChange={(e) =>
                                setLinkedStructures((prev) => {
                                  const cp = [...prev];
                                  const nextValue = e.target.value;
                                  cp[i] = nextValue.length ? nextValue : null;
                                  return cp;
                                })
                              }
                              disabled={!hasSavedStructures || isUnprocessed || hasAllocations}
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
                                : hasAllocations
                                ? 'Allocation mode active. Structure # input disabled.'
                                : selectedStructureId
                                ? `Linked to ${selectedStructureLabel}. Structure # input disabled.`
                                : hasSavedStructures
                                ? 'Auto grouping until you choose a saved structure.'
                                : 'No saved structures available for this client.'}
                            </span>
                            {allowAllocations && !isUnprocessed ? (
                              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                                <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
                                  <span>Allocations (split qty across structures)</span>
                                  <button
                                    type="button"
                                    className="text-xs text-slate-700 hover:text-slate-900"
                                    onClick={() => {
                                      setAllocations((prev) => {
                                        const cp = [...prev];
                                        const next = [...(cp[i] ?? [])];
                                        next.push({ structureId: null, qty: 0 });
                                        cp[i] = next;
                                        return cp;
                                      });
                                      setLinkedStructures((prev) => {
                                        const cp = [...prev];
                                        cp[i] = null;
                                        return cp;
                                      });
                                    }}
                                    disabled={!hasSavedStructures}
                                  >
                                    + Add allocation
                                  </button>
                                </div>
                                {hasSavedStructures ? (
                                  rowAllocations.length ? (
                                    <div className="space-y-2">
                                      {rowAllocations.map((entry, allocIndex) => (
                                        <div key={`${i}-alloc-${allocIndex}`} className="flex items-center gap-2">
                                          <select
                                            className="border rounded-lg px-2 py-1 text-xs bg-white flex-1"
                                            value={entry.structureId ?? ''}
                                            onChange={(e) =>
                                              setAllocations((prev) => {
                                                const cp = [...prev];
                                                const next = [...(cp[i] ?? [])];
                                                next[allocIndex] = {
                                                  ...next[allocIndex],
                                                  structureId: e.target.value || null,
                                                };
                                                cp[i] = next;
                                                return cp;
                                              })
                                            }
                                          >
                                            <option value="">Select structure</option>
                                            {availableStructures.map((option) => (
                                              <option key={option.value} value={option.value}>
                                                {option.label}
                                              </option>
                                            ))}
                                          </select>
                                          <input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            className="border rounded-lg px-2 py-1 text-xs w-24"
                                            value={entry.qty}
                                            onChange={(e) =>
                                              setAllocations((prev) => {
                                                const cp = [...prev];
                                                const next = [...(cp[i] ?? [])];
                                                const nextQty = Number(e.target.value);
                                                next[allocIndex] = {
                                                  ...next[allocIndex],
                                                  qty: Number.isFinite(nextQty) ? nextQty : 0,
                                                };
                                                cp[i] = next;
                                                return cp;
                                              })
                                            }
                                          />
                                          <button
                                            type="button"
                                            className="text-xs text-rose-600 hover:text-rose-700"
                                            onClick={() =>
                                              setAllocations((prev) => {
                                                const cp = [...prev];
                                                const next = [...(cp[i] ?? [])];
                                                next.splice(allocIndex, 1);
                                                cp[i] = next;
                                                return cp;
                                              })
                                            }
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-500">No allocations added yet.</div>
                                  )
                                ) : (
                                  <div className="text-xs text-slate-500">
                                    No saved structures available for allocation.
                                  </div>
                                )}
                                {rowAllocations.length ? (
                                  <div
                                    className={`mt-2 text-xs ${
                                      Math.abs(totalAllocated - rowQty) <= Number.EPSILON
                                        ? 'text-emerald-600'
                                        : 'text-amber-600'
                                    }`}
                                  >
                                    Allocated {totalAllocated} / {rowQty}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
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
