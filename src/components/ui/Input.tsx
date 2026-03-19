import React, { forwardRef } from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'default' | 'compact';
  invalid?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'default', invalid, leftIcon, rightIcon, disabled, className, ...props }, ref) => {
    const height = size === 'compact' ? 'h-9' : 'h-11';

    const inputClasses = [
      'w-full bg-bg-surface-2 border rounded-xl outline-none',
      'text-text-primary placeholder:text-text-tertiary',
      'transition-colors duration-[120ms]',
      'focus:border-border-accent focus:shadow-[var(--glow-accent-sm)]',
      invalid ? 'border-status-danger' : 'border-border-default',
      disabled ? 'opacity-45 cursor-not-allowed' : '',
      height,
    ];

    if (leftIcon || rightIcon) {
      return (
        <div className={`relative inline-flex items-center w-full ${className ?? ''}`}>
          {leftIcon && (
            <span className="absolute left-3 flex items-center text-text-tertiary pointer-events-none">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            disabled={disabled}
            className={[...inputClasses, leftIcon ? 'pl-9' : 'px-3', rightIcon ? 'pr-9' : 'px-3'].join(' ')}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3 flex items-center text-text-tertiary">
              {rightIcon}
            </span>
          )}
        </div>
      );
    }

    return (
      <input
        ref={ref}
        disabled={disabled}
        className={[...inputClasses, 'px-3', className ?? ''].join(' ')}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
