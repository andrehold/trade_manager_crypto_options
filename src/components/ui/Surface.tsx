import React from 'react';

export interface SurfaceProps {
  variant?: 'base' | 'raised' | 'elevated' | 'interactive' | 'selected';
  as?: React.ElementType;
  className?: string;
  children?: React.ReactNode;
}

const variantClasses: Record<NonNullable<SurfaceProps['variant']>, string> = {
  base: 'bg-bg-surface-1 border border-border-subtle',
  raised: 'bg-bg-surface-2 border border-border-default',
  elevated: 'bg-bg-surface-3 border border-border-default shadow-[var(--shadow-card)]',
  interactive: 'bg-bg-surface-2 border border-border-default hover:bg-bg-surface-3 hover:border-border-strong cursor-pointer transition-colors',
  selected: 'bg-bg-surface-2 border-border-accent shadow-[var(--glow-accent-sm)]',
};

export function Surface({ variant = 'base', as: Component = 'div', className, children, ...props }: SurfaceProps & Record<string, unknown>) {
  const classes = `rounded-2xl ${variantClasses[variant]} ${className ?? ''}`;
  return <Component className={classes} {...props}>{children}</Component>;
}
