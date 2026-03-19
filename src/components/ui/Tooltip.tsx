import React, { useState, useRef, useCallback, cloneElement, forwardRef } from 'react';

export interface TooltipProps {
  content: string;
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const positionStyles: Record<
  NonNullable<TooltipProps['side']>,
  { tooltip: string; arrow: string }
> = {
  top: {
    tooltip: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    arrow: 'left-1/2 -translate-x-1/2 top-full border-t-bg-surface-4 border-x-transparent border-b-transparent',
  },
  bottom: {
    tooltip: 'top-full left-1/2 -translate-x-1/2 mt-2',
    arrow: 'left-1/2 -translate-x-1/2 bottom-full border-b-bg-surface-4 border-x-transparent border-t-transparent',
  },
  left: {
    tooltip: 'right-full top-1/2 -translate-y-1/2 mr-2',
    arrow: 'top-1/2 -translate-y-1/2 left-full border-l-bg-surface-4 border-y-transparent border-r-transparent',
  },
  right: {
    tooltip: 'left-full top-1/2 -translate-y-1/2 ml-2',
    arrow: 'top-1/2 -translate-y-1/2 right-full border-r-bg-surface-4 border-y-transparent border-l-transparent',
  },
};

export const Tooltip = forwardRef<HTMLSpanElement, TooltipProps>(
  ({ content, children, side = 'top', className }, ref) => {
    const [show, setShow] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleEnter = useCallback(() => {
      timerRef.current = setTimeout(() => setShow(true), 300);
    }, []);

    const handleLeave = useCallback(() => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShow(false);
    }, []);

    const pos = positionStyles[side];

    return (
      <span
        ref={ref}
        className="relative inline-flex"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
      >
        {cloneElement(children)}
        {show && (
          <span
            role="tooltip"
            className={[
              'absolute z-50 whitespace-nowrap',
              'bg-bg-surface-4 text-text-primary type-micro px-2 py-1 rounded-md',
              'pointer-events-none',
              pos.tooltip,
              className ?? '',
            ].join(' ')}
            style={{ boxShadow: 'var(--shadow-soft)' }}
          >
            {content}
            <span
              className={`absolute border-4 ${pos.arrow}`}
              aria-hidden
            />
          </span>
        )}
      </span>
    );
  }
);

Tooltip.displayName = 'Tooltip';
