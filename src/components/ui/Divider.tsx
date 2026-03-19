import React from 'react';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function Divider({ orientation = 'horizontal', className }: DividerProps) {
  const classes = orientation === 'horizontal'
    ? `h-px w-full bg-border-subtle ${className ?? ''}`
    : `w-px h-full bg-border-subtle ${className ?? ''}`;

  return <div role="separator" className={classes} />;
}
