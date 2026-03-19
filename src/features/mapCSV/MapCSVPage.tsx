import React from 'react'
import Papa from 'papaparse'
import { ArrowLeft, FileText, ChevronsUpDown } from 'lucide-react'
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
import { fetchSavedStructures, appendTradesToStructure, filterDuplicateRows } from '../../lib/positions'
import { createStructure } from '../../lib/positions/createStructure'
import { saveUnprocessedTrades } from '../../lib/positions/saveUnprocessedTrades'
import { deriveSyntheticDeliveryTradeId, sanitizeIdentifier } from '../../lib/positions/identifiers'
import { Button } from '../../components/ui'

type Props = {
  onBack: () => void
  onOpenAssignLegs?: () => void
  embedded?: boolean
  onStepChange?: (step: 'upload' | 'mapping') => void
}

export function MapCSVPage({ onBack, onOpenAssignLegs, embedded, onStepChange }: Props) {
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

  // Notify parent when step transitions between upload ↔ mapping
  const isMapping = Boolean(ctx || localHeaders)
  React.useEffect(() => {
    onStepChange?.(isMapping ? 'mapping' : 'upload')
  }, [isMapping, onStepChange])

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
      type: exact('type') || guess(['type', 'trade_type', 'transaction_type']),
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
            complete: (res2: any) => {
              const rows2 = res2.data as any[]
              const fields2: string[] = res2.meta?.fields ?? Object.keys(rows2[0] || {})
              if (!rows2.length || !fields2 || fields2.length <= 1) {
                alert('Could not parse CSV: no columns detected. Check that the file uses comma or semicolon delimiters.')
                return
              }
              onParsed(rows2)
            },
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
      if (!instrument) {
        excludedRows.push({
          instrument: '',
          side: '',
          amount: 0,
          price: 0,
          exchange: exch,
          excludeReason: 'no_instrument',
        })
        continue
      }

      const rawSide = String(r[mapping.side] ?? '')
      const { action, side } = parseActionSide(rawSide)

      const rawTradeId = mapping.trade_id ? sanitizeIdentifier(r[mapping.trade_id]) : null
      const rawOrderId = mapping.order_id ? sanitizeIdentifier(r[mapping.order_id]) : null

      // Parse instrument early so derived fields (underlying, expiry, strike, optionType)
      // flow through to the TxnRow and are available in AssignLegs + saved structures.
      const parsed = parseInstrumentByExchange(exch, instrument)

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
        underlying: parsed?.underlying,
        expiry: parsed?.expiryISO,
        strike: parsed?.strike,
        optionType: parsed?.optionType,
      }

      const syntheticTradeId =
        provisionalRow.trade_id ??
        deriveSyntheticDeliveryTradeId(provisionalRow, r as Record<string, unknown>) ??
        undefined

      const csvType = mapping.type ? String(r[mapping.type] ?? '').trim().toLowerCase() : undefined
      const rawCsv = r as Record<string, unknown>
      const baseRow: TxnRow = { ...provisionalRow, trade_id: syntheticTradeId, csvType }

      // Filter out non-option-trade rows (e.g. options_settlement_summary)
      if (csvType === 'options_settlement_summary') {
        excludedRows.push({ ...baseRow, rawCsv, excludeReason: 'not_option_trade' })
        continue
      }

      if (!parsed) {
        excludedRows.push({ ...baseRow, rawCsv, excludeReason: 'no_instrument' })
        continue
      }

      const isDelivery = csvType === 'delivery'
      const hasSide = baseRow.side === 'buy' || baseRow.side === 'sell'
      const hasAmount = Number.isFinite(baseRow.amount) && Math.abs(baseRow.amount!) > 0
      const hasPrice = Number.isFinite(baseRow.price) && (baseRow.price ?? 0) > 0

      if (!hasSide) {
        excludedRows.push({ ...baseRow, rawCsv, excludeReason: 'no_side' })
        continue
      }
      if (!hasAmount) {
        excludedRows.push({ ...baseRow, rawCsv, excludeReason: 'no_amount' })
        continue
      }
      // Delivery rows have price=0 (option expiry/settlement) — that's valid
      if (!hasPrice && !isDelivery) {
        excludedRows.push({ ...baseRow, rawCsv, excludeReason: 'no_price' })
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
          if (fetchResult.ok) {
            savedStructures = fetchResult.positions ?? []
          } else {
            console.warn('[MapCSVPage] Could not load saved structures:', fetchResult.error)
          }
        }
      } catch (err) {
        console.warn('[MapCSVPage] Failed to fetch saved structures for linking suggestions:', err)
      }
    }

    // Dedup: filter out trade_ids / order_ids already in fills or unprocessed_imports.
    // Skip when the user explicitly opted into importing historical rows.
    let dedupedRows = rows
    let duplicateRows: typeof rows = []
    let duplicatesInStructures: typeof rows = []
    let duplicatesInBacklog: typeof rows = []
    if (supabase && !importHistoricalRows) {
      const dedupResult = await filterDuplicateRows(supabase, rows, { allowAllocations })
      dedupedRows = dedupResult.filtered
      duplicateRows = dedupResult.duplicates
      duplicatesInStructures = dedupResult.duplicatesInStructures
      duplicatesInBacklog = dedupResult.duplicatesInBacklog
    }

    // Build processed rows from duplicates (already in DB)
    const processedRows = [
      ...duplicatesInStructures.map((row) => ({ row, source: 'structure' as const })),
      ...duplicatesInBacklog.map((row) => ({ row, source: 'unprocessed_imports' as const })),
    ]

    setAssignLegsContext({
      rows: dedupedRows,
      noImportRows: excludedRows,
      processedRows,
      exchange: exch,
      savedStructures,
      onConfirm: async (selectedRows, unprocessedRows) => {
        const sb = tryGetSupabaseClient()
        if (!sb) {
          alert('Supabase is not configured. Cannot save trades.')
          window.location.hash = ''
          return
        }

        const { data: authData } = await sb.auth.getUser()
        if (!authData.user) {
          alert('You must be signed in to save trades.')
          window.location.hash = ''
          return
        }

        const userId = authData.user.id

        // Normalize structure IDs
        const normalizedRows = selectedRows.map((r, index) => {
          const normalized = normalizeSecond(r.timestamp)
          const fallbackStructure = normalized === 'NO_TS' ? `NO_TS_${index + 1}` : normalized
          return { ...r, structureId: String(r.structureId ?? fallbackStructure) }
        })

        const linkedRows = normalizedRows.filter((r) => Boolean(r.linkedStructureId))
        const localRows = normalizedRows.filter((r) => !r.linkedStructureId)
        const errors: string[] = []

        // Save rows linked to existing saved structures
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
            if (!res.ok) errors.push(`Structure ${structureId}: ${res.error}`)
          }
        }

        // Create new structures
        if (localRows.length > 0) {
          const byStructure = new Map<string, TxnRow[]>()
          for (const row of localRows) {
            const key = row.structureId ?? 'default'
            if (!byStructure.has(key)) byStructure.set(key, [])
            byStructure.get(key)!.push(row)
          }
          for (const groupedRows of byStructure.values()) {
            const res = await createStructure(sb, {
              rows: groupedRows,
              structureType: groupedRows[0]?.structureType,
              exchange: exch,
              clientScope: {},
              createdBy: userId,
            })
            if (!res.ok) errors.push(`New structure: ${res.error}`)
          }
        }

        // Save backlog rows as unprocessed
        if (unprocessedRows && unprocessedRows.length > 0) {
          const res = await saveUnprocessedTrades(sb, {
            rows: unprocessedRows,
            clientScope: {},
            createdBy: userId,
          })
          if (!res.ok) errors.push(`Unprocessed trades: ${res.error}`)
        }

        if (errors.length > 0) {
          const MAX_SHOWN = 10
          const shown = errors.slice(0, MAX_SHOWN)
          const remaining = errors.length - shown.length
          const tail = remaining > 0 ? `\n…and ${remaining} more error${remaining > 1 ? 's' : ''}.` : ''
          alert(`Import completed with ${errors.length} error${errors.length > 1 ? 's' : ''}:\n\n${shown.join('\n')}${tail}`)
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
      <div className={embedded ? 'flex-1 flex flex-col' : 'min-h-screen bg-bg-canvas flex flex-col'}>
        {/* Header — only shown when not embedded (standalone page) */}
        {!embedded && (
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border-default">
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg hover:bg-bg-surface-4 transition-colors"
              aria-label="Back"
            >
              <ArrowLeft size={18} className="text-text-secondary" />
            </button>
            <h1 className="type-headline font-semibold text-text-primary">Import CSV</h1>
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
                ? 'bg-bg-surface-1 border-border-accent'
                : 'bg-bg-surface-1 border-border-default',
            ].join(' ')}
          >
            {/* Section label — upper left */}
            <div className="flex items-center gap-1.5">
              <FileText size={13} className="text-text-tertiary" />
              <span className="type-micro font-semibold uppercase tracking-[0.15em] text-text-tertiary">
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
                    ? 'border-border-accent text-text-primary bg-bg-surface-3-alpha'
                    : 'border-border-strong text-text-tertiary hover:border-border-accent hover:text-text-secondary hover:bg-bg-surface-1-alpha',
                ].join(' ')}
              >
                <FileText size={15} />
                <span className="type-subhead font-medium">+ Import CSV</span>
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
    <div className={embedded ? 'flex-1 flex flex-col' : 'min-h-screen bg-bg-canvas flex flex-col'}>
      {/* Header — only shown when not embedded (standalone page) */}
      {!embedded && (
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border-default">
          <button
            onClick={handleCancel}
            className="p-1.5 rounded-lg hover:bg-bg-surface-4 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={18} className="text-text-secondary" />
          </button>
          <h1 className="type-headline font-semibold text-text-primary">Mapping</h1>
          {localHeaders && (
            <span className="type-caption text-text-tertiary ml-1">— {localRawRows?.length ?? 0} rows</span>
          )}
        </div>
      )}

      {/* Card area — mirrors the upload zone layout */}
      <div className="flex-1 flex flex-col p-6 min-h-0">
        <div className="flex-1 flex flex-col bg-bg-surface-1 rounded-2xl border border-border-default overflow-hidden">

          {/* Card section label */}
          <div className="flex items-center gap-1.5 px-5 pt-5 pb-0">
            <FileText size={13} className="text-text-tertiary" />
            <span className="type-micro font-semibold uppercase tracking-[0.15em] text-text-tertiary">
              Mapping
            </span>
            {localHeaders && (
              <span className="type-micro-sm text-text-disabled ml-1">— {localRawRows?.length ?? 0} rows</span>
            )}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-5 pt-4 space-y-5">

            {/* Exchange selector */}
            <div>
              <label className="block type-micro-sm font-semibold uppercase tracking-[0.15em] text-text-tertiary mb-2">
                Exchange
              </label>
              <div className="relative">
                <select
                  value={exchange}
                  onChange={(e) => setExchange(e.target.value as 'deribit' | 'coincall' | 'cme')}
                  className="w-full appearance-none bg-bg-surface-3 border border-border-default rounded-2xl px-4 py-3 pr-9 type-subhead text-text-primary focus:outline-none focus:border-border-accent cursor-pointer transition-colors"
                >
                  <option value="deribit">Deribit</option>
                  <option value="coincall">Coincall</option>
                  <option value="cme">CME</option>
                </select>
                <ChevronsUpDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
              </div>
            </div>

            {/* Column mappings grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {EXPECTED_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="block type-micro-sm font-semibold uppercase tracking-[0.15em] text-text-tertiary mb-2">
                    {f.label}
                  </label>
                  <div className="relative">
                    <select
                      value={mapping[f.key] || ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                      className="w-full appearance-none bg-bg-surface-3 border border-border-default rounded-2xl px-4 py-3 pr-9 type-subhead text-text-primary focus:outline-none focus:border-border-accent cursor-pointer transition-colors"
                    >
                      <option value="">— select —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    <ChevronsUpDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                  </div>
                </div>
              ))}
            </div>

            {/* Import-only options */}
            {mode === 'import' && (
              <div className="space-y-2 pt-1">
                <label className="inline-flex items-center gap-2.5 type-caption text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importHistoricalRows}
                    onChange={(e) => setImportHistoricalRows(e.target.checked)}
                    className="rounded accent-accent-500"
                  />
                  <span>Import historical rows (skip duplicates)</span>
                </label>
                <label className="inline-flex items-center gap-2.5 type-caption text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowAllocations}
                    onChange={(e) => setAllowAllocations(e.target.checked)}
                    className="rounded accent-accent-500"
                  />
                  <span>Allow trade allocations (reuse trade/order IDs across structures)</span>
                </label>
              </div>
            )}

            {/* Re-upload option for local flow */}
            {localHeaders && (
              <div className="pt-1 border-t border-border-default">
                <button
                  onClick={() => { setLocalHeaders(null); setLocalRawRows(null) }}
                  className="type-caption text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  ← Upload a different file
                </button>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="px-5 py-4 border-t border-border-default flex justify-end gap-3">
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirm}
              disabled={isProcessing}
              loading={isProcessing}
            >
              {isProcessing ? 'Processing…' : mode === 'backfill' ? 'Start Backfill' : 'Start Import'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
