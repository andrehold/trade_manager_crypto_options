import React from 'react'
import type { Position } from '../utils'
import { DataTable, type Column } from './ui'
import { StopTradeButton } from './StopTradeButton'

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

type ConfirmationRow = {
  id: string
  timestamp: string | null
  instrument: string
  qty: number
  price: string
  fee: string
  action?: string | null
  side: string
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return DATE_FORMATTER.format(parsed)
}

function buildConfirmationRows(position: Position): ConfirmationRow[] {
  const rows: ConfirmationRow[] = []

  position.legs.forEach((leg, legIndex) => {
    leg.trades.forEach((trade, tradeIndex) => {
      const instrument = trade.instrument || `${position.underlying}-${leg.strike}-${leg.optionType}`
      rows.push({
        id: `${legIndex}-${tradeIndex}-${trade.trade_id ?? ''}-${trade.order_id ?? ''}`,
        timestamp: trade.timestamp ?? null,
        instrument,
        qty: trade.amount ?? 0,
        price: '~0',
        fee: '~0',
        action: trade.action ?? null,
        side: trade.side ?? '—',
      })
    })
  })

  return rows
}

type ConfirmationTableProps = {
  position: Position
  onStopTrade?: (rowId: string) => void
}

export function ConfirmationTable({ position, onStopTrade }: ConfirmationTableProps) {
  const rows = React.useMemo(() => buildConfirmationRows(position), [position])

  const columns = React.useMemo<Column<ConfirmationRow>[]>(() => [
    {
      key: 'timestamp',
      header: 'Timestamp',
      render: (r) => formatTimestamp(r.timestamp),
    },
    {
      key: 'instrument',
      header: 'Instrument',
      render: (r) => r.instrument,
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      render: (r) => r.qty,
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      render: (r) => <span className="text-text-muted">{r.price}</span>,
    },
    {
      key: 'fee',
      header: 'Fee',
      align: 'right',
      render: (r) => <span className="text-text-muted">{r.fee}</span>,
    },
    {
      key: 'action',
      header: 'O/C',
      render: (r) => <span className="capitalize">{r.action ?? '—'}</span>,
    },
    {
      key: 'side',
      header: 'Side',
      render: (r) => <span className="capitalize">{r.side}</span>,
    },
    {
      key: 'stop',
      header: '',
      render: (r) => (
        <StopTradeButton onClick={() => onStopTrade?.(r.id)} />
      ),
    },
  ], [onStopTrade])

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(r) => r.id}
      emptyMessage="No trades open for confirmation."
    />
  )
}
