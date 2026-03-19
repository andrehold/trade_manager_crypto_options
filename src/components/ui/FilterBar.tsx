import React, { forwardRef } from 'react';

export interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
}

export const FilterBar = forwardRef<HTMLDivElement, FilterBarProps>(
  ({ children, className }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex flex-wrap items-center gap-3 px-6 py-3 ${className ?? ''}`}
      >
        {children}
      </div>
    );
  }
);

FilterBar.displayName = 'FilterBar';
