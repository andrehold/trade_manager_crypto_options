import React, { useCallback, useRef, useState } from 'react'
import Papa from 'papaparse'
import { ArrowLeft, Upload, AlertTriangle, CheckCircle2, FileText } from 'lucide-react'
import { type TxnRow, type Exchange, type Position, normalizeSecond } from '../../utils'
import { parseDeribitPositionsCSV, type ParsedDeribitPositions } from '../../lib/import/parseDeribitPositionsCSV'
import { massCloseForReconcile } from '../../lib/positions/massCloseForReconcile'
import { tryGetSupabaseClient } from '../../lib/supabase'
import { fetchSavedStructures } from '../../lib/positions'
import { createStructure } from '../../lib/positions/createStructure'
import { setAssignLegsContext } from '../assignLegs/assignLegsStore'
import { Button } from '../../components/ui'

type Props = {
  onBack: () => void
  onOpenAssignLegs?: () => void
  embedded?: boolean
  strategies?: { strategy_code: string; strategy_name: string }[]
}

type Step = 'upload' | 'preview' | 'confirming'

export function ReconcilePage({ onBack, onOpenAssignLegs, embedded, strategies = [] }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [parsed, setParsed] = useState<ParsedDeribitPositions | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (!text) {
        setError('Could not read file contents.')
        return
      }
      const result = parseDeribitPositionsCSV(text)
      if (result.rows.length === 0) {
        setError(`No option positions found in CSV. ${result.skipped.length} rows were skipped.`)
        return
      }
      setParsed(result)
      setStep('preview')
    }
    reader.onerror = () => setError('Failed to read file.')
    reader.readAsText(file)
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleConfirmReconcile = async () => {
    if (!parsed) return
    setProcessing(true)
    setError(null)

    try {
      const supabase = tryGetSupabaseClient()
      if (!supabase) throw new Error('Supabase is not configured.')

      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) throw new Error('You must be signed in to reconcile.')

      const userId = authData.user.id

      // Step 1: Mass-close all open positions
      const closeResult = await massCloseForReconcile(supabase)
      if (!closeResult.ok) throw new Error(closeResult.error)

      // Step 2: Set up assign-legs context with reconcile mode
      const strategyOptions = strategies.map((s) => ({
        strategy_code: s.strategy_code,
        strategy_name: s.strategy_name,
      }))

      const onConfirm = async (selectedRows: TxnRow[], unprocessedRows?: TxnRow[]) => {
        const sb = tryGetSupabaseClient()
        if (!sb) throw new Error('Supabase is not configured.')

        const { data: auth } = await sb.auth.getUser()
        if (!auth.user) throw new Error('You must be signed in.')

        // Group rows by structureId and create structures
        const localRows = selectedRows.filter((r) => !r.linkedStructureId)
        const errors: string[] = []

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
              exchange: 'deribit',
              clientScope: {},
              createdBy: auth.user.id,
              notes: 'Created via positions CSV reconciliation',
            })
            if (!res.ok) errors.push(`New structure: ${res.error}`)
          }
        }

        if (errors.length > 0) {
          throw new Error(`Reconciliation errors:\n${errors.join('\n')}`)
        }
      }

      setAssignLegsContext({
        rows: parsed.rows,
        noImportRows: [],
        processedRows: [],
        exchange: 'deribit' as Exchange,
        savedStructures: [],
        strategies: strategyOptions,
        onConfirm,
        onCancel: () => {
          window.location.hash = ''
        },
        mode: 'reconcile',
      })

      setShowConfirmDialog(false)
      onOpenAssignLegs?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconciliation failed.')
    } finally {
      setProcessing(false)
    }
  }

  const handleReset = () => {
    setParsed(null)
    setStep('upload')
    setError(null)
    setShowConfirmDialog(false)
  }

  // Group parsed rows by expiry for the preview
  const expiryGroups = React.useMemo(() => {
    if (!parsed) return []
    const groups = new Map<string, TxnRow[]>()
    for (const row of parsed.rows) {
      const expiry = row.expiry ?? 'Unknown'
      if (!groups.has(expiry)) groups.set(expiry, [])
      groups.get(expiry)!.push(row)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [parsed])

  return (
    <div className={embedded ? 'flex-1 min-h-0 flex flex-col bg-bg-canvas' : 'h-screen flex flex-col bg-bg-canvas'}>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-6 pt-5 pb-3 border-b border-border-default">
        {!embedded && (
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-bg-surface-2 text-text-secondary transition-colors"
            title="Back to dashboard"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <h3 className="type-subhead font-semibold text-text-primary tracking-tight">
          Reconcile Positions
        </h3>
        {step === 'preview' && (
          <Button variant="ghost" size="sm" onClick={handleReset} className="ml-auto">
            Start Over
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {error && (
          <div className="mb-4 flex items-start gap-2 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 type-body">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Upload Step ── */}
        {step === 'upload' && (
          <div className="max-w-xl mx-auto mt-8">
            <div className="text-center mb-6">
              <h4 className="type-body font-semibold text-text-primary mb-2">
                Import Deribit Positions CSV
              </h4>
              <p className="type-caption text-text-secondary">
                Upload a positions snapshot exported from Deribit. This will close all currently open
                positions in the system and create new structures from the CSV.
              </p>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
                ${isDragging
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-border-strong hover:border-border-accent bg-bg-surface-1-alpha'
                }
              `}
            >
              <Upload size={32} className="mx-auto mb-3 text-text-muted" />
              <p className="type-body text-text-secondary mb-1">
                Drop your Deribit positions CSV here
              </p>
              <p className="type-caption text-text-muted">or click to browse</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileInput}
                className="hidden"
              />
            </div>
          </div>
        )}

        {/* ── Preview Step ── */}
        {step === 'preview' && parsed && (
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-5">
              <CheckCircle2 size={20} className="text-emerald-400" />
              <span className="type-body text-text-primary font-medium">
                {parsed.rows.length} option position{parsed.rows.length !== 1 ? 's' : ''} found
              </span>
              {parsed.skipped.length > 0 && (
                <span className="type-caption text-text-muted">
                  ({parsed.skipped.length} non-option row{parsed.skipped.length !== 1 ? 's' : ''} skipped)
                </span>
              )}
            </div>

            {/* Positions grouped by expiry */}
            <div className="space-y-4 mb-6">
              {expiryGroups.map(([expiry, rows]) => (
                <div key={expiry} className="border border-border-default rounded-xl overflow-hidden">
                  <div className="bg-bg-surface-1-alpha px-4 py-2 border-b border-border-default">
                    <span className="type-caption font-semibold text-text-secondary uppercase tracking-wider">
                      {expiry}
                    </span>
                    <span className="type-caption text-text-muted ml-2">
                      ({rows.length} leg{rows.length !== 1 ? 's' : ''})
                    </span>
                  </div>
                  <div className="divide-y divide-border-default">
                    {rows.map((row, i) => (
                      <div key={i} className="px-4 py-2 flex items-center gap-4 type-caption">
                        <span className={`font-mono font-medium w-8 ${row.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {row.side === 'buy' ? '+' : '-'}{row.amount}
                        </span>
                        <span className="text-text-primary font-medium flex-1 truncate">
                          {row.instrument}
                        </span>
                        <span className="text-text-muted">
                          avg: {row.price}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Action */}
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowConfirmDialog(true)}
                disabled={processing}
              >
                Reconcile Positions
              </Button>
              <Button variant="ghost" size="sm" onClick={handleReset}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Confirmation Dialog ── */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-bg-surface-1 border border-border-strong rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle size={24} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="type-body font-semibold text-text-primary mb-1">
                  Confirm Reconciliation
                </h4>
                <p className="type-caption text-text-secondary leading-relaxed">
                  Reconciling will <strong className="text-text-primary">close all currently open positions and structures</strong> in
                  the system (marked as <code className="bg-bg-surface-3-alpha px-1 py-0.5 rounded text-xs">reconcile_close</code>).
                  This cannot be undone.
                </p>
                <p className="type-caption text-text-secondary mt-2">
                  {parsed?.rows.length} new position{parsed?.rows.length !== 1 ? 's' : ''} from the CSV will then be available
                  for assignment to structures.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConfirmDialog(false)}
                disabled={processing}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmReconcile}
                disabled={processing}
                className="!bg-amber-600 hover:!bg-amber-500"
              >
                {processing ? 'Closing positions...' : 'Confirm & Reconcile'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
