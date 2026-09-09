'use client';

import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Error boundary of the session detail (WP9, step 3).
 *
 * Its own boundary because this is the screen people stand at the table with:
 * the message says explicitly that nothing was lost, since a failed render here
 * looks exactly like a lost buy-in. Writes go through server actions and are
 * either committed or rejected with a toast — a render error touches neither.
 */
export default function SessionDetailError({
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
      title="Die Session konnte nicht angezeigt werden."
      description="Es ist nichts verloren gegangen: Alle Einträge stehen in der Datenbank. Versuch es noch einmal."
    />
  );
}
