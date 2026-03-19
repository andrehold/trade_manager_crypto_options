import React from 'react';
import { Badge } from './Badge';
import type { BadgeProps } from './Badge';

export interface StatusBadgeProps {
  status: 'waiting' | 'approved' | 'active' | 'cancelled' | 'completed' | 'occupied' | 'available';
  className?: string;
}

const statusConfig: Record<StatusBadgeProps['status'], { variant: NonNullable<BadgeProps['variant']>; label: string; dotColor: string }> = {
  waiting: { variant: 'accent', label: 'Waiting', dotColor: 'bg-accent-500' },
  approved: { variant: 'warning', label: 'Approved', dotColor: 'bg-status-warning' },
  active: { variant: 'success', label: 'Active', dotColor: 'bg-status-success' },
  cancelled: { variant: 'danger', label: 'Cancelled', dotColor: 'bg-status-danger' },
  completed: { variant: 'neutral', label: 'Completed', dotColor: 'bg-neutral-500' },
  occupied: { variant: 'neutral', label: 'Occupied', dotColor: 'bg-neutral-500' },
  available: { variant: 'success', label: 'Available', dotColor: 'bg-status-success' },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { variant, label, dotColor } = statusConfig[status];

  return (
    <Badge variant={variant} className={className}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${dotColor}`} />
      {label}
    </Badge>
  );
}
