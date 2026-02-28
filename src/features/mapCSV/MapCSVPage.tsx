import React from 'react'
import Papa from 'papaparse'
import { ArrowLeft, FileText } from 'lucide-react'
import {
  EXPECTED_FIELDS,
  parseActionSide,
  toNumber,
  parseInstrumentByExchange,
  normalizeSecond,
  type Exchange,
  type TxnRow,
  type Position,
} from '../../utils'
import type { ColumnMapping } from '../../components/ColumnMapper'
import { getColumnMapperContext, clearColumnMapperContext } from './columnMapperStore'
import { setAssignLegsContext } from '../assignLegs/assignLegsStore'
import { tryGetSupabaseClient } from '../../lib/supabase'
import { fetchSavedStructures, appendTradesToStructure } from '../../lib/positions'
import { deriveSyntheticDeliveryTradeId, sanitizeIdentifier } from '../../lib/positions/identifiers'

type Props = {
  onBack: () => void
  onOpenAssignLegs?: () => void
  embedded?: boolean
}

export function MapCSVPage({ onBack, onOpenAssignLegs, embedded }: Props) {
  const ctx = getColumnMapperContext()

  // Local state for direct file upload (no pre-existing context)
  const [localHeaders, setLocalHeaders] = React.useState<string[] | null>(null)
  const [localRawRows, setLocalRawRows] = React.useState<any[] | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [isProcessing, setIsProcessing] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const headers = ctx?.headers ?? localHeaders ?? []
  const mode = ctx?.mode ?? 'import'

  const [mapping, setMapping] = React.useState<Record<string, string>>({})
  const [exchange, setExchange] = React.useState<'deribit' | 'coincall' | 'cme'>('deribit')
  const [importHistoricalRows, setImportHistoricalRows] = React.useState(false)
  const [allowAllocations, setAllowAllocations] = React.useState(false)

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

  function parseFile(file: File) {
    const common = {
      header: true,
      skipEmptyLines: 'greedy' as const,
      transformHeader: (h: string) => h.replace(/^\ufeff/, '').trim(),
    }

    const onParsed = (rows: any[]) => {
      if (!rows.length) {
        alert('No rows found in CSV. Check the delimiter (comma vs semicolon) and header row.')
        return
      }
      const hdrs = Object.keys(rows[0] || {})
      setLocalHeaders(hdrs)
      setLocalRawRows(rows)
    }

    Papa.parse(file, {
      ...common,
      complete: (res: any) => {
        const rows = res.data as any[]
        const fields: string[] = res.meta?.fields ?? Object.keys(rows[0] || {})
        if (!fields || fields.length <= 1) {
          Papa.parse(file, {
            ...common,
            delimiter: ';',
            complete: (res2: any) => onParsed(res2.data as any[]),
            error: (e: any) => alert('CSV parse error: ' + (e?.message ?? String(e))),
          })
        } else {
          onParsed(rows)
        }
      },
      error: (e: any) => alert('CSV parse error: ' + (e?.message ?? String(e))),
    })
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) parseFile(file)
  }

  function handleCancel() {
    if (ctx) {
      clearColumnMapperContext()
      ctx.onCancel()
    }
    setLocalHeaders(null)
    setLocalRawRows(null)
    onBack()
  }

  async function handleConfirm() {
    const result: ColumnMapping = {
      ...mapping,
      __exchange: exchange,
      __importHistorical: importHistoricalRows,
      __allowAllocations: allowAllocations,
    }

    // Existing flow: context was set by DashboardApp
    if (ctx) {
      const savedOnConfirm = ctx.onConfirm
      const isBackfill = mode === 'backfill'
      clearColumnMapperContext()
      savedOnConfirm(result)
      if (isBackfill) onBack()
      return
    }

    // Local flow: file uploaded directly on this page
    if (!localRawRows) return
    setIsProcessing(true)

    const exch = exchange as Exchange
    const rows: TxnRow[] = []
    const excludedRows: TxnRow[] = []

    for (const r of localRawRows) {
      const instrument = String(r[mapping.instrument] ?? '').trim()
      if (!instrument) continue

      const rawSide = String(r[mapping.side] ?? '')
      const { action, side } = parseActionSide(rawSide)

      const rawTradeId = mapping.trade_id ? sanitizeIdentifier(r[mapping.trade_id]) : null
      const rawOrderId = mapping.order_id ? sanitizeIdentifier(r[mapping.order_id]) : null

      const provisionalRow: TxnRow = {
        instrument,
        side: side || '',
        action,
        amount: mapping.amount ? toNumber(r[mapping.amount]) : 0,
        price: mapping.price ? toNumber(r[mapping.price]) : 0,
        fee: mapping.fee ? toNumber(r[mapping.fee]) : 0,
        timestamp: mapping.timestamp ? String(r[mapping.timestamp]) : undefined,
        trade_id: rawTradeId ?? undefined,
        order_id: rawOrderId ?? undefined,
        info: mapping.info ? String(r[mapping.info]) : undefined,
        exchange: exch,
      }

      const syntheticTradeId =
        provisionalRow.trade_id ??
        deriveSyntheticDeliveryTradeId(provisionalRow, r as Record<string, unknown>) ??
        undefined

      const baseRow: TxnRow = { ...provisionalRow, trade_id: syntheticTradeId }
      const parsed = parseInstrumentByExchange(exch, instrument)

      if (!parsed) {
        excludedRows.push(baseRow)
        continue
      }

      const hasSide = baseRow.side === 'buy' || baseRow.side === 'sell'
      const hasAmount = Number.isFinite(baseRow.amount) && Math.abs(baseRow.amount!) > 0
      const hasPrice = Number.isFinite(baseRow.price) && (baseRow.price ?? 0) > 0

      if (!hasSide || !hasAmount || !hasPrice) {
        excludedRows.push(baseRow)
        continue
      }

      rows.push(baseRow)
    }

    // Fetch existing saved structures for linking suggestions
    let savedStructures: Position[] = []
    const supabase = tryGetSupabaseClient()
    if (supabase) {
      try {
        const { data: authData } = await supabase.auth.getUser()
        if (authData.user) {
          const fetchResult = await fetchSavedStructures(supabase, {})
          if (fetchResult.ok) savedStructures = fetchResult.positions ?? []
        }
      } catch {
        // Continue without saved structures
      }
    }

    setAssignLegsContext({
      rows,
      excludedRows,
      exchange: exch,
      savedStructures,
      onConfirm: async (selectedRows) => {
        const sb = tryGetSupabaseClient()

        // Normalize structure IDs
        const normalizedRows = selectedRows.map((r, index) => {
          const normalized = normalizeSecond(r.timestamp)
          const fallbackStructure = normalized === 'NO_TS' ? `NO_TS_${index + 1}` : normalized
          return { ...r, structureId: String(r.structureId ?? fallbackStructure) }
        })

        // Save rows linked to existing saved structures
        if (sb) {
          const linkedRows = normalizedRows.filter((r) => Boolean(r.linkedStructureId))
          if (linkedRows.length > 0) {
            const byStructure = new Map<string, TxnRow[]>()
            for (const row of linkedRows) {
              const targetId = row.linkedStructureId!
              if (!byStructure.has(targetId)) byStructure.set(targetId, [])
              byStructure.get(targetId)!.push(row)
            }
            for (const [structureId, groupedRows] of byStructure.entries()) {
              const res = await appendTradesToStructure(sb, {
                structureId,
                rows: groupedRows,
                clientScope: {},
              })
              if (!res.ok) {
                alert(`Failed to save to structure ${structureId}: ${res.error}`)
              }
            }
          }
        }

        window.location.hash = ''
      },
      onCancel: () => {
        window.location.hash = ''
      },
    })

    setIsProcessing(false)
    onOpenAssignLegs?.()
  }

  // ── Upload zone (no file yet, no pre-existing context) ──────────────────────
  if (!ctx && !localHeaders) {
    return (
      <div className={embedded ? 'flex-1 flex flex-col' : 'min-h-screen bg-zinc-950 flex flex-col'}>
        {/* Header — only shown when not embedded (standalone page) */}
        {!embedded && (
          <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
              aria-label="Back"
            >
              <ArrowLeft size={18} className="text-zinc-400" />
            </button>
            <h1 className="text-base font-semibold text-zinc-100">Import CSV</h1>
          </div>
        )}

        {/* Card area */}
        <div
          className="flex-1 flex flex-col p-6"
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div
            className={[
              'flex-1 flex flex-col rounded-2xl border p-5 transition-colors',
              isDragging
                ? 'bg-zinc-800 border-zinc-600'
                : 'bg-zinc-900 border-zinc-800',
            ].join(' ')}
          >
            {/* Section label — upper left */}
            <div className="flex items-center gap-1.5">
              <FileText size={13} className="text-zinc-500" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                Import
              </span>
            </div>

            {/* Centered add button */}
            <div className="flex-1 flex items-center justify-center">
              <button
                onClick={() => fileInputRef.current?.click()}
                className={[
                  'w-full max-w-xs border border-dashed rounded-xl py-7 flex items-center justify-center gap-2 transition-colors',
                  isDragging
                    ? 'border-zinc-500 text-zinc-200 bg-zinc-700/30'
                    : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
                ].join(' ')}
              >
                <FileText size={15} />
                <span className="text-sm font-medium">+ Import CSV</span>
              </button>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>
    )
  }

  // ── Column mapping UI ────────────────────────────────────────────────────────
  return (
    <div className={embedded ? 'flex-1 flex flex-col text-white' : 'min-h-screen bg-slate-900 text-white flex flex-col'}>
      {/* Header — only shown when not embedded (standalone page) */}
      {!embedded && (
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-700">
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={18} className="text-slate-400" />
          </button>
          <h1 className="text-base font-semibold">Map CSV Columns</h1>
          {localHeaders && (
            <span className="text-xs text-slate-400 ml-1">
              — {localRawRows?.length ?? 0} rows detected
            </span>
          )}
        </div>
      )}

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

          {/* Re-upload option for local flow */}
          {localHeaders && (
            <div className="pt-2 border-t border-slate-700">
              <button
                onClick={() => { setLocalHeaders(null); setLocalRawRows(null) }}
                className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                ← Upload a different file
              </button>
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
          disabled={isProcessing}
          className="px-4 py-2 rounded-xl bg-white text-slate-900 font-medium hover:bg-slate-100 transition-colors disabled:opacity-50"
        >
          {isProcessing ? 'Processing…' : mode === 'backfill' ? 'Start Backfill' : 'Start Import'}
        </button>
      </div>
    </div>
  )
}
