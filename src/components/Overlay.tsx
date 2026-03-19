import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode; // not used now, but handy later
};

/* Inline styles kept only for values that have no utility class equivalent */
const panelStyle: React.CSSProperties = {
  minWidth: 520,
  minHeight: 280,
};

export default function Overlay({ open, onClose, title = 'empty overlay', children }: OverlayProps) {
  // Close on ESC + lock body scroll
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-toast flex items-center justify-center bg-bg-overlay"
      onMouseDown={onClose} // click backdrop to close
    >
      <div
        className="bg-transparent text-inherit outline-none border-none"
        style={panelStyle}
        onMouseDown={(e) => e.stopPropagation()} // prevent backdrop close when clicking inside
        tabIndex={-1}
      >
        {/* intentionally empty content area */}
        {children}
      </div>
    </div>,
    document.body
  );
}
