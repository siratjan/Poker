'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

/**
 * Body of every `error.tsx` (docs/ARBEITSPAKETE.md WP9, step 3).
 *
 * Next hands an error boundary the thrown error and a `reset()` that re-renders
 * the segment. The user gets one German sentence and „Erneut versuchen“; the
 * actual message is never shown — a Postgres or Supabase error text tells a
 * player nothing and can leak table names. It goes to the console instead,
 * where the planner can read it in the browser dev tools.
 *
 * `error.digest` is the id Next puts into the server log for a server-side
 * error. It is shown in small print so a report („bei mir steht 1a2b3c“) can be
 * matched to a log line.
 */
export function ErrorState({
  error,
  reset,
  title = 'Da ist etwas schiefgelaufen.',
  description = 'Die Seite konnte nicht geladen werden. Versuch es noch einmal.',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}) {
  useEffect(() => {
    console.error('[error-boundary]', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-red-500/40 px-6 py-12 text-center"
    >
      <p className="text-base font-medium">{title}</p>
      <p className="max-w-xs text-sm opacity-80">{description}</p>
      <Button size="lg" onClick={reset}>
        Erneut versuchen
      </Button>
      {error.digest === undefined ? null : (
        <p className="text-xs opacity-60">Fehlerkennung: {error.digest}</p>
      )}
    </div>
  );
}
