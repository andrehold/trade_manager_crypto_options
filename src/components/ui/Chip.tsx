import React from 'react';
import { X } from 'lucide-react';

export interface ChipProps {
  variant?: 'filter' | 'tag' | 'date' | 'removable';
  selected?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function Chip({ variant = 'tag', selected, onRemove, onClick, className, children }: ChipProps) {
  const base = 'inline-flex items-center gap-1 rounded-[999px] px-2.5 py-1 text-caption font-medium transition-colors duration-[120ms]';

  const stateClasses = selected
    ? 'bg-accent-500/15 border border-border-accent text-text-accent'
    : 'bg-bg-surface-3 border border-border-subtle text-text-secondary';

  const interactiveClasses = onClick ? 'cursor-pointer hover:bg-bg-surface-4' : '';

  return (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      className={`${base} ${stateClasses} ${interactiveClasses} ${className ?? ''}`}
    >
      {children}
      {(variant === 'removable' || onRemove) && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          className="flex items-center text-text-tertiary hover:text-text-primary outline-none focus-visible:shadow-[var(--glow-accent-sm)] rounded"
          aria-label="Remove"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
