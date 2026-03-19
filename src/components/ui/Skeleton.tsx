import React from 'react';

export interface SkeletonProps {
  className?: string;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'pill' | 'round';
}

const roundedClasses: Record<NonNullable<SkeletonProps['rounded']>, string> = {
  sm: 'rounded-[10px]',
  md: 'rounded-[12px]',
  lg: 'rounded-[16px]',
  xl: 'rounded-[20px]',
  pill: 'rounded-[999px]',
  round: 'rounded-full',
};

export function Skeleton({ className, rounded = 'md' }: SkeletonProps) {
  return <div className={`bg-bg-surface-3 animate-pulse ${roundedClasses[rounded]} ${className ?? ''}`} />;
}
