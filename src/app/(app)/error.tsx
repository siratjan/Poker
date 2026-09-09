'use client';

import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Error boundary of the app group (docs/ARBEITSPAKETE.md WP9, step 3). Catches
 * everything that a page of the group throws while rendering; the shell around
 * it (header, tab bar, connection banner) stays, so the user can simply move on
 * to another tab.
 *
 * Segments with their own `error.tsx` (session detail) take precedence.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      description="Dieser Bereich konnte nicht geladen werden. Versuch es noch einmal — die Daten sind nicht verloren."
    />
  );
}
