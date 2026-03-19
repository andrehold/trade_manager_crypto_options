import React, { forwardRef } from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'neutral' | 'accent' | 'ghost';
  size?: 32 | 36 | 40;
  icon: React.ReactNode;
  'aria-label': string;
}

const variantClasses: Record<NonNullable<IconButtonProps['variant']>, string> = {
  neutral: 'bg-bg-surface-3 border border-border-default text-text-secondary hover:bg-bg-surface-4 hover:text-text-primary',
  accent: 'bg-accent-500 text-text-primary hover:bg-accent-600',
  ghost: 'bg-transparent text-text-tertiary hover:bg-bg-surface-2 hover:text-text-primary',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'neutral', size = 36, icon, disabled, className, ...props }, ref) => {
    const classes = [
      'inline-flex items-center justify-center',
      'rounded-lg transition-colors duration-[120ms]',
      'outline-none focus-visible:shadow-[var(--glow-accent-sm)]',
      variantClasses[variant],
      disabled ? 'opacity-45 cursor-not-allowed pointer-events-none' : '',
      className ?? '',
    ].join(' ');

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={classes}
        style={{ width: size, height: size }}
        {...props}
      >
        {icon}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
