import React from 'react'
import { DataTable, type Column } from '@/components/ui'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { fmtPremium, fmtNumber, type Position, type MarksMap } from '@/utils'
import { positionSummaryRows, type PositionSummaryRow } from '../portfolio'

export function PositionsPage({ positions, marks, onModify, onClose }: {
  positions: Position[]; marks?: MarksMap; onModify: (id: string) => void; onClose: (id: string) => void
}) {
  const rows = React.useMemo(() => positionSummaryRows(positions, marks), [positions, marks])

  const columns: Column<PositionSummaryRow>[] = React.useMemo(() => [
    { key: 'strategy', header: 'Structure', render: (r) => <span className="font-medium text-text-primary">{r.strategy}</span> },
    { key: 'underlying', header: 'Underlying', render: (r) => r.underlying },
    { key: 'expiry', header: 'Expiry', render: (r) => r.expiry },
    { key: 'dte', header: 'DTE', align: 'right', render: (r) => r.dte },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'netPremium', header: 'Net Prem', align: 'right', render: (r) => fmtPremium(r.netPremium, r.asset) },
    { key: 'realizedPnl', header: 'Real. PnL', align: 'right', render: (r) => <span className={r.realizedPnl < 0 ? 'text-status-danger' : 'text-status-success'}>{fmtPremium(r.realizedPnl, r.asset)}</span> },
    { key: 'unrealizedPnl', header: 'uPnL', align: 'right', render: (r) => r.unrealizedPnl == null ? '—' : <span className={r.unrealizedPnl < 0 ? 'text-status-danger' : 'text-status-success'}>{fmtPremium(r.unrealizedPnl, r.asset)}</span> },
    { key: 'delta', header: 'Δ', align: 'right', headerAbbr: 'Delta', render: (r) => r.delta != null ? fmtNumber(r.delta) : '—' },
    {
      key: 'control', header: 'Control', align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => onModify(r.id)}>Modify</Button>
          <Button size="sm" variant="danger" onClick={() => onClose(r.id)}>Close</Button>
        </div>
      ),
    },
  ], [onModify, onClose])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="type-title-l font-bold text-text-primary">Positions</h1>
        <p className="mt-1 type-subhead text-text-secondary">Monitor trades &amp; risk. Modify or close any position yourself — your action overrides the software.</p>
      </div>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <DataTable columns={columns} data={rows} rowKey={(r) => r.id} emptyMessage="No open positions." />
      </div>
    </div>
  )
}
