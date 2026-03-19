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
        <span className="inline-flex items-center rounded-full border banner-warning px-2 py-0.5 type-micro font-semibold uppercase tracking-wide">
          Unprocessed
        </span>
      );
    }

    return (
      <span className="inline-flex items-center rounded-full border banner-success px-2 py-0.5 type-micro font-semibold uppercase tracking-wide">
        {label ?? 'Linked'}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-bg-overlay p-4">
      <div className="w-full max-w-6xl rounded-2xl bg-surface-card p-6 shadow-xl">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="type-title-m font-semibold">Imported Transactions</h3>
          <span className="type-caption text-muted">{rows.length} rows</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-xl border px-3 py-1.5 type-subhead font-medium text-body"
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={onBackfill}
              className="rounded-xl border px-3 py-1.5 type-subhead font-medium text-body"
            >
              Backfill from CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border px-3 py-1.5 type-subhead font-medium text-body"
            >
              Close
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border banner-danger px-3 py-2 type-subhead">
            {error}
          </div>
        ) : null}

        {backfillStatus.type !== 'idle' ? (
          <div
            className={`mt-3 rounded-xl border px-3 py-2 type-subhead ${
              backfillStatus.type === 'success'
                ? 'banner-success'
                : backfillStatus.type === 'error'
                ? 'banner-danger'
                : 'border-border-default bg-surface-page text-body'
            }`}
          >
            {backfillStatus.message}
          </div>
        ) : null}

        <div className="mt-4 max-h-[60vh] overflow-auto rounded-xl border">
          <table className="min-w-full type-subhead">
            <thead className="sticky top-0 bg-surface-page type-caption uppercase text-muted">
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
              {loading && rows.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="border-t animate-pulse">
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j} className="p-2">
                        <div className="h-4 rounded bg-surface-chip" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : null}
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={10} className="p-4 text-center type-subhead text-muted">
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
                    <td className="p-2 text-body">{row.timestamp ?? '—'}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-strong">{row.instrument}</span>
                        {row.warning ? (
                          <span className="type-caption text-status-warning-text" title={row.warning}>
                            ⚠️
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-2 text-body">{row.side}</td>
                    <td className="p-2 text-body">{row.amount ?? '—'}</td>
                    <td className="p-2 text-body">{row.price ?? '—'}</td>
                    <td className="p-2 text-body">{row.fee ?? '—'}</td>
                    <td className="p-2 text-body">{row.tradeId ?? '—'}</td>
                    <td className="p-2 text-body">{row.orderId ?? '—'}</td>
                    <td className="p-2 text-body">{structureLabel}</td>
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
