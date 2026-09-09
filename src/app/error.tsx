'use client';

import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Root error boundary (docs/ARBEITSPAKETE.md WP9, step 3). Catches what the
 * screens outside the app group throw — the login page above all — and
 * everything the app group's own boundary does not.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 items-center px-4 py-10">
      <div className="w-full">
        <ErrorState error={error} reset={reset} />
      </div>
    </main>
  );
}
