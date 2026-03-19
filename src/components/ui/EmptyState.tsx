import React, { forwardRef } from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex flex-col items-center justify-center py-16 ${className ?? ''}`}
      >
        {icon && (
          <div className="text-text-tertiary mb-4 [&>svg]:w-12 [&>svg]:h-12">{icon}</div>
        )}
        <h3 className="type-headline text-text-primary mb-2">{title}</h3>
        {description && (
          <p className="type-body text-text-secondary mb-6 max-w-sm text-center">
            {description}
          </p>
        )}
        {action && <div>{action}</div>}
      </div>
    );
  }
);

EmptyState.displayName = 'EmptyState';
