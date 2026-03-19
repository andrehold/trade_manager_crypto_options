import React from 'react';

export interface KbdProps {
  children: string;
  className?: string;
}

export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd className={`inline-flex items-center bg-bg-surface-3 border border-border-default rounded-md px-1.5 py-0.5 text-[11px] leading-[14px] text-text-tertiary font-mono ${className ?? ''}`}>
      {children}
    </kbd>
  );
}
