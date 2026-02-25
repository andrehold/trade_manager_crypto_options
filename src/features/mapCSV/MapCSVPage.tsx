import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { EXPECTED_FIELDS } from '../../utils'
import type { ColumnMapping } from '../../components/ColumnMapper'
import { getColumnMapperContext, clearColumnMapperContext } from './columnMapperStore'

export function MapCSVPage({ onBack }: { onBack: () => void }) {
  const ctx = getColumnMapperContext()

  const [mapping, setMapping] = React.useState<Record<string, string>>({})
  const [exchange, setExchange] = React.useState<'deribit' | 'coincall' | 'cme'>('deribit')
  const [importHistoricalRows, setImportHistoricalRows] = React.useState(false)
  const [allowAllocations, setAllowAllocations] = React.useState(false)

  const headers = ctx?.headers ?? []
  const mode = ctx?.mode ?? 'import'

  React.useEffect(() => {
    if (!headers.length) return
    const lower = headers.map((h) => h.toLowerCase())
    const exact = (name: string) => {
      const idx = lower.indexOf(name.toLowerCase())
      return idx >= 0 ? headers[idx] : ''
    }
    const guess = (needle: string[]) => {
      const i = lower.findIndex((h) => needle.some((n) => h.includes(n)))
      return i >= 0 ? headers[i] : ''
    }
    setMapping({
      instrument: exact('instrument') || guess(['instrument', 'instrument_name', 'instrument name', 'symbol']),
      side: exact('side') || guess(['side', 'direction', 'buy', 'sell', 'trade side', 'order side', 'type']),
      amount: exact('amount') || guess(['amount', 'contracts', 'qty', 'quantity', 'size', 'contract size']),
      price: exact('price') || guess(['price', 'fill price', 'avg price', 'average price']),
      fee: exact('fee') || guess(['fee', 'commission', 'cost']),
      timestamp: exact('date') || exact('timestamp') || guess(['time', 'timestamp', 'date', 'datetime', 'trade time', 'execution time']),
      trade_id: exact('trade id') || exact('trade_id') || guess(['trade id', 'trade_id', 'tradeid', 'id', 'exec id', 'execution id']),
      order_id: exact('order id') || exact('order_id') || guess(['order id', 'order_id', 'orderid']),
      info: exact('info') || guess(['info', 'note', 'comment']),
    })
  }, [headers.join(',')])

  function handleCancel() {
    clearColumnMapperContext()
    ctx?.onCancel()
    onBack()
  }

  function handleConfirm() {
    if (!ctx) return
    const result: ColumnMapping = {
      ...mapping,
      __exchange: exchange,
      __importHistorical: importHistoricalRows,
      __allowAllocations: allowAllocations,
    }
    const savedOnConfirm = ctx.onConfirm
    const isBackfill = mode === 'backfill'
    clearColumnMapperContext()
    savedOnConfirm(result)
    // For backfill, the dashboard handles status in-place; navigate back so the user can see it.
    // For import, startImport navigates to assign-legs itself.
    if (isBackfill) {
      onBack()
    }
  }

  if (!ctx) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <div className="text-center space-y-4">
          <p className="text-slate-400">No CSV data to map.</p>
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-xl bg-slate-700 text-white hover:bg-slate-600"
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-700">
        <button
          onClick={handleCancel}
          className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} className="text-slate-400" />
        </button>
        <h1 className="text-base font-semibold">Map CSV Columns</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <p className="text-sm text-slate-400">
            {mode === 'backfill'
              ? 'Select the instrument column plus trade_id or order_id to backfill legs. Other fields are optional.'
              : 'Tell the importer which CSV columns correspond to the required fields.'}
          </p>

          {/* Exchange selector */}
          <div>
            <label className="text-sm block text-slate-400 mb-1">Exchange</label>
            <select
              value={exchange}
              onChange={(e) => setExchange(e.target.value as 'deribit' | 'coincall' | 'cme')}
              className="w-full bg-slate-800 border border-slate-600 rounded-xl p-2 text-white focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <option value="deribit">Deribit</option>
              <option value="coincall">Coincall</option>
              <option value="cme">CME</option>
            </select>
          </div>

          {/* Column mappings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {EXPECTED_FIELDS.map((f) => (
              <label key={f.key} className="text-sm">
                <span className="block text-slate-400 mb-1">{f.label}</span>
                <select
                  value={mapping[f.key] || ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl p-2 text-white focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  <option value="">— Select column —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {/* Import-only options */}
          {mode === 'import' && (
            <div className="space-y-2">
              <label className="inline-flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={importHistoricalRows}
                  onChange={(e) => setImportHistoricalRows(e.target.checked)}
                  className="rounded"
                />
                <span>Import historical rows (skip duplicates)</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowAllocations}
                  onChange={(e) => setAllowAllocations(e.target.checked)}
                  className="rounded"
                />
                <span>Allow trade allocations (reuse trade/order IDs across structures)</span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-3">
        <button
          onClick={handleCancel}
          className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="px-4 py-2 rounded-xl bg-white text-slate-900 font-medium hover:bg-slate-100 transition-colors"
        >
          {mode === 'backfill' ? 'Start Backfill' : 'Start Import'}
        </button>
      </div>
    </div>
  )
}
