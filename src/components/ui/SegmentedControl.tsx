import React from 'react';

export interface SegmentedControlProps {
  items: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function SegmentedControl({ items, value, onChange, size = 'md', className }: SegmentedControlProps) {
  const heightClass = size === 'sm' ? 'h-7' : 'h-8';

  return (
    <div className={`bg-bg-surface-2 rounded-xl p-1 inline-flex gap-1 ${className ?? ''}`}>
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={[
              `rounded-lg px-3 text-caption font-medium transition-colors duration-[120ms] ${heightClass}`,
              'outline-none focus-visible:shadow-[var(--glow-accent-sm)]',
              isActive
                ? 'bg-bg-surface-4 text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-secondary',
            ].join(' ')}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
