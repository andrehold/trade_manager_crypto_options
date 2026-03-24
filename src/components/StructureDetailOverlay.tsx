import React from 'react'
import { X } from 'lucide-react'
import Overlay from './Overlay'
import { TransactionTable } from './TransactionTable'
import type { Position } from '../utils'

type StructureDetailOverlayProps = {
  open: boolean
  onClose: () => void
  position: Position
}

export function StructureDetailOverlay({ open, onClose, position }: StructureDetailOverlayProps) {
  return (
    <Overlay open={open} onClose={onClose}>
      <div className="bg-surface-card rounded-2xl shadow-xl max-w-5xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <div className="type-subhead text-muted">Structure details</div>
            <div className="type-title-m font-semibold text-strong">
              {position.underlying} · {position.expiryISO}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-muted hover:bg-surface-hover"
            aria-label="Close detail overlay"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 overflow-auto">
          <TransactionTable position={position} />
        </div>
      </div>
    </Overlay>
  )
}
