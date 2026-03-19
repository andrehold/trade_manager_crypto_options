import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: 'right' | 'left';
  width?: number;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  side = 'right',
  width = 360,
  title,
  children,
  className,
}: SheetProps) {
  // Track mounted state to allow exit animation before unmounting
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Trigger enter animation on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      // Wait for exit animation before unmounting
      const timer = setTimeout(() => setMounted(false), 180);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (mounted) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [mounted, handleKeyDown]);

  if (!mounted) return null;

  const isRight = side === 'right';
  const translateFrom = isRight ? 'translate-x-full' : '-translate-x-full';
  const translateTo = 'translate-x-0';
  const borderClass = isRight ? 'border-l border-border-default' : 'border-r border-border-default';
  const positionClass = isRight ? 'right-0' : 'left-0';

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-modal">
      {/* Overlay */}
      <div
        className={`absolute inset-0 bg-bg-overlay transition-opacity ${visible ? 'opacity-100' : 'opacity-0'}`}
        style={{ transitionDuration: 'var(--duration-normal)', transitionTimingFunction: 'var(--easing-standard)' }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={[
          `absolute top-0 ${positionClass} h-full bg-bg-surface-1 ${borderClass}`,
          'flex flex-col',
          'transition-transform',
          visible ? translateTo : translateFrom,
          className ?? '',
        ].join(' ')}
        style={{
          width,
          transitionDuration: 'var(--duration-normal)',
          transitionTimingFunction: 'var(--easing-standard)',
        }}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
            <h2 className="type-title-m text-text-primary">{title}</h2>
            <IconButton
              variant="ghost"
              size={32}
              icon={<X size={18} />}
              aria-label="Close"
              onClick={onClose}
            />
          </div>
        )}
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}
