import React from 'react'
import type { Position } from '../utils'
import { DataTable, type Column } from './ui'

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

type SortKey = 'timestamp' | 'instrument' | 'qty' | 'price' | 'fee' | 'action' | 'side' | 'tradeId'

type SortState = {
  key: SortKey
  direction: 'asc' | 'desc'
}

type TransactionRow = {
  id: string
  timestamp: string | null
  instrument: string
  qty: number
  price: number
  fee: number | null
  action?: string | null
  side: string
  tradeId?: string
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return DATE_FORMATTER.format(parsed)
}

function normalizeTimestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

function buildTransactionRows(position: Position): TransactionRow[] {
  const rows: TransactionRow[] = []

  position.legs.forEach((leg, legIndex) => {
    leg.trades.forEach((trade, tradeIndex) => {
      const instrument = trade.instrument || `${position.underlying}-${leg.strike}-${leg.optionType}`
      rows.push({
        id: `${legIndex}-${tradeIndex}-${trade.trade_id ?? ''}-${trade.order_id ?? ''}`,
        timestamp: trade.timestamp ?? null,
        instrument,
        qty: trade.amount ?? 0,
        price: trade.price ?? 0,
        fee: trade.fee ?? null,
        action: trade.action ?? null,
        side: trade.side ?? '—',
        tradeId: trade.trade_id,
      })
    })
  })

  return rows
}

function sortTransactions(rows: TransactionRow[], sort: SortState): TransactionRow[] {
  const getValue = (row: TransactionRow) => {
    switch (sort.key) {
      case 'timestamp':
        return normalizeTimestamp(row.timestamp)
      case 'instrument':
        return row.instrument.toLowerCase()
      case 'qty':
        return row.qty
      case 'price':
        return row.price
      case 'fee':
        return row.fee ?? 0
      case 'side':
        return row.side.toLowerCase()
      case 'action':
        return (row.action ?? '').toLowerCase()
      case 'tradeId':
        return row.tradeId?.toLowerCase() ?? ''
      default:
        return 0
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const va = getValue(a)
    const vb = getValue(b)
    if (va < vb) return -1
    if (va > vb) return 1
    return 0
  })

  return sort.direction === 'asc' ? sorted : sorted.reverse()
}

function SortableHeader({
  label,
  column,
  sort,
  onChange,
}: {
  label: string
  column: SortKey
  sort: SortState
  onChange: (next: SortState) => void
}) {
  const isActive = sort.key === column
  const directionLabel = isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'sortable'

  return (
    <button
      type="button"
      onClick={() =>
        onChange({
          key: column,
          direction: isActive && sort.direction === 'asc' ? 'desc' : 'asc',
        })
      }
      className={`w-full text-left ${isActive ? 'text-body' : ''} hover:text-body`}
    >
      <span>{label}</span>
      <span className="sr-only">Sort {directionLabel}</span>
    </button>
  )
}

type TransactionTableProps = {
  position: Position
}

export function TransactionTable({ position }: TransactionTableProps) {
  const [sort, setSort] = React.useState<SortState>({ key: 'timestamp', direction: 'desc' })

  const transactions = React.useMemo(() => buildTransactionRows(position), [position])
  const sortedTransactions = React.useMemo(
    () => sortTransactions(transactions, sort),
    [transactions, sort],
  )

  const columns = React.useMemo<Column<TransactionRow>[]>(() => [
    {
      key: 'timestamp',
      header: <SortableHeader label="Timestamp" column="timestamp" sort={sort} onChange={setSort} />,
      render: (r) => formatTimestamp(r.timestamp),
    },
    {
      key: 'instrument',
      header: <SortableHeader label="Instrument" column="instrument" sort={sort} onChange={setSort} />,
      render: (r) => r.instrument,
    },
    {
      key: 'qty',
      header: <SortableHeader label="Qty" column="qty" sort={sort} onChange={setSort} />,
      align: 'right',
      render: (r) => r.qty,
    },
    {
      key: 'price',
      header: <SortableHeader label="Price" column="price" sort={sort} onChange={setSort} />,
      align: 'right',
      render: (r) => r.price,
    },
    {
      key: 'fee',
      header: <SortableHeader label="Fee" column="fee" sort={sort} onChange={setSort} />,
      align: 'right',
      render: (r) => r.fee ?? '—',
    },
    {
      key: 'action',
      header: <SortableHeader label="O/C" column="action" sort={sort} onChange={setSort} />,
      render: (r) => <span className="capitalize">{r.action ?? '—'}</span>,
    },
    {
      key: 'side',
      header: <SortableHeader label="Side" column="side" sort={sort} onChange={setSort} />,
      render: (r) => <span className="capitalize">{r.side}</span>,
    },
    {
      key: 'tradeId',
      header: <SortableHeader label="Trade ID" column="tradeId" sort={sort} onChange={setSort} />,
      render: (r) => r.tradeId ?? '—',
    },
  ], [sort])

  return (
    <DataTable
      columns={columns}
      data={sortedTransactions}
      rowKey={(r) => r.id}
      emptyMessage="No transactions available for this structure."
    />
  )
}
