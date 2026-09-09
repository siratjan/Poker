import { clsx } from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

/**
 * Button (docs/ARBEITSPAKETE.md WP4, step 7). Sizes md/lg, variants
 * primary/secondary/danger, every size at least 44 px tall (mobile tap target).
 *
 * Presentational only — no hooks — so it renders in both server and client
 * components. `buttonClasses` is exported so a `<Link>` styled as a button can
 * reuse exactly the same look.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-500',
  secondary:
    'border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-500',
};

const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-[44px] px-4 text-sm',
  lg: 'min-h-[52px] px-5 text-base',
};

export function buttonClasses(options?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}): string {
  return clsx(
    BASE,
    VARIANTS[options?.variant ?? 'primary'],
    SIZES[options?.size ?? 'md'],
    options?.className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...rest} />;
}
