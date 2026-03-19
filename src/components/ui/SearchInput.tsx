import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from './Input';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  size?: 'default' | 'compact';
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', size = 'default', className }: SearchInputProps) {
  return (
    <Input
      size={size}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      leftIcon={<Search className="h-4 w-4" />}
      rightIcon={
        value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="flex items-center justify-center text-text-tertiary hover:text-text-primary outline-none focus-visible:shadow-[var(--glow-accent-sm)] rounded"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : undefined
      }
      className={className}
    />
  );
}
