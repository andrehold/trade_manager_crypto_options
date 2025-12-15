import React from 'react'
import { X } from 'lucide-react'
import Overlay from './Overlay'
import type { Position } from '../utils'

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

type StructureDetailOverlayProps = {
  open: boolean
  onClose: () => void
  position: Position
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
      className={`w-full text-left ${isActive ? 'text-slate-700' : 'text-slate-500'} hover:text-slate-700`}
    >
      <span>{label}</span>
      <span className="sr-only">Sort {directionLabel}</span>
    </button>
  )
}

export function StructureDetailOverlay({ open, onClose, position }: StructureDetailOverlayProps) {
  const [sort, setSort] = React.useState<SortState>({ key: 'timestamp', direction: 'desc' })

  const transactions = React.useMemo(() => buildTransactionRows(position), [position])
  const sortedTransactions = React.useMemo(
    () => sortTransactions(transactions, sort),
    [transactions, sort],
  )

  return (
    <Overlay open={open} onClose={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-5xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <div className="text-sm text-slate-500">Structure details</div>
            <div className="text-lg font-semibold text-slate-800">
              {position.underlying} · {position.expiryISO}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Close detail overlay"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 overflow-auto">
          <div className="text-sm text-slate-600 mb-3">
            Transaction log for this structure. Click any column header to sort ascending/descending.
          </div>
          {sortedTransactions.length === 0 ? (
            <div className="text-sm text-slate-500">No transactions available for this structure.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500 border-b">
                  <tr>
                    <th className="p-2 text-left min-w-[160px]">
                      <SortableHeader label="Timestamp" column="timestamp" sort={sort} onChange={setSort} />
                    </th>
                    <th className="p-2 text-left min-w-[150px]">
                      <SortableHeader label="Instrument" column="instrument" sort={sort} onChange={setSort} />
                    </th>
                    <th className="p-2 text-right">
                      <SortableHeader label="Qty" column="qty" sort={sort} onChange={setSort} />
                    </th>
                    <th className="p-2 text-right">
                      <SortableHeader label="Price" column="price" sort={sort} onChange={setSort} />
                    </th>
                    <th className="p-2 text-right">
                      <SortableHeader label="Fee" column="fee" sort={sort} onChange={setSort} />
                    </th>
                    <th className="p-2 text-left">
                      <SortableHeader label="O/C" column="action" sort={sort} onChange={setSort} />
                    </th>
                    <th className="p-2 text-left">
                      <SortableHeader label="Side" column="side" sort={sort} onChange={setSort} />
                    </th>
                    <th className="p-2 text-left">
                      <SortableHeader label="Trade ID" column="tradeId" sort={sort} onChange={setSort} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTransactions.map((txn) => (
                    <tr key={txn.id} className="border-b last:border-0">
                      <td className="p-2 font-mono text-xs text-slate-700">{formatTimestamp(txn.timestamp)}</td>
                      <td className="p-2 text-slate-800">{txn.instrument}</td>
                      <td className="p-2 text-right font-mono text-slate-800">{txn.qty}</td>
                      <td className="p-2 text-right font-mono text-slate-800">{txn.price}</td>
                      <td className="p-2 text-right font-mono text-slate-800">{txn.fee ?? '—'}</td>
                      <td className="p-2 text-slate-800 capitalize">{txn.action ?? '—'}</td>
                      <td className="p-2 text-slate-800 capitalize">{txn.side}</td>
                      <td className="p-2 text-slate-800">{txn.tradeId ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Overlay>
  )
}
