'use client';

import { useRouter } from 'next/navigation';
import { useConnection } from '@/components/app/ConnectionProvider';

/**
 * The one connection banner of the app (docs/ARBEITSPAKETE.md WP9, step 2).
 *
 * Sits directly under the header, so it is visible on every screen without
 * pushing the content around when it is absent. `role="status"` with
 * `aria-live="polite"` lets a screen reader announce it without interrupting.
 *
 * The wording and when it appears at all live in `deriveConnection`.
 */
export function ConnectionBanner() {
  const router = useRouter();
  const { banner } = useConnection();

  if (banner === null) return null;

  const offline = banner.tone === 'offline';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${
        offline
          ? 'bg-red-600/12 text-red-800 dark:bg-red-500/15 dark:text-red-200'
          : 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
      }`}
    >
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="font-semibold">{banner.title}</span>
        <span className="opacity-90">{banner.description}</span>
      </span>

      {banner.canReload ? (
        <button
          type="button"
          onClick={() => router.refresh()}
          className="min-h-[44px] shrink-0 rounded-xl border border-current/30 px-3 text-sm font-medium transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current dark:hover:bg-white/10"
        >
          Neu laden
        </button>
      ) : null}
    </div>
  );
}
