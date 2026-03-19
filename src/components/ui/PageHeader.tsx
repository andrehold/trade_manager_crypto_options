import React, { forwardRef } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumb?: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

export const PageHeader = forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ title, subtitle, breadcrumb, primaryAction, secondaryAction, className }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex items-center justify-between min-h-16 px-6 py-4 border-b border-border-subtle ${className ?? ''}`}
      >
        <div className="flex flex-col justify-center gap-0.5">
          {breadcrumb && <div className="mb-1">{breadcrumb}</div>}
          <h1 className="type-title-l text-text-primary">{title}</h1>
          {subtitle && (
            <p className="type-body text-text-secondary">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {secondaryAction}
          {primaryAction}
        </div>
      </div>
    );
  }
);

PageHeader.displayName = 'PageHeader';
