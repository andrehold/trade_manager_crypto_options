import React, { useEffect, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { Plus, X } from 'lucide-react'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Input } from './ui/Input'
import type { ProgramOption } from '../lib/positions/fetchPrograms'

export type StructureSummary = {
  key: string
  underlying: string
  expirySketch: string
  legCount: number
}

export type StrategyOption = {
  strategy_code: string
  strategy_name: string
}

export type StructureMetadata = {
  programId: string
  strategyName: string
  notes: string
}

type StructureDetailsOverlayProps = {
  structures: StructureSummary[]
  programs: ProgramOption[]
  programsLoading?: boolean
  strategies: StrategyOption[]
  strategiesLoading?: boolean
  initialStrategyCodes?: Map<string, string>
  onConfirm: (metadata: Map<string, StructureMetadata>) => void | Promise<void>
  onBack: () => void
  onCreateProgram: (name: string) => Promise<ProgramOption | null>
}

const selectClasses = [
  'w-full bg-bg-surface-2 border rounded-xl outline-none h-9 px-3',
  'text-text-primary placeholder:text-text-tertiary',
  'transition-colors duration-[120ms]',
  'focus:border-border-accent focus:shadow-[var(--glow-accent-sm)]',
].join(' ')

export function StructureDetailsOverlay({
  structures,
  programs,
  programsLoading,
  strategies,
  strategiesLoading,
  initialStrategyCodes,
  onConfirm,
  onBack,
  onCreateProgram,
}: StructureDetailsOverlayProps) {
  const [metadata, setMetadata] = React.useState<Map<string, StructureMetadata>>(() => {
    const m = new Map<string, StructureMetadata>()
    for (const s of structures) {
      // Pre-fill strategy from assign-legs selection if available
      const code = initialStrategyCodes?.get(s.key)
      const matched = code ? strategies.find((st) => st.strategy_code === code) : undefined
      m.set(s.key, { programId: '', strategyName: matched?.strategy_name ?? '', notes: '' })
    }
    return m
  })

  // When strategies load after mount, fill in any that matched initial codes but were empty
  React.useEffect(() => {
    if (!initialStrategyCodes || strategies.length === 0) return
    setMetadata((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const [key, entry] of next.entries()) {
        if (entry.strategyName) continue
        const code = initialStrategyCodes.get(key)
        if (!code) continue
        const matched = strategies.find((st) => st.strategy_code === code)
        if (matched) {
          next.set(key, { ...entry, strategyName: matched.strategy_name })
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [strategies, initialStrategyCodes])

  const [bulkProgramId, setBulkProgramId] = React.useState('')
  const [bulkStrategy, setBulkStrategy] = React.useState('')

  const [newProgramKey, setNewProgramKey] = React.useState<string | null>(null)
  const [newProgramName, setNewProgramName] = React.useState('')
  const [creatingProgram, setCreatingProgram] = React.useState(false)

  const [saving, setSaving] = React.useState(false)

  // Animation state
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true))
    })
  }, [])

  const updateField = (key: string, field: keyof StructureMetadata, value: string) => {
    setMetadata((prev) => {
      const next = new Map(prev)
      const entry = next.get(key)
      if (entry) next.set(key, { ...entry, [field]: value })
      return next
    })
  }

  const handleProgramChange = (key: string, value: string) => {
    if (value === '__new__') {
      setNewProgramKey(key)
      setNewProgramName('')
    } else {
      updateField(key, 'programId', value)
    }
  }

  const handleCreateProgram = async () => {
    if (!newProgramName.trim() || !newProgramKey) return
    setCreatingProgram(true)
    try {
      const result = await onCreateProgram(newProgramName.trim())
      if (result) {
        updateField(newProgramKey, 'programId', result.program_id)
      }
    } finally {
      setCreatingProgram(false)
      setNewProgramKey(null)
      setNewProgramName('')
    }
  }

  const applyBulk = () => {
    setMetadata((prev) => {
      const next = new Map(prev)
      for (const [key, entry] of next.entries()) {
        const updates: Partial<StructureMetadata> = {}
        if (bulkProgramId && !entry.programId) updates.programId = bulkProgramId
        if (bulkStrategy && !entry.strategyName) updates.strategyName = bulkStrategy
        if (Object.keys(updates).length > 0) {
          next.set(key, { ...entry, ...updates })
        }
      }
      return next
    })
  }

  const readyCount = Array.from(metadata.values()).filter((m) => m.programId).length
  const allReady = readyCount === structures.length

  const handleSave = async () => {
    if (!allReady) return
    setSaving(true)
    try {
      await onConfirm(metadata)
    } finally {
      setSaving(false)
    }
  }

  // ESC to go back
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack()
    },
    [onBack],
  )

  // ESC listener + lock body scroll
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [handleKeyDown])

  return ReactDOM.createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Complete Structure Details"
      className="fixed inset-0 z-modal flex items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-bg-overlay transition-opacity ${visible ? 'opacity-100' : 'opacity-0'}`}
        style={{
          transitionDuration: 'var(--duration-normal)',
          transitionTimingFunction: 'var(--easing-standard)',
        }}
        onClick={onBack}
      />

      {/* Dialog */}
      <div
        className={[
          'relative bg-bg-surface-1 border border-border-default rounded-2xl',
          'w-full max-w-5xl mx-4 flex flex-col max-h-[85vh]',
          'transition-all',
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
        ].join(' ')}
        style={{
          boxShadow: 'var(--shadow-overlay)',
          transitionDuration: 'var(--duration-normal)',
          transitionTimingFunction: 'var(--easing-standard)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div>
            <h2 className="type-title-m text-text-primary">Complete Structure Details</h2>
            <p className="type-micro text-text-tertiary mt-0.5">
              Fill in required fields before saving. Fields marked * are mandatory.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="type-micro text-text-tertiary">Step 2 of 2</span>
            <IconButton
              variant="ghost"
              size={32}
              icon={<X size={18} />}
              aria-label="Close"
              onClick={onBack}
            />
          </div>
        </div>

        {/* Apply to all bar */}
        <div className="mx-6 mt-4 mb-3 rounded-xl border border-border-default bg-bg-elevated p-3 flex items-end gap-3 flex-wrap">
          <span className="type-micro text-text-secondary font-semibold self-center whitespace-nowrap">
            Apply to all empty:
          </span>
          <label className="flex flex-col gap-0.5">
            <span className="type-micro text-text-tertiary">Program</span>
            <select
              className={`${selectClasses} border-border-default min-w-[160px]`}
              value={bulkProgramId}
              onChange={(e) => setBulkProgramId(e.target.value)}
            >
              <option value="">—</option>
              {programs.map((p) => (
                <option key={p.program_id} value={p.program_id}>
                  {p.program_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="type-micro text-text-tertiary">Strategy</span>
            <select
              className={`${selectClasses} border-border-default min-w-[160px]`}
              value={bulkStrategy}
              onChange={(e) => setBulkStrategy(e.target.value)}
            >
              <option value="">—</option>
              {strategies.map((s) => (
                <option key={s.strategy_code} value={s.strategy_name}>
                  {s.strategy_name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={applyBulk}
            disabled={!bulkProgramId && !bulkStrategy}
          >
            Apply
          </Button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-6">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-bg-elevated z-10">
              <tr className="type-micro text-text-tertiary font-semibold uppercase tracking-wide">
                <th className="text-left py-2 px-3">Structure</th>
                <th className="text-left py-2 px-3">Program *</th>
                <th className="text-left py-2 px-3">Strategy</th>
                <th className="text-left py-2 px-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {structures.map((s) => {
                const meta = metadata.get(s.key)!
                const isNewProgram = newProgramKey === s.key
                return (
                  <tr key={s.key} className="hover:bg-bg-surface-2 transition-colors">
                    {/* Structure summary */}
                    <td className="py-2.5 px-3 align-top">
                      <div className="type-subhead text-text-primary font-medium">{s.underlying}</div>
                      <div className="type-micro text-text-tertiary">{s.expirySketch}</div>
                      <div className="type-micro text-text-tertiary opacity-60">
                        {s.legCount} leg{s.legCount !== 1 ? 's' : ''}
                      </div>
                    </td>

                    {/* Program */}
                    <td className="py-2.5 px-3 align-top">
                      {isNewProgram ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            size="compact"
                            placeholder="Program name"
                            value={newProgramName}
                            onChange={(e) => setNewProgramName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleCreateProgram()
                              if (e.key === 'Escape') setNewProgramKey(null)
                            }}
                            autoFocus
                            disabled={creatingProgram}
                            className="min-w-[120px]"
                          />
                          <IconButton
                            variant="accent"
                            size={32}
                            icon={<Plus size={14} />}
                            aria-label="Create program"
                            onClick={() => void handleCreateProgram()}
                            disabled={!newProgramName.trim() || creatingProgram}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setNewProgramKey(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <select
                            className={`${selectClasses} w-full min-w-[160px] ${
                              !meta.programId ? 'border-status-danger' : 'border-border-default'
                            }`}
                            value={meta.programId}
                            onChange={(e) => handleProgramChange(s.key, e.target.value)}
                            disabled={programsLoading}
                          >
                            <option value="">{programsLoading ? 'Loading...' : 'Select...'}</option>
                            {programs.map((p) => (
                              <option key={p.program_id} value={p.program_id}>
                                {p.program_name}
                              </option>
                            ))}
                            <option value="__new__">+ New...</option>
                          </select>
                          {!meta.programId && (
                            <p className="type-micro text-status-danger-text mt-0.5">required</p>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Strategy */}
                    <td className="py-2.5 px-3 align-top">
                      <select
                        className={`${selectClasses} w-full min-w-[160px] border-border-default`}
                        value={meta.strategyName}
                        onChange={(e) => updateField(s.key, 'strategyName', e.target.value)}
                        disabled={strategiesLoading}
                      >
                        <option value="">{strategiesLoading ? 'Loading...' : 'Select...'}</option>
                        {strategies.map((st) => (
                          <option key={st.strategy_code} value={st.strategy_name}>
                            {st.strategy_name}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Notes */}
                    <td className="py-2.5 px-3 align-top">
                      <Input
                        size="compact"
                        value={meta.notes}
                        onChange={(e) => updateField(s.key, 'notes', e.target.value)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle">
          <Button variant="secondary" onClick={onBack} disabled={saving}>
            Back
          </Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={() => void handleSave()}
            disabled={!allReady || saving}
          >
            {saving
              ? 'Saving...'
              : allReady
                ? `Save ${structures.length} structure${structures.length !== 1 ? 's' : ''}`
                : `${readyCount}/${structures.length} ready`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
