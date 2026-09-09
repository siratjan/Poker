'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createSession } from '@/actions/sessions';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

/**
 * „Neue Session“ form (docs/ARBEITSPAKETE.md WP4, step 5). Date defaults to
 * today (Berlin, passed in from the server), name optional. On success it
 * redirects to the new session's detail page.
 */
export function NewSessionForm({ today, maxDate }: { today: string; maxDate: string }) {
  const router = useRouter();
  const { showError } = useToast();
  const [playedOn, setPlayedOn] = useState(today);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await createSession({ playedOn, name });

    if (result.ok) {
      // Detail page (WP5) takes over; keep pending true through the navigation.
      router.push(`/sessions/${result.data.id}`);
      return;
    }

    setPending(false);
    if (result.error.code === 'VALIDATION') {
      setError(result.error.message);
    } else {
      showError(result.error.message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Input
        label="Datum"
        name="playedOn"
        type="date"
        value={playedOn}
        max={maxDate}
        required
        onChange={(event) => setPlayedOn(event.target.value)}
        error={error}
      />
      <Input
        label="Name (optional)"
        name="name"
        type="text"
        value={name}
        maxLength={60}
        placeholder="z. B. Freitagsrunde"
        hint="Höchstens 60 Zeichen."
        onChange={(event) => setName(event.target.value)}
      />
      <div className="flex gap-3 pt-1">
        <Button type="submit" size="lg" disabled={pending} className="flex-1">
          {pending ? 'Wird angelegt …' : 'Session anlegen'}
        </Button>
      </div>
    </form>
  );
}
