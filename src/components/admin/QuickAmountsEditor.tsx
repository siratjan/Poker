'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setQuickAmounts } from '@/actions/admin';
import { useWritesBlocked } from '@/components/app/ConnectionProvider';
import { OfflineNote } from '@/components/app/OfflineNote';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { formatCents } from '@/lib/money';
import { amountFromInput, amountHint } from '@/lib/session/amountInput';
import { MAX_QUICK_AMOUNTS, MIN_QUICK_AMOUNTS } from '@/lib/validation/admin';

/**
 * The buy-in quick amounts (docs/ARBEITSPAKETE.md WP8, step 2): editable chips
 * plus a preview of the buttons exactly as the buy-in sheet renders them.
 *
 * Amounts are integer cents throughout (CLAUDE.md); the typed euro string is
 * parsed by the same helper the entry sheets use, so „100,50“ behaves in both
 * places alike. Nothing is written until „Speichern“ — the chips are a draft.
 */
export function QuickAmountsEditor({ amountsCents }: { amountsCents: number[] }) {
  const router = useRouter();
  const { showSuccess, showError } = useToast();

  const [amounts, setAmounts] = useState<number[]>(amountsCents);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const offline = useWritesBlocked();

  const sorted = [...amounts].sort((a, b) => a - b);
  const changed = !sameAmounts(sorted, [...amountsCents].sort((a, b) => a - b));

  function addDraft() {
    const cents = amountFromInput(draft, false);
    if (cents === null) {
      setError(amountHint(draft, false) ?? 'Bitte einen gültigen Betrag eingeben.');
      return;
    }
    if (amounts.includes(cents)) {
      setError('Diesen Betrag gibt es schon.');
      return;
    }
    if (amounts.length >= MAX_QUICK_AMOUNTS) {
      setError(`Höchstens ${MAX_QUICK_AMOUNTS} Schnellbeträge.`);
      return;
    }

    setAmounts((current) => [...current, cents].sort((a, b) => a - b));
    setDraft('');
    setError(null);
  }

  function remove(cents: number) {
    if (amounts.length <= MIN_QUICK_AMOUNTS) {
      setError('Mindestens ein Schnellbetrag muss übrig bleiben.');
      return;
    }
    setAmounts((current) => current.filter((value) => value !== cents));
    setError(null);
  }

  async function save() {
    if (offline) return;
    setPending(true);
    setError(null);

    const result = await setQuickAmounts({ cents: sorted });
    setPending(false);

    if (!result.ok) {
      setError(result.error.message);
      showError(result.error.message);
      return;
    }

    setAmounts(result.data.cents);
    showSuccess('Schnellbeträge gespeichert.');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {sorted.map((cents) => (
          <span
            key={cents}
            className="inline-flex items-center gap-1 rounded-full bg-black/5 py-1 pr-1 pl-3 text-sm font-medium dark:bg-white/10"
          >
            {formatCents(cents)}
            <button
              type="button"
              onClick={() => remove(cents)}
              aria-label={`${formatCents(cents)} entfernen`}
              className="flex size-8 items-center justify-center rounded-full text-base leading-none opacity-70 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          addDraft();
        }}
        className="flex items-end gap-2"
      >
        <div className="flex-1">
          <Input
            label="Betrag hinzufügen"
            name="quick-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="z. B. 50"
            value={draft}
            error={error}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={draft.trim() === ''}>
          Hinzufügen
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Vorschau im Buy-in-Fenster</span>
        <div className="grid grid-cols-3 gap-2">
          {sorted.map((cents) => (
            <span
              key={cents}
              aria-hidden="true"
              className="flex min-h-[56px] items-center justify-center rounded-xl border border-black/15 text-base font-semibold tabular-nums dark:border-white/20"
            >
              {formatCents(cents)}
            </span>
          ))}
        </div>
      </div>

      <Button onClick={save} disabled={pending || offline || !changed}>
        {pending ? 'Speichert …' : 'Speichern'}
      </Button>
      <OfflineNote />
    </div>
  );
}

function sameAmounts(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
