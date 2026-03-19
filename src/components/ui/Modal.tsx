import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

const sizeWidths: Record<NonNullable<ModalProps['size']>, number> = {
  sm: 400,
  md: 520,
  lg: 680,
};

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  children,
  footer,
  className,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
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

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className={`absolute inset-0 bg-bg-overlay transition-opacity ${visible ? 'opacity-100' : 'opacity-0'}`}
        style={{ transitionDuration: 'var(--duration-normal)', transitionTimingFunction: 'var(--easing-standard)' }}
        onClick={onClose}
      />
      {/* Dialog */}
      <div
        className={[
          'relative bg-bg-surface-1 border border-border-default rounded-2xl',
          'flex flex-col',
          'transition-all',
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
          className ?? '',
        ].join(' ')}
        style={{
          width: sizeWidths[size],
          maxWidth: 'calc(100vw - 32px)',
          boxShadow: 'var(--shadow-overlay)',
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
        {/* Body */}
        <div className="p-6 overflow-y-auto" style={{ maxHeight: '70vh' }}>
          {children}
        </div>
        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-4 py-4 border-t border-border-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
