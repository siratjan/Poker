import { clsx } from 'clsx';
import type { InputHTMLAttributes } from 'react';

/**
 * Labelled text input (docs/ARBEITSPAKETE.md WP4, step 7). At least 44 px tall.
 * Presentational, hook-free: the id is derived from `name` (or taken as prop),
 * so it works in both server and client components.
 */

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | null;
};

export function Input({ label, hint, error, id, name, className, ...rest }: InputProps) {
  const inputId = id ?? name ?? label;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(
          'min-h-[44px] w-full rounded-xl border bg-transparent px-3 text-base outline-none transition',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
          error
            ? 'border-red-500/60'
            : 'border-black/15 focus:border-emerald-500 dark:border-white/20',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs opacity-60">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
