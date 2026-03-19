import React from 'react';
import { Surface } from './Surface';

export interface CardProps {
  variant?: 'default' | 'interactive' | 'metric' | 'panel' | 'kanban' | 'sheetSection';
  className?: string;
  children?: React.ReactNode;
}

const config: Record<NonNullable<CardProps['variant']>, { surface: 'base' | 'raised' | 'interactive'; padding: string }> = {
  default: { surface: 'base', padding: 'p-5' },
  interactive: { surface: 'interactive', padding: 'p-5' },
  metric: { surface: 'base', padding: 'p-4' },
  panel: { surface: 'raised', padding: 'p-6' },
  kanban: { surface: 'base', padding: 'p-4' },
  sheetSection: { surface: 'base', padding: 'p-0' },
};

export function Card({ variant = 'default', className, children }: CardProps) {
  const { surface, padding } = config[variant];

  if (variant === 'sheetSection') {
    return <div className={`bg-transparent ${className ?? ''}`}>{children}</div>;
  }

  const roundedOverride = variant === 'kanban' ? 'rounded-xl' : '';

  return (
    <Surface variant={surface} className={`${padding} ${roundedOverride} ${className ?? ''}`}>
      {children}
    </Surface>
  );
}
