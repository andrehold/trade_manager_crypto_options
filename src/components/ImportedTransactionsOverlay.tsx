import React from 'react'

type ImportedRow = {
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
};

type ImportedTransactionsOverlayProps = {
  open: boolean;
  rows: ImportedRow[];
  loading: boolean;
  error: string | null;
  backfillStatus: { type: 'idle' | 'running' | 'success' | 'error'; message?: string };
  onClose: () => void;
  onRefresh: () => void;
  onBackfill: () => void;
};

export function ImportedTransactionsOverlay({
  open,
  rows,
  loading,
  error,
  backfillStatus,
  onClose,
  onRefresh,
  onBackfill,
}: ImportedTransactionsOverlayProps) {
  if (!open) return null;

  const statusBadge = (status: ImportedRow['status'], label?: string | null) => {
    if (status === 'unprocessed') {
      return (
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          Unprocessed
        </span>
      );
    }

    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
        {label ?? 'Linked'}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-6xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-semibold">Imported Transactions</h3>
          <span className="text-xs text-slate-500">{rows.length} rows</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-xl border px-3 py-1.5 text-sm font-medium text-slate-700"
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={onBackfill}
              className="rounded-xl border px-3 py-1.5 text-sm font-medium text-slate-700"
            >
              Backfill from CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border px-3 py-1.5 text-sm font-medium text-slate-700"
            >
              Close
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {backfillStatus.type !== 'idle' ? (
          <div
            className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
              backfillStatus.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : backfillStatus.type === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}
          >
            {backfillStatus.message}
          </div>
        ) : null}

        <div className="mt-4 max-h-[60vh] overflow-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr className="text-left">
                <th className="p-2">Status</th>
                <th className="p-2">Timestamp</th>
                <th className="p-2">Instrument</th>
                <th className="p-2">Side</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Price</th>
                <th className="p-2">Fee</th>
                <th className="p-2">Trade ID</th>
                <th className="p-2">Order ID</th>
                <th className="p-2">Structure</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={10} className="p-4 text-center text-sm text-slate-500">
                    No imported transactions found.
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => {
                const structureLabel =
                  row.status === 'linked' ? row.structureLabel ?? row.structureId ?? 'Linked' : '—';
                return (
                  <tr key={row.id} className="border-t">
                    <td className="p-2">{statusBadge(row.status, structureLabel)}</td>
                    <td className="p-2 text-slate-700">{row.timestamp ?? '—'}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{row.instrument}</span>
                        {row.warning ? (
                          <span className="text-xs text-amber-600" title={row.warning}>
                            ⚠️
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-2 text-slate-700">{row.side}</td>
                    <td className="p-2 text-slate-700">{row.amount ?? '—'}</td>
                    <td className="p-2 text-slate-700">{row.price ?? '—'}</td>
                    <td className="p-2 text-slate-700">{row.fee ?? '—'}</td>
                    <td className="p-2 text-slate-700">{row.tradeId ?? '—'}</td>
                    <td className="p-2 text-slate-700">{row.orderId ?? '—'}</td>
                    <td className="p-2 text-slate-700">{structureLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
