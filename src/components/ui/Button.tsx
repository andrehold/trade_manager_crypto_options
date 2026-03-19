import React, { forwardRef } from 'react';
import { Spinner } from '../Spinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'link';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent-500 text-text-primary hover:bg-accent-600 active:bg-accent-700',
  secondary: 'bg-bg-surface-3 border border-border-default text-text-primary hover:bg-bg-surface-4',
  ghost: 'bg-transparent text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary',
  danger: 'bg-status-danger text-white hover:bg-red-600',
  success: 'bg-status-success text-white hover:bg-green-600',
  link: 'bg-transparent text-text-accent hover:underline',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-caption',
  md: 'h-10 px-4 text-subhead',
  lg: 'h-12 px-5 text-subhead',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', disabled, loading, leftIcon, rightIcon, children, className, ...props }, ref) => {
    const isLink = variant === 'link';

    const classes = [
      'inline-flex items-center justify-center gap-2 font-medium',
      'rounded-xl transition-colors duration-[120ms]',
      'outline-none focus-visible:shadow-[var(--glow-accent-sm)]',
      variantClasses[variant],
      isLink ? '' : sizeClasses[size],
      (disabled || loading) ? 'opacity-45 cursor-not-allowed pointer-events-none' : '',
      className ?? '',
    ].join(' ');

    return (
      <button ref={ref} disabled={disabled || loading} className={classes} {...props}>
        {loading ? <Spinner className="h-4 w-4" /> : leftIcon}
        {children}
        {!loading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';
