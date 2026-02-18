import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TxnRow, Exchange, normalizeSecond, Position } from '../utils'
import {
  LegItem,
  BoardState,
  generateLegId,
  formatLegLabel,
  formatStructureLabel,
  suggestStructureType,
} from './dndUtils'
import { buildStructureChipSummary } from '../lib/positions'

/* ─────────────────────── types ─────────────────────── */

type SavedStructureInfo = {
  id: string
  label: string
  position: Position
}

type StructureDnDOverlayProps = {
  rows: TxnRow[]
  excludedRows: TxnRow[]
  exchange: Exchange
  savedStructures?: Position[]
  onConfirm: (rows: TxnRow[], unprocessedRows?: TxnRow[]) => void | Promise<void>
  onCancel: () => void
}

/* ─────────────── compact draggable chip ─────────────── */

function LegChip({
  legItem,
  exchange,
  onRemove,
}: {
  legItem: LegItem
  exchange: Exchange
  onRemove?: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: legItem.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const ts = legItem.row.timestamp ?? ''
  // Show hh:mm:ss from the timestamp
  const timePart = ts.includes('T')
    ? ts.split('T')[1]?.slice(0, 8) ?? ''
    : ts.includes(' ')
    ? ts.split(' ')[1]?.slice(0, 8) ?? ''
    : ''
  const datePart = ts.slice(0, 10)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-md px-2 py-1 text-xs cursor-grab active:cursor-grabbing hover:border-slate-400 hover:shadow-sm touch-none select-none transition-colors"
    >
      <span className="font-semibold text-slate-800 whitespace-nowrap">
        {formatLegLabel(legItem.row, exchange)}
      </span>
      <span className="text-[10px] text-slate-400 whitespace-nowrap" title={ts}>
        {datePart} {timePart}
      </span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-0.5 text-slate-400 hover:text-rose-500 text-[10px] leading-none"
          title="Remove from structure"
        >
          ✕
        </button>
      )}
    </div>
  )
}

/* ─────────────── ghost chip while dragging ─────────────── */

function GhostChip({ legItem, exchange }: { legItem: LegItem; exchange: Exchange }) {
  return (
    <div className="inline-flex items-center gap-1.5 bg-white border-2 border-blue-400 rounded-md px-2 py-1 text-xs shadow-lg">
      <span className="font-semibold text-slate-800 whitespace-nowrap">
        {formatLegLabel(legItem.row, exchange)}
      </span>
    </div>
  )
}

/* ─────────────── droppable wrapper ─────────────── */

function Droppable({
  id,
  children,
  className,
}: {
  id: string
  children: React.ReactNode
  className?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`${className ?? ''} ${isOver ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
    >
      {children}
    </div>
  )
}

/* ─────────────── new-structure drop zone ─────────────── */

function NewStructureDropZone({
  items,
  exchange,
  onSave,
  onRemoveItem,
}: {
  items: LegItem[]
  exchange: Exchange
  onSave: () => void
  onRemoveItem: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'new-structure' })

  return (
    <div
      ref={setNodeRef}
      className={`border-2 border-dashed rounded-lg p-3 transition-colors ${
        isOver
          ? 'border-blue-500 bg-blue-50'
          : items.length > 0
          ? 'border-emerald-300 bg-emerald-50/50'
          : 'border-slate-300 bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
          New Structure
        </p>
        {items.length > 0 && (
          <button
            onClick={onSave}
            className="px-2.5 py-0.5 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            Save
          </button>
        )}
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-wrap gap-1.5 min-h-[32px]">
          {items.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic py-1">
              Drop legs here to create a new structure
            </p>
          ) : (
            items.map((item) => (
              <LegChip
                key={item.id}
                legItem={item}
                exchange={exchange}
                onRemove={() => onRemoveItem(item.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/* ──────── read-only chip for existing legs in saved structures ──────── */

function ExistingLegChip({ leg }: { leg: import('../utils').Leg }) {
  const sign = leg.qtyNet >= 0 ? '+' : '-'
  const qty = Math.abs(leg.qtyNet)
  const qtyStr = qty % 1 === 0 ? String(qty) : qty.toFixed(2)
  const strike = leg.strike
  const ot = leg.optionType
  return (
    <span className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-md px-1.5 py-0.5 text-[10px] text-slate-500 select-none">
      {sign}{qtyStr} / {ot}{strike}
    </span>
  )
}

/* ─────────────── saved structure card ─────────────── */

function SavedStructureCard({
  structureId,
  label,
  existingLegs,
  newLegs,
  exchange,
  onRemoveItem,
}: {
  structureId: string
  label: string
  existingLegs: import('../utils').Leg[]
  newLegs: LegItem[]
  exchange: Exchange
  onRemoveItem: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: structureId })

  return (
    <div
      ref={setNodeRef}
      className={`border rounded-lg p-3 transition-colors ${
        isOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-xs font-semibold text-slate-700 mb-1.5 truncate" title={label}>
        {label}
      </p>
      {/* existing legs (read-only) */}
      {existingLegs.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {existingLegs.map((leg, i) => (
            <ExistingLegChip key={`existing-${i}`} leg={leg} />
          ))}
        </div>
      )}
      {/* new legs (draggable, removable) */}
      <SortableContext items={newLegs.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {newLegs.length === 0 ? (
            <p className="text-[10px] text-slate-400 italic py-0.5">
              Drop legs to add
            </p>
          ) : (
            newLegs.map((item) => (
              <LegChip
                key={item.id}
                legItem={item}
                exchange={exchange}
                onRemove={() => onRemoveItem(item.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/* ─────────────── local (unsaved) structure card ─────────────── */

function LocalStructureCard({
  structureId,
  items,
  meta,
  exchange,
  onTypeChange,
  onRemove,
  onRemoveItem,
}: {
  structureId: string
  items: LegItem[]
  meta: { type: string }
  exchange: Exchange
  onTypeChange: (type: string) => void
  onRemove: () => void
  onRemoveItem: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: structureId })

  return (
    <div
      ref={setNodeRef}
      className={`border rounded-lg p-3 transition-colors ${
        isOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-slate-700 truncate flex-1">
          {formatStructureLabel(items, meta.type)}
        </p>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          <select
            value={meta.type}
            onChange={(e) => onTypeChange(e.target.value)}
            className="border rounded px-1.5 py-0.5 text-[10px] bg-white"
          >
            <option value="IC">IC</option>
            <option value="DS">DS</option>
            <option value="Custom">Custom</option>
          </select>
          <button
            onClick={onRemove}
            className="text-[10px] text-rose-500 hover:text-rose-700"
            title="Delete structure"
          >
            ✕
          </button>
        </div>
      </div>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {items.length === 0 ? (
            <p className="text-[10px] text-slate-400 italic py-0.5">Drop legs here</p>
          ) : (
            items.map((item) => (
              <LegChip
                key={item.id}
                legItem={item}
                exchange={exchange}
                onRemove={() => onRemoveItem(item.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/* ═══════════════════════ MAIN OVERLAY ═══════════════════════ */

export function StructureDnDOverlay({
  rows,
  excludedRows,
  exchange,
  savedStructures = [],
  onConfirm,
  onCancel,
}: StructureDnDOverlayProps) {
  const [activeTab, setActiveTab] = useState<'included' | 'excluded'>('included')
  const [importing, setImporting] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  /* ── build saved-structure info ── */
  const savedStructureInfos = useMemo<SavedStructureInfo[]>(() => {
    return savedStructures
      .filter((s) => !s.archived && !s.archivedAt)
      .map((s) => ({
        id: s.id,
        label: `[${s.structureId ?? s.id}] ${buildStructureChipSummary(s) ?? s.underlying ?? ''}`,
        position: s,
      }))
  }, [savedStructures])

  /* ── initialize board ── */
  const initialBoard = useMemo((): BoardState => {
    const itemsById: Record<string, LegItem> = {}
    const containers: Record<string, string[]> = {
      backlog: [],
      'new-structure': [],
    }

    // All included rows start in backlog, sorted oldest first (already sorted by time)
    const sorted = [...rows].sort((a, b) => {
      const ta = a.timestamp ?? ''
      const tb = b.timestamp ?? ''
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })

    sorted.forEach((row, idx) => {
      const id = generateLegId(row, idx)
      itemsById[id] = { id, row, included: true }
      containers.backlog.push(id)
    })

    // Create empty container for each saved structure
    for (const info of savedStructureInfos) {
      containers[`saved:${info.id}`] = []
    }

    return {
      itemsById,
      containers,
      structureOrder: [],
      structureMeta: {},
    }
  }, [rows, savedStructureInfos])

  const [board, setBoard] = useState(initialBoard)

  // Reset board when rows change
  useEffect(() => {
    setBoard(initialBoard)
  }, [initialBoard])

  /* ── sensors ── */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor),
  )

  /* ── find which container owns an item ── */
  const findContainer = useCallback(
    (itemId: string, state: BoardState): string | null => {
      for (const [cId, ids] of Object.entries(state.containers)) {
        if (ids.includes(itemId)) return cId
      }
      return null
    },
    [],
  )

  /* ── drag handlers ── */
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    setBoard((prev) => {
      const next = {
        ...prev,
        containers: { ...prev.containers },
        structureOrder: [...prev.structureOrder],
        structureMeta: { ...prev.structureMeta },
      }

      // deep-copy touched arrays
      for (const k of Object.keys(next.containers)) {
        next.containers[k] = [...next.containers[k]]
      }

      const srcId = findContainer(activeId, next)
      if (!srcId) return prev

      // determine target container
      let targetId: string | null = null

      // If dropped on a known container id directly
      if (next.containers[overId] !== undefined) {
        targetId = overId
      } else {
        // dropped on another item — find its container
        targetId = findContainer(overId, next)
      }

      if (!targetId) return prev
      if (srcId === targetId) return prev // same container, ignore reorder for simplicity

      // move item
      next.containers[srcId] = next.containers[srcId].filter((id) => id !== activeId)
      next.containers[targetId].push(activeId)

      return next
    })
  }

  /* ── derived data ── */
  const backlogItems = (board.containers.backlog ?? []).map((id) => board.itemsById[id])
  const newStructureItems = (board.containers['new-structure'] ?? []).map(
    (id) => board.itemsById[id],
  )
  const localStructureIds = board.structureOrder.filter((id) => board.containers[id])

  /* ── backlog count (validation) ── */
  const backlogCount = backlogItems.length
  const newStructureCount = newStructureItems.length
  const canImport = backlogCount === 0 && newStructureCount === 0

  /* ── save "new structure" → local structure ── */
  const handleSaveNewStructure = () => {
    if (newStructureItems.length === 0) return
    setBoard((prev) => {
      const next = {
        ...prev,
        containers: { ...prev.containers },
        structureOrder: [...prev.structureOrder],
        structureMeta: { ...prev.structureMeta },
      }
      for (const k of Object.keys(next.containers)) {
        next.containers[k] = [...next.containers[k]]
      }

      const structId = `structure:${Date.now()}`
      const itemIds = next.containers['new-structure']
      next.containers[structId] = itemIds
      next.containers['new-structure'] = []
      next.structureOrder.push(structId)
      next.structureMeta[structId] = {
        type: suggestStructureType(itemIds.map((id) => next.itemsById[id])),
      }
      return next
    })
  }

  /* ── remove item from any structure → back to backlog ── */
  const handleRemoveItem = useCallback((itemId: string) => {
    setBoard((prev) => {
      const next = {
        ...prev,
        containers: { ...prev.containers },
      }
      for (const k of Object.keys(next.containers)) {
        next.containers[k] = [...next.containers[k]]
      }

      const srcId = findContainer(itemId, next)
      if (!srcId || srcId === 'backlog') return prev

      next.containers[srcId] = next.containers[srcId].filter((id) => id !== itemId)
      next.containers.backlog = [...next.containers.backlog, itemId]

      // re-sort backlog by timestamp
      next.containers.backlog.sort((a, b) => {
        const ta = next.itemsById[a]?.row.timestamp ?? ''
        const tb = next.itemsById[b]?.row.timestamp ?? ''
        return ta < tb ? -1 : ta > tb ? 1 : 0
      })

      return next
    })
  }, [findContainer])

  /* ── delete local structure → legs back to backlog ── */
  const handleRemoveStructure = (structureId: string) => {
    setBoard((prev) => {
      const next = {
        ...prev,
        containers: { ...prev.containers },
        structureOrder: [...prev.structureOrder],
        structureMeta: { ...prev.structureMeta },
      }
      for (const k of Object.keys(next.containers)) {
        next.containers[k] = [...next.containers[k]]
      }

      const itemIds = next.containers[structureId] ?? []
      next.containers.backlog = [...next.containers.backlog, ...itemIds]
      next.containers.backlog.sort((a, b) => {
        const ta = next.itemsById[a]?.row.timestamp ?? ''
        const tb = next.itemsById[b]?.row.timestamp ?? ''
        return ta < tb ? -1 : ta > tb ? 1 : 0
      })
      delete next.containers[structureId]
      next.structureOrder = next.structureOrder.filter((id) => id !== structureId)
      delete next.structureMeta[structureId]
      return next
    })
  }

  const handleStructureTypeChange = (structureId: string, type: string) => {
    setBoard((prev) => ({
      ...prev,
      structureMeta: {
        ...prev.structureMeta,
        [structureId]: { ...prev.structureMeta[structureId], type },
      },
    }))
  }

  /* ── import ── */
  const handleImport = async () => {
    if (!canImport || importing) return

    const payload: TxnRow[] = []

    // Local structures
    for (const structureId of board.structureOrder) {
      const itemIds = board.containers[structureId] || []
      for (const itemId of itemIds) {
        const item = board.itemsById[itemId]
        if (item?.included) {
          payload.push({ ...item.row, structureId })
        }
      }
    }

    // Saved structures — legs dragged into them get linkedStructureId
    for (const info of savedStructureInfos) {
      const containerId = `saved:${info.id}`
      const itemIds = board.containers[containerId] || []
      for (const itemId of itemIds) {
        const item = board.itemsById[itemId]
        if (item?.included) {
          payload.push({
            ...item.row,
            structureId: info.id,
            linkedStructureId: info.id,
          })
        }
      }
    }

    if (payload.length === 0) return

    try {
      setImporting(true)
      await onConfirm(payload)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import trades.'
      alert(message)
    } finally {
      setImporting(false)
    }
  }

  /* ── all sortable IDs for DndContext ── */
  const allItemIds = Object.keys(board.itemsById)

  /* ── validation message ── */
  const validationMsg = (() => {
    const parts: string[] = []
    if (backlogCount > 0) parts.push(`${backlogCount} unassigned leg${backlogCount !== 1 ? 's' : ''}`)
    if (newStructureCount > 0)
      parts.push(`${newStructureCount} leg${newStructureCount !== 1 ? 's' : ''} in unsaved new structure`)
    return parts.length > 0 ? parts.join(', ') : null
  })()

  /* ═════════════════════ RENDER ═════════════════════ */

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* ── header ── */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b">
          <h3 className="text-lg font-semibold">Assign Legs to Structures</h3>
          <div className="ml-auto flex gap-2 text-sm">
            <button
              className={`px-3 py-1 rounded-lg border text-xs ${
                activeTab === 'included' ? 'bg-slate-900 text-white' : ''
              }`}
              onClick={() => setActiveTab('included')}
            >
              Included ({rows.length})
            </button>
            <button
              className={`px-3 py-1 rounded-lg border text-xs ${
                activeTab === 'excluded' ? 'bg-slate-900 text-white' : ''
              }`}
              onClick={() => setActiveTab('excluded')}
            >
              Excluded ({excludedRows.length})
            </button>
          </div>
        </div>

        {/* ── body ── */}
        <div className="flex-1 min-h-0 px-6 py-4">
          {activeTab === 'included' ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-6 h-full">
                {/* ──── LEFT COLUMN: Backlog ──── */}
                <div className="w-72 shrink-0 flex flex-col min-h-0">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    New Legs ({backlogCount})
                  </p>
                  <Droppable
                    id="backlog"
                    className="flex-1 overflow-y-auto border rounded-lg p-2 bg-slate-50"
                  >
                    <SortableContext
                      items={backlogItems.map((i) => i.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="flex flex-col gap-1">
                        {backlogItems.length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic text-center py-4">
                            All legs assigned
                          </p>
                        ) : (
                          backlogItems.map((item) => (
                            <LegChip key={item.id} legItem={item} exchange={exchange} />
                          ))
                        )}
                      </div>
                    </SortableContext>
                  </Droppable>
                </div>

                {/* ──── RIGHT COLUMN: Structures ──── */}
                <div className="flex-1 min-w-0 overflow-y-auto flex flex-col gap-4">
                  {/* New structure drop zone */}
                  <NewStructureDropZone
                    items={newStructureItems}
                    exchange={exchange}
                    onSave={handleSaveNewStructure}
                    onRemoveItem={handleRemoveItem}
                  />

                  {/* Local (unsaved) structures created via Save */}
                  {localStructureIds.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                        New Structures (overlay only)
                      </p>
                      <div className="space-y-3">
                        {localStructureIds.map((sId) => (
                          <LocalStructureCard
                            key={sId}
                            structureId={sId}
                            items={(board.containers[sId] ?? []).map(
                              (id) => board.itemsById[id],
                            )}
                            meta={board.structureMeta[sId] ?? { type: 'Custom' }}
                            exchange={exchange}
                            onTypeChange={(t) => handleStructureTypeChange(sId, t)}
                            onRemove={() => handleRemoveStructure(sId)}
                            onRemoveItem={handleRemoveItem}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Saved structures from DB */}
                  {savedStructureInfos.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                        Saved Structures
                      </p>
                      <div className="space-y-3">
                        {savedStructureInfos.map((info) => {
                          const containerId = `saved:${info.id}`
                          const newLegs = (board.containers[containerId] ?? []).map(
                            (id) => board.itemsById[id],
                          )
                          return (
                            <SavedStructureCard
                              key={info.id}
                              structureId={containerId}
                              label={info.label}
                              existingLegs={info.position.legs}
                              newLegs={newLegs}
                              exchange={exchange}
                              onRemoveItem={handleRemoveItem}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {savedStructureInfos.length === 0 && localStructureIds.length === 0 && (
                    <p className="text-xs text-slate-400 italic text-center py-6">
                      No saved structures. Drop legs above to create one.
                    </p>
                  )}
                </div>
              </div>

              {/* Drag ghost */}
              <DragOverlay>
                {activeDragId && board.itemsById[activeDragId] ? (
                  <GhostChip legItem={board.itemsById[activeDragId]} exchange={exchange} />
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            /* ──── Excluded tab ──── */
            <div className="space-y-3 overflow-auto h-full">
              <p className="text-sm text-slate-600">
                These rows were auto-excluded (non-option instruments). Review only.
              </p>
              {excludedRows.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No excluded rows.</p>
              ) : (
                <div className="overflow-auto border rounded-lg">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="p-2 text-left">Instrument</th>
                        <th className="p-2 text-left">Side</th>
                        <th className="p-2 text-left">Amount</th>
                        <th className="p-2 text-left">Price</th>
                        <th className="p-2 text-left">Trade ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excludedRows.map((r, i) => (
                        <tr key={i} className="border-t opacity-70">
                          <td className="p-2">{r.instrument}</td>
                          <td className="p-2 capitalize">{r.side}</td>
                          <td className="p-2">{r.amount}</td>
                          <td className="p-2">{r.price}</td>
                          <td className="p-2">{r.trade_id || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── footer ── */}
        <div className="px-6 py-3 border-t flex items-center gap-3">
          {validationMsg && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1">
              {validationMsg}
            </span>
          )}
          <div className="ml-auto flex gap-3">
            <button onClick={onCancel} className="px-4 py-2 rounded-xl border text-sm">
              Back
            </button>
            <button
              onClick={handleImport}
              disabled={!canImport || importing}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm disabled:opacity-50"
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
