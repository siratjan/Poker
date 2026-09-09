import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NewSessionForm } from '@/components/sessions/NewSessionForm';
import { buttonClasses } from '@/components/ui/Button';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { loginPathFor } from '@/lib/auth/paths';
import { canEdit } from '@/lib/auth/roles';
import { berlinToday, maxPlayedOn } from '@/lib/time';

/**
 * „Neue Session“ page (docs/ARBEITSPAKETE.md WP4, step 5). Editors only; the
 * server action guards the role again, RLS is the real boundary.
 */
export default async function NewSessionPage() {
  const user = await getCurrentUser();
  if (user === null) redirect(loginPathFor('/sessions/new'));

  if (!canEdit(user.role)) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">Kein Zugriff</h1>
        <p className="text-sm opacity-70">
          Sessions dürfen nur Bearbeiter anlegen. Ein Admin kann dir die Rolle geben.
        </p>
        <Link href="/" className={buttonClasses({ variant: 'secondary' })}>
          Zurück
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Neue Session</h1>
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">
          Abbrechen
        </Link>
      </div>
      <NewSessionForm today={berlinToday()} maxDate={maxPlayedOn()} />
    </section>
  );
}
