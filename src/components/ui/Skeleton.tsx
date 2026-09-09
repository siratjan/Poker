import { clsx } from 'clsx';

/**
 * Loading placeholders (docs/ARBEITSPAKETE.md WP9, step 3).
 *
 * Every `loading.tsx` builds its skeleton from these, in the shape of the
 * screen that follows, so the layout does not jump when the data arrives. They
 * are `aria-hidden`: the region around them carries one
 * `aria-busy` / „Lädt …“ label, which is what a screen reader should hear
 * instead of a dozen empty boxes.
 *
 * Presentational only — no hooks — so a server-rendered `loading.tsx` can use
 * them directly.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx('animate-pulse rounded-lg bg-black/8 dark:bg-white/10', className)}
    />
  );
}

/**
 * Wraps a whole loading screen: announces „Lädt …“ once and hides the boxes
 * from assistive technology.
 */
export function SkeletonScreen({
  label = 'Inhalte werden geladen …',
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A card-shaped placeholder, the building block of the list screens. */
export function SkeletonCard({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'flex flex-col gap-2 rounded-2xl border border-black/10 px-4 py-3.5 dark:border-white/10',
        className,
      )}
    >
      <Skeleton className="h-4 w-2/5" />
      {Array.from({ length: Math.max(0, lines - 1) }, (_, index) => (
        <Skeleton key={index} className={index % 2 === 0 ? 'h-3 w-3/5' : 'h-3 w-1/2'} />
      ))}
    </div>
  );
}

/** `count` card placeholders in the same vertical rhythm as a real list. */
export function SkeletonList({ count = 4, lines = 2 }: { count?: number; lines?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} lines={lines} />
      ))}
    </div>
  );
}
