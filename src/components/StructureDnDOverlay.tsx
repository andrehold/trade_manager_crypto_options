import React, { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useSortable } from '@dnd-kit/sortable'
import { TxnRow, Exchange, normalizeSecond } from '../utils'
import {
  LegItem,
  BoardState,
  generateLegId,
  formatLegLabel,
  formatStructureLabel,
  autoGroupByTime,
  suggestStructureType,
} from './dndUtils'

// Helper to normalize timestamp
const getNormalizeSecond = () => normalizeSecond

type StructureDnDOverlayProps = {
  rows: TxnRow[]
  excludedRows: TxnRow[]
  exchange: Exchange
  onConfirm: (rows: TxnRow[], unprocessedRows?: TxnRow[]) => void | Promise<void>
  onCancel: () => void
}

/**
 * Draggable leg item in a container
 */
function DraggableLegItem({ legItem }: { legItem: LegItem }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: legItem.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-white border border-slate-200 rounded-lg p-3 cursor-move hover:bg-slate-50 touch-none"
    >
      <p className="text-sm font-medium text-slate-900">{formatLegLabel(legItem.row, 'deribit')}</p>
      <p className="text-xs text-slate-500 mt-1">
        {legItem.row.trade_id || legItem.row.order_id || legItem.row.instrument}
      </p>
    </div>
  )
}

/**
 * Droppable container for structure
 */
function StructureContainer({
  structureId,
  items,
  meta,
  onTypeChange,
  onRemove,
}: {
  structureId: string
  items: LegItem[]
  meta: { type: string }
  onTypeChange: (type: string) => void
  onRemove: () => void
}) {
  const { setNodeRef, isOver } = useSortable({
    id: structureId,
    data: { type: 'container', structureId },
  })

  return (
    <div
      ref={setNodeRef}
      className={`border-2 rounded-lg p-4 min-h-[200px] ${
        isOver ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">{formatStructureLabel(items, meta.type)}</p>
          <p className="text-xs text-slate-500 mt-1">{structureId}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={meta.type}
            onChange={(e) => onTypeChange(e.target.value)}
            className="border rounded-lg px-2 py-1 text-xs bg-white"
          >
            <option value="IC">IC</option>
            <option value="DS">DS</option>
            <option value="Custom">Custom</option>
          </select>
          <button
            onClick={onRemove}
            className="text-xs text-rose-600 hover:text-rose-700 px-2 py-1"
            title="Delete this structure"
          >
            ✕
          </button>
        </div>
      </div>

      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Drop legs here</p>
          ) : (
            items.map((item) => <DraggableLegItem key={item.id} legItem={item} />)
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/**
 * Create New Structure zone
 */
function CreateStructureZone() {
  const { setNodeRef, isOver } = useSortable({
    id: 'create-structure',
    data: { type: 'create-structure' },
  })

  return (
    <div
      ref={setNodeRef}
      className={`border-2 border-dashed rounded-lg p-8 text-center ${
        isOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50'
      }`}
    >
      <p className="text-sm font-medium text-slate-600">Drop here to create a new structure</p>
    </div>
  )
}

/**
 * Container for unassigned legs
 */
function UnassignedContainer({ items }: { items: LegItem[] }) {
  const { setNodeRef, isOver } = useSortable({
    id: 'unassigned',
    data: { type: 'container' },
  })

  return (
    <div
      ref={setNodeRef}
      className={`border-2 rounded-lg p-4 min-h-[150px] ${
        isOver ? 'border-amber-500 bg-amber-50' : items.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-sm font-semibold text-slate-900 mb-3">
        Unassigned {items.length > 0 ? `(${items.length})` : ''}
      </p>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-xs text-slate-400 italic">All legs assigned</p>
          ) : (
            items.map((item) => <DraggableLegItem key={item.id} legItem={item} />)
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/**
 * Container for excluded legs
 */
function ExcludedContainer({ items }: { items: LegItem[] }) {
  const { setNodeRef, isOver } = useSortable({
    id: 'excluded',
    data: { type: 'container' },
  })

  return (
    <div
      ref={setNodeRef}
      className={`border-2 rounded-lg p-4 min-h-[150px] ${
        isOver ? 'border-rose-500 bg-rose-50' : items.length > 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-sm font-semibold text-slate-900 mb-3">
        Excluded {items.length > 0 ? `(${items.length})` : ''}
      </p>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No excluded legs</p>
          ) : (
            items.map((item) => <DraggableLegItem key={item.id} legItem={item} />)
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/**
 * Main overlay component with DnD board
 */
export function StructureDnDOverlay({
  rows,
  excludedRows,
  exchange,
  onConfirm,
  onCancel,
}: StructureDnDOverlayProps) {
  const [activeTab, setActiveTab] = useState<'included' | 'excluded'>('included')
  const [importing, setImporting] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  // Initialize board state
  const initialBoard = useMemo((): BoardState => {
    const itemsById: Record<string, LegItem> = {}
    const containers: Record<string, string[]> = {
      unassigned: [],
      excluded: [],
    }

    // Add included rows
    rows.forEach((row, idx) => {
      const id = generateLegId(row, idx)
      itemsById[id] = { id, row, included: true }
      containers.unassigned.push(id)
    })

    // Add excluded rows
    excludedRows.forEach((row, idx) => {
      const id = generateLegId(row, rows.length + idx)
      itemsById[id] = { id, row, included: false }
      containers.excluded.push(id)
    })

    return {
      itemsById,
      containers,
      structureOrder: [],
      structureMeta: {},
    }
  }, [rows, excludedRows])

  const [board, setBoard] = useState(initialBoard)

  // Apply auto-grouping on mount
  useEffect(() => {
    const autoGroupMap = autoGroupByTime(rows, normalizeSecond)
    setBoard((prev) => {
      const newBoard = { ...prev }
      newBoard.containers = {
        unassigned: [],
        excluded: prev.containers.excluded,
      }

      // Group items by auto-group result
      const groupMap = new Map<number, string[]>()
      for (const [itemId, groupNum] of Object.entries(autoGroupMap)) {
        if (!groupMap.has(groupNum)) {
          groupMap.set(groupNum, [])
        }
        groupMap.get(groupNum)!.push(itemId)
      }

      // Create structures from groups
      let structureNum = 1
      for (const [_, itemIds] of groupMap) {
        const structId = `structure:${structureNum++}`
        newBoard.containers[structId] = itemIds
        newBoard.structureOrder.push(structId)
        newBoard.structureMeta[structId] = {
          type: suggestStructureType(itemIds.map((id) => newBoard.itemsById[id])),
        }
      }

      return newBoard
    })
  }, []) // Only on mount

  // Sensors for drag
  const sensors = useSensors(
    useSensor(PointerSensor, { distance: 5 } as any),
    useSensor(KeyboardSensor),
  )

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
  }

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    setBoard((prev) => {
      const newBoard = { ...prev }

      // Find source container
      let sourceContainerId: string | null = null
      for (const [containerId, itemIds] of Object.entries(newBoard.containers)) {
        if (itemIds.includes(activeId)) {
          sourceContainerId = containerId
          break
        }
      }

      if (!sourceContainerId) return prev

      // Remove from source
      newBoard.containers[sourceContainerId] = newBoard.containers[sourceContainerId].filter(
        (id) => id !== activeId,
      )

      // Handle different drop targets
      if (overId === 'create-structure') {
        // Create new structure
        const newStructureId = `structure:${Date.now()}`
        newBoard.containers[newStructureId] = [activeId]
        newBoard.structureOrder.push(newStructureId)
        newBoard.structureMeta[newStructureId] = { type: 'Custom' }
      } else if (newBoard.containers[overId as string]) {
        // Drop into existing container
        const targetItems = newBoard.containers[overId as string]
        // Find position of over item if it exists
        const overIndex = targetItems.findIndex((id) => id === overId)
        if (overIndex >= 0) {
          targetItems.splice(overIndex, 0, activeId)
        } else {
          targetItems.push(activeId)
        }
      } else {
        // overId might be an item ID, find its container
        let targetContainerId: string | null = null
        for (const [containerId, itemIds] of Object.entries(newBoard.containers)) {
          if (itemIds.includes(overId)) {
            targetContainerId = containerId
            break
          }
        }

        if (targetContainerId) {
          const targetItems = newBoard.containers[targetContainerId]
          const overIndex = targetItems.findIndex((id) => id === overId)
          if (overIndex >= 0) {
            targetItems.splice(overIndex, 0, activeId)
          } else {
            targetItems.push(activeId)
          }
        }
      }

      return newBoard
    })
  }

  // Get items for each container
  const unassignedItems = board.containers.unassigned.map((id) => board.itemsById[id])
  const excludedItems = board.containers.excluded.map((id) => board.itemsById[id])
  const structureIds = board.structureOrder.filter((id) => board.containers[id])

  // Validation
  const unassignedCount = unassignedItems.length
  const canImport = unassignedCount === 0

  // Handle import
  const handleImport = async () => {
    if (!canImport || importing) return

    const payload: TxnRow[] = []

    // Collect all non-excluded items with their structure IDs
    for (const structureId of board.structureOrder) {
      const itemIds = board.containers[structureId] || []
      for (const itemId of itemIds) {
        const item = board.itemsById[itemId]
        if (item && item.included) {
          payload.push({
            ...item.row,
            structureId,
          })
        }
      }
    }

    // Unprocessed = excluded rows
    const unprocessedRows = excludedItems.map((item) => item.row)

    if (payload.length === 0 && unprocessedRows.length === 0) return

    try {
      setImporting(true)
      await onConfirm(payload, unprocessedRows)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import trades.'
      alert(message)
    } finally {
      setImporting(false)
    }
  }

  // Toolbar actions
  const handleAutoByTime = () => {
    const autoGroupMap = autoGroupByTime(rows, normalizeSecond)
    setBoard((prev) => {
      const newBoard = { ...prev }
      newBoard.containers = {
        unassigned: [],
        excluded: prev.containers.excluded,
      }
      newBoard.structureOrder = []
      newBoard.structureMeta = {}

      const groupMap = new Map<number, string[]>()
      for (const [itemId, groupNum] of Object.entries(autoGroupMap)) {
        if (!groupMap.has(groupNum)) {
          groupMap.set(groupNum, [])
        }
        groupMap.get(groupNum)!.push(itemId)
      }

      let structureNum = 1
      for (const [_, itemIds] of groupMap) {
        const structId = `structure:${structureNum++}`
        newBoard.containers[structId] = itemIds
        newBoard.structureOrder.push(structId)
        newBoard.structureMeta[structId] = {
          type: suggestStructureType(itemIds.map((id) => newBoard.itemsById[id])),
        }
      }

      return newBoard
    })
  }

  const handleAllToUnassigned = () => {
    setBoard((prev) => {
      const newBoard = { ...prev }
      const allItemIds: string[] = []

      for (const containerId of Object.keys(newBoard.containers)) {
        if (containerId !== 'excluded') {
          allItemIds.push(...newBoard.containers[containerId])
        }
      }

      newBoard.containers = {
        unassigned: allItemIds,
        excluded: newBoard.containers.excluded,
      }
      newBoard.structureOrder = []
      newBoard.structureMeta = {}

      return newBoard
    })
  }

  const handleNewStructure = () => {
    setBoard((prev) => {
      const newStructureId = `structure:${Date.now()}`
      const newBoard = { ...prev }
      newBoard.containers[newStructureId] = []
      newBoard.structureOrder.push(newStructureId)
      newBoard.structureMeta[newStructureId] = { type: 'Custom' }
      return newBoard
    })
  }

  const handleRemoveStructure = (structureId: string) => {
    setBoard((prev) => {
      const newBoard = { ...prev }
      const itemIds = newBoard.containers[structureId] || []
      newBoard.containers.unassigned.push(...itemIds)
      delete newBoard.containers[structureId]
      newBoard.structureOrder = newBoard.structureOrder.filter((id) => id !== structureId)
      delete newBoard.structureMeta[structureId]
      return newBoard
    })
  }

  const handleStructureTypeChange = (structureId: string, type: string) => {
    setBoard((prev) => {
      const newBoard = { ...prev }
      if (newBoard.structureMeta[structureId]) {
        newBoard.structureMeta[structureId].type = type
      }
      return newBoard
    })
  }

  // All droppable IDs
  const droppableIds = [
    'unassigned',
    'excluded',
    'create-structure',
    ...board.structureOrder,
  ]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-7xl max-h-[90vh] flex flex-col p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <h3 className="text-lg font-semibold">Review & Assign Structures</h3>
          <div className="ml-auto flex gap-2 text-sm">
            <button
              className={`px-3 py-1 rounded-lg border ${
                activeTab === 'included' ? 'bg-slate-900 text-white' : ''
              }`}
              onClick={() => setActiveTab('included')}
            >
              Included ({rows.length})
            </button>
            <button
              className={`px-3 py-1 rounded-lg border ${
                activeTab === 'excluded' ? 'bg-slate-900 text-white' : ''
              }`}
              onClick={() => setActiveTab('excluded')}
            >
              Excluded ({excludedRows.length})
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {activeTab === 'included' ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="space-y-4">
                {/* Toolbar */}
                <div className="flex gap-2 items-center flex-wrap">
                  <button
                    onClick={handleAutoByTime}
                    className="px-3 py-1 border rounded-lg hover:bg-slate-50"
                    title="Auto-group by timestamp"
                  >
                    Auto by time
                  </button>
                  <button
                    onClick={handleAllToUnassigned}
                    className="px-3 py-1 border rounded-lg hover:bg-slate-50"
                    title="Clear all groupings"
                  >
                    All → Unassigned
                  </button>
                  <button
                    onClick={handleNewStructure}
                    className="px-3 py-1 border rounded-lg hover:bg-slate-50"
                    title="Create empty structure"
                  >
                    + New structure
                  </button>

                  {unassignedCount > 0 && (
                    <div className="ml-auto text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1">
                      Assign or exclude {unassignedCount} leg{unassignedCount !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>

                {/* Board layout: left column + right grid */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                  {/* Left column: Unassigned + Excluded */}
                  <div className="space-y-4">
                    <UnassignedContainer items={unassignedItems} />
                    <ExcludedContainer items={excludedItems} />
                  </div>

                  {/* Right area: Structures + Create zone */}
                  <div className="lg:col-span-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {structureIds.map((structureId) => (
                        <StructureContainer
                          key={structureId}
                          structureId={structureId}
                          items={board.containers[structureId].map((id) => board.itemsById[id])}
                          meta={board.structureMeta[structureId]}
                          onTypeChange={(type) => handleStructureTypeChange(structureId, type)}
                          onRemove={() => handleRemoveStructure(structureId)}
                        />
                      ))}
                      <CreateStructureZone />
                    </div>
                  </div>
                </div>
              </div>

              {/* Drag overlay */}
              <DragOverlay>
                {activeDragId ? (
                  <div className="bg-white border border-blue-500 rounded-lg p-3 shadow-lg opacity-90">
                    <p className="text-sm font-medium text-slate-900">
                      {formatLegLabel(board.itemsById[activeDragId].row, exchange)}
                    </p>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            // Excluded tab
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                These rows were auto-excluded. They cannot be imported but are shown for reference.
              </p>
              <table className="min-w-full text-sm border rounded-lg overflow-hidden">
                <thead className="bg-slate-50">
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

        {/* Footer */}
        <div className="mt-4 flex gap-3 justify-end border-t pt-4">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl border">
            Back
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport || importing}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
