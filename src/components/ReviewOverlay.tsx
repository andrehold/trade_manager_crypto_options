import React from 'react'
import { Exchange, TxnRow, formatInstrumentLabel, normalizeSecond, parseInstrumentByExchange } from '../utils'

export type ReviewStructureOption = { value: string; label: string; legInstrumentKeys?: string[] }

function SideCell({ action, side }: { action?: TxnRow['action']; side: TxnRow['side'] }) {
  const chipClasses =
    action === 'open'
      ? 'banner-success'
      : action === 'close'
      ? 'banner-danger'
      : 'bg-surface-page text-subtle border-border-default';

  return (
    <div className="flex items-center gap-2">
      {action ? (
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 type-micro font-semibold uppercase tracking-wide ${chipClasses}`}
        >
          {action}
        </span>
      ) : null}
      <span className="capitalize">{side}</span>
    </div>
  );
}

const autoStructureKey = (row: TxnRow, index: number) => {
  const normalized = normalizeSecond(row.timestamp)
  return normalized === 'NO_TS' ? `NO_TS_${index}` : normalized
}

const getRowInstrumentKey = (row: TxnRow) => {
  const exchange = (row.exchange ?? 'deribit') as Exchange;
  const parsed = parseInstrumentByExchange(exchange, row.instrument);
  if (!parsed) return null;
  return formatInstrumentLabel(parsed.underlying, parsed.expiryISO, parsed.strike, parsed.optionType);
};

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

type ReviewRowProps = {
  i: number;
  r: TxnRow;
  structure: string;
  isSelected: boolean;
  isUnprocessed: boolean;
  structureNumber: number;
  selectedStructureId: string | null;
  selectedStructureLabel: string | null;
  rowAvailableStructures: ReviewStructureOption[];
  hasSavedStructures: boolean;
  isCloseAction: boolean;
  rowInstrumentKey: string | null;
  rowAllocations: AllocationEntry[];
  allowAllocations?: boolean;
  onToggleSelected: (i: number, checked: boolean) => void;
  onToggleNotProcessed: (i: number, checked: boolean) => void;
  onChangeStructureNumber: (i: number, v: number) => void;
  onChangeLinkedStructure: (i: number, value: string) => void;
  onAddAllocation: (i: number) => void;
  onChangeAllocationStructure: (i: number, allocIndex: number, value: string) => void;
  onChangeAllocationQty: (i: number, allocIndex: number, qty: number) => void;
  onRemoveAllocation: (i: number, allocIndex: number) => void;
};

const ReviewRow = React.memo(function ReviewRow({
  i, r, structure, isSelected, isUnprocessed, structureNumber,
  selectedStructureId, selectedStructureLabel, rowAvailableStructures,
  hasSavedStructures, isCloseAction, rowInstrumentKey, rowAllocations, allowAllocations,
  onToggleSelected, onToggleNotProcessed, onChangeStructureNumber,
  onChangeLinkedStructure, onAddAllocation, onChangeAllocationStructure,
  onChangeAllocationQty, onRemoveAllocation,
}: ReviewRowProps) {
  const hasAllocations = allowAllocations && rowAllocations.length > 0;
  const rowQty = Math.abs(r.amount ?? 0);
  const totalAllocated = rowAllocations.reduce((sum, entry) => sum + (Number(entry.qty) || 0), 0);

  return (
    <tr key={i} className="border-t">
      <td className="p-2 align-top">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onToggleSelected(i, e.target.checked)}
        />
      </td>
      <td className="p-2 align-top">
        <label className="inline-flex items-center gap-2 type-caption text-body">
          <input
            type="checkbox"
            checked={isUnprocessed}
            onChange={(e) => onToggleNotProcessed(i, e.target.checked)}
            disabled={!isSelected}
          />
          <span>Mark unprocessed</span>
        </label>
      </td>
      <td className="p-2">{r.timestamp || '—'}</td>
      <td className="p-2 align-top">
        <div className="flex flex-col gap-1">
          <select
            className="border rounded-lg px-2 py-1 type-subhead bg-surface-card disabled:bg-surface-page"
            value={hasAllocations ? '' : selectedStructureId ?? ''}
            onChange={(e) => onChangeLinkedStructure(i, e.target.value)}
            disabled={!hasSavedStructures || isUnprocessed || hasAllocations}
          >
            <option value="">{`Auto • ${structure}`}</option>
            {rowAvailableStructures.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className={`type-caption ${selectedStructureId ? 'text-status-success-text' : 'text-muted'}`}>
            {isUnprocessed
              ? 'Will be saved as unprocessed and excluded from future imports.'
              : hasAllocations
              ? 'Allocation mode active. Structure # input disabled.'
              : selectedStructureId
              ? `Linked to ${selectedStructureLabel}. Structure # input disabled.`
              : hasSavedStructures
              ? isCloseAction && rowInstrumentKey
                ? 'Showing saved structures that match this closing leg.'
                : 'Auto grouping until you choose a saved structure.'
              : isCloseAction && rowInstrumentKey
              ? 'No saved structures match this closing leg.'
              : 'No saved structures available for this client.'}
          </span>
          {allowAllocations && !isUnprocessed ? (
            <div className="mt-2 rounded-lg border border-border-default bg-surface-page p-2">
              <div className="flex items-center justify-between type-caption text-subtle mb-2">
                <span>Allocations (split qty across structures)</span>
                <button
                  type="button"
                  className="type-caption text-body hover:text-heading"
                  onClick={() => onAddAllocation(i)}
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
                          className="border rounded-lg px-2 py-1 type-caption bg-surface-card flex-1"
                          value={entry.structureId ?? ''}
                          onChange={(e) => onChangeAllocationStructure(i, allocIndex, e.target.value)}
                        >
                          <option value="">Select structure</option>
                          {rowAvailableStructures.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="border rounded-lg px-2 py-1 type-caption w-24"
                          value={entry.qty}
                          onChange={(e) => onChangeAllocationQty(i, allocIndex, Number(e.target.value))}
                        />
                        <button
                          type="button"
                          className="type-caption text-status-danger hover:text-status-danger/80"
                          onClick={() => onRemoveAllocation(i, allocIndex)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="type-caption text-muted">No allocations added yet.</div>
                )
              ) : (
                <div className="type-caption text-muted">
                  No saved structures available for allocation.
                </div>
              )}
              {rowAllocations.length ? (
                <div
                  className={`mt-2 type-caption ${
                    Math.abs(totalAllocated - rowQty) <= Number.EPSILON
                      ? 'text-status-success-text'
                      : 'text-status-warning-text'
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
          className={`border rounded-lg px-2 py-1 type-subhead w-20 ${selectedStructureId || isUnprocessed ? 'bg-surface-page text-faint cursor-not-allowed' : ''}`}
          value={structureNumber ?? 1}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChangeStructureNumber(i, Number.isFinite(v) && v > 0 ? Math.floor(v) : 1);
          }}
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
});

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

  const availableStructureIdsByRow = React.useMemo(
    () =>
      rows.map((row) => {
        if (row.action !== 'close') return null;
        const rowKey = getRowInstrumentKey(row);
        if (!rowKey) return null;
        const allowedIds = availableStructures
          .filter((option) => option.legInstrumentKeys?.includes(rowKey))
          .map((option) => option.value);
        return new Set(allowedIds);
      }),
    [availableStructures, rows],
  );

  React.useEffect(() => {
    setLinkedStructures((prev) =>
      prev.map((value) => (value && availableStructureMap.has(value) ? value : null)),
    );
  }, [availableStructureMap]);

  React.useEffect(() => {
    setLinkedStructures((prev) =>
      prev.map((value, index) => {
        const allowedIds = availableStructureIdsByRow[index];
        if (!allowedIds || !value) return value;
        return allowedIds.has(value) ? value : null;
      }),
    );
  }, [availableStructureIdsByRow]);

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
      await onConfirm(payload, unprocessedRows);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import trades.';
      alert(message);
    } finally {
      setImporting(false);
    }
  };

  const onToggleSelected = React.useCallback((i: number, checked: boolean) => {
    setSelected((prev) => { const cp = [...prev]; cp[i] = checked; return cp; });
    if (!checked) setNotProcessed((prev) => { const cp = [...prev]; cp[i] = false; return cp; });
  }, []);

  const onToggleNotProcessed = React.useCallback((i: number, checked: boolean) => {
    setNotProcessed((prev) => { const cp = [...prev]; cp[i] = checked; return cp; });
  }, []);

  const onChangeStructureNumber = React.useCallback((i: number, v: number) => {
    setStructureNumbers((prev) => { const cp = [...prev]; cp[i] = v; return cp; });
  }, []);

  const onChangeLinkedStructure = React.useCallback((i: number, value: string) => {
    setLinkedStructures((prev) => { const cp = [...prev]; cp[i] = value.length ? value : null; return cp; });
  }, []);

  const onAddAllocation = React.useCallback((i: number) => {
    setAllocations((prev) => { const cp = [...prev]; cp[i] = [...(cp[i] ?? []), { structureId: null, qty: 0 }]; return cp; });
    setLinkedStructures((prev) => { const cp = [...prev]; cp[i] = null; return cp; });
  }, []);

  const onChangeAllocationStructure = React.useCallback((i: number, allocIndex: number, value: string) => {
    setAllocations((prev) => {
      const cp = [...prev]; const next = [...(cp[i] ?? [])];
      next[allocIndex] = { ...next[allocIndex], structureId: value || null };
      cp[i] = next; return cp;
    });
  }, []);

  const onChangeAllocationQty = React.useCallback((i: number, allocIndex: number, qty: number) => {
    setAllocations((prev) => {
      const cp = [...prev]; const next = [...(cp[i] ?? [])];
      next[allocIndex] = { ...next[allocIndex], qty: Number.isFinite(qty) ? qty : 0 };
      cp[i] = next; return cp;
    });
  }, []);

  const onRemoveAllocation = React.useCallback((i: number, allocIndex: number) => {
    setAllocations((prev) => {
      const cp = [...prev]; const next = [...(cp[i] ?? [])]; next.splice(allocIndex, 1);
      cp[i] = next; return cp;
    });
  }, []);

  const TableHead = () => (
    <thead className="bg-surface-page text-subtle sticky top-0">
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

  return (
    <div className="fixed inset-0 bg-bg-overlay flex items-center justify-center z-modal p-4">
      <div className="bg-surface-card rounded-2xl shadow-xl w-full max-w-6xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <h3 className="type-title-m font-semibold">Review & Select Lines</h3>
          <div className="ml-auto flex gap-2 type-subhead">
            <button className={`px-3 py-1 rounded-lg border ${activeTab==='included' ? 'bg-surface-primary-btn text-on-primary-btn' : ''}`} onClick={() => setActiveTab('included')}>Included ({rows.length})</button>
            <button className={`px-3 py-1 rounded-lg border ${activeTab==='excluded' ? 'bg-surface-primary-btn text-on-primary-btn' : ''}`} onClick={() => setActiveTab('excluded')}>Excluded ({excludedRows.length})</button>
          </div>
        </div>
        {importHistorical ? (
          <div className="mb-3 rounded-xl border banner-danger type-subhead p-3">
            <p className="font-medium">
              Historical mode is enabled. Duplicate trade or order IDs may already exist in your saved imports.
            </p>
          </div>
        ) : null}
        {(duplicateTradeIds?.length || duplicateOrderIds?.length) ? (
          <div className="mb-3 rounded-xl border banner-warning type-subhead p-3">
            <p className="font-medium">
              {allowAllocations
                ? 'Trade/order IDs already exist in saved fills or unprocessed trades. Allocation mode keeps these rows so you can split the execution across structures.'
                : (duplicateTradeIds?.length ?? 0) + (duplicateOrderIds?.length ?? 0) === 1
                ? '1 row was hidden because its trade or order ID already exists in saved fills or unprocessed trades.'
                : `${(duplicateTradeIds?.length ?? 0) + (duplicateOrderIds?.length ?? 0)} rows were hidden because their trade or order IDs already exist in saved fills or unprocessed trades.`}
            </p>
            <div className="type-caption mt-1 space-y-1">
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
            <p className="type-subhead text-subtle mb-3">Uncheck any rows you don’t want to import. Lines with the same second form one “trade structure”.</p>
            <div className="flex gap-2 mb-3 items-center">
              <button className="px-3 py-1 border rounded-lg" onClick={() => toggleAll(true)}>Select all</button>
              <button className="px-3 py-1 border rounded-lg" onClick={() => toggleAll(false)}>Select none</button>
              <div className="mx-2 w-px h-5 bg-surface-hover" />
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
              <table className="min-w-full type-subhead">
                <TableHead />
                <tbody>
                  {rows.map((r, i) => {
                    const structure = normalizeSecond(r.timestamp);
                    const selectedStructureId = linkedStructures[i];
                    const selectedStructureLabel = selectedStructureId
                      ? availableStructureMap.get(selectedStructureId)?.label ?? selectedStructureId
                      : null;
                    const rowInstrumentKey = getRowInstrumentKey(r);
                    const isCloseAction = r.action === 'close';
                    const rowAvailableStructures =
                      isCloseAction && rowInstrumentKey
                        ? availableStructures.filter((option) =>
                            option.legInstrumentKeys?.includes(rowInstrumentKey),
                          )
                        : availableStructures;
                    return (
                      <ReviewRow
                        key={i}
                        i={i}
                        r={r}
                        structure={structure}
                        isSelected={selected[i]}
                        isUnprocessed={notProcessed[i]}
                        structureNumber={structureNumbers[i] ?? 1}
                        selectedStructureId={selectedStructureId ?? null}
                        selectedStructureLabel={selectedStructureLabel}
                        rowAvailableStructures={rowAvailableStructures}
                        hasSavedStructures={rowAvailableStructures.length > 0}
                        isCloseAction={isCloseAction}
                        rowInstrumentKey={rowInstrumentKey}
                        rowAllocations={allocations[i] ?? []}
                        allowAllocations={allowAllocations}
                        onToggleSelected={onToggleSelected}
                        onToggleNotProcessed={onToggleNotProcessed}
                        onChangeStructureNumber={onChangeStructureNumber}
                        onChangeLinkedStructure={onChangeLinkedStructure}
                        onAddAllocation={onAddAllocation}
                        onChangeAllocationStructure={onChangeAllocationStructure}
                        onChangeAllocationQty={onChangeAllocationQty}
                        onRemoveAllocation={onRemoveAllocation}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex gap-3 justify-end">
              <button onClick={onCancel} className="px-4 py-2 rounded-xl border">Back</button>
              <button
                onClick={handleImport}
                className="px-4 py-2 rounded-xl bg-surface-primary-btn text-on-primary-btn disabled:opacity-50"
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
            <p className="type-subhead text-subtle mb-3">These rows were auto-excluded because their instruments aren’t recognized as options (format: UNDERLYING-DDMONYY-STRIKE-C|P). Review-only.</p>
            <div className="max-h-[60vh] overflow-auto border rounded-xl">
              <table className="min-w-full type-subhead">
                <TableHead />
                <tbody>
                  {excludedRows.map((r, i) => {
                    const structure = normalizeSecond(r.timestamp);
                    return (
                      <tr key={i} className="border-t opacity-70">
                        <td className="p-2"><input type="checkbox" disabled checked={false} readOnly /></td>
                        <td className="p-2 type-caption text-muted">—</td>
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
