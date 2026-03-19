import React from 'react';

export interface BadgeProps {
  variant?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
  children?: React.ReactNode;
}

const variantClasses: Record<NonNullable<BadgeProps['variant']>, string> = {
  neutral: 'bg-neutral-750/40 text-text-secondary',
  accent: 'bg-accent-500/15 text-accent-400',
  success: 'bg-status-success/15 text-status-success',
  warning: 'bg-status-warning/15 text-status-warning',
  danger: 'bg-status-danger/15 text-status-danger',
  info: 'bg-status-info/15 text-status-info',
};

export function Badge({ variant = 'neutral', className, children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-[999px] px-2 py-0.5 text-caption font-medium ${variantClasses[variant]} ${className ?? ''}`}>
      {children}
    </span>
  );
}
