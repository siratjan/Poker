'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { removeWhitelist, upsertWhitelist } from '@/actions/admin';
import { useWritesBlocked } from '@/components/app/ConnectionProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { isRole, ROLE_LABELS, ROLES, type Role } from '@/lib/auth/roles';
import type { WhitelistEntry } from '@/lib/queries/admin';

/**
 * The role whitelist (docs/ARBEITSPAKETE.md WP8, step 2): which address gets
 * which role at its *first* login. For an account that has logged in before,
 * `app_users.role` decides (SPEC §3) — the hint below the list says so, because
 * that is the one thing people get wrong here.
 */
export function WhitelistManager({ entries }: { entries: WhitelistEntry[] }) {
  return (
    <div className="flex flex-col gap-3">
      <AddForm />

      {entries.length === 0 ? (
        <p className="text-sm opacity-70">Die Liste ist leer.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.email}>
              <WhitelistRow entry={entry} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs opacity-60">
        Die Liste wirkt nur beim ersten Login. Wer sich schon einmal angemeldet hat, behält die
        Rolle aus der Nutzerliste oben.
      </p>
    </div>
  );
}

function AddForm() {
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const offline = useWritesBlocked();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (offline) return;
    setPending(true);
    setError(null);

    const result = await upsertWhitelist({ email, role });
    setPending(false);

    if (!result.ok) {
      setError(result.error.message);
      if (result.error.code !== 'VALIDATION') showError(result.error.message);
      return;
    }

    setEmail('');
    showSuccess(`${result.data.email} bekommt beim ersten Login ${ROLE_LABELS[result.data.role]}.`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Input
        label="Adresse aufnehmen"
        name="whitelist-email"
        type="email"
        inputMode="email"
        autoComplete="off"
        value={email}
        placeholder="name@gmail.com"
        error={error}
        onChange={(event) => setEmail(event.target.value)}
      />

      <div className="flex gap-2">
        <label className="sr-only" htmlFor="whitelist-role">
          Rolle
        </label>
        <select
          id="whitelist-role"
          value={role}
          onChange={(event) => {
            const value = event.target.value;
            if (isRole(value)) setRole(value);
          }}
          className="min-h-[44px] rounded-xl border border-black/15 bg-transparent px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 dark:border-white/20"
        >
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>

        <Button
          type="submit"
          className="flex-1"
          disabled={pending || offline || email.trim() === ''}
        >
          {pending ? 'Speichert …' : 'Aufnehmen'}
        </Button>
      </div>
    </form>
  );
}

function WhitelistRow({ entry }: { entry: WhitelistEntry }) {
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const [pending, setPending] = useState(false);
  const offline = useWritesBlocked();

  async function onRemove() {
    if (offline) return;
    setPending(true);
    const result = await removeWhitelist({ email: entry.email });
    setPending(false);

    if (!result.ok) {
      showError(result.error.message);
      return;
    }
    showSuccess(`${entry.email} von der Liste genommen.`);
    router.refresh();
  }

  return (
    <Card className="flex items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium">{entry.email}</span>
        <span className="text-xs opacity-60">{ROLE_LABELS[entry.role]}</span>
      </div>
      <Button variant="secondary" onClick={onRemove} disabled={pending || offline}>
        {pending ? 'Entfernt …' : 'Entfernen'}
      </Button>
    </Card>
  );
}
