import type { ReactNode } from 'react';

/**
 * Empty state (docs/ARBEITSPAKETE.md WP4, step 7). Title, description and an
 * optional action (e.g. a „Neue Session“ button).
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-black/15 px-6 py-12 text-center dark:border-white/15">
      <p className="text-base font-medium">{title}</p>
      {description ? <p className="max-w-xs text-sm opacity-70">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
