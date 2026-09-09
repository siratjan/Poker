'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { loadAuditPage } from '@/actions/audit';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AuditCursor } from '@/lib/audit/cursor';
import {
  auditActionLabel,
  auditTableLabel,
  AUDITED_TABLES,
  describeAuditEntry,
  type AuditEntry,
  type AuditNames,
} from '@/lib/audit/describe';
import {
  auditFiltersToQuery,
  hasAuditFilters,
  NO_AUDIT_FILTERS,
  type AuditFilters,
} from '@/lib/audit/filters';
import type { AuditFilterOptions } from '@/lib/queries/auditLog';
import { formatBerlinDateTime } from '@/lib/time';

/**
 * The audit log (docs/ARBEITSPAKETE.md WP8, step 3): newest first, 50 per page,
 * „Mehr laden“ appends the next page, every row expandable to its raw JSON.
 *
 * The first page is rendered on the server; further pages come from the server
 * action `loadAuditPage`, so this component never touches Supabase itself. The
 * filters live in the URL — that makes „Log dieser Session“ a plain link.
 */
export function AuditLogList({
  initialEntries,
  initialNames,
  initialCursor,
  filters,
  options,
}: {
  initialEntries: AuditEntry[];
  initialNames: AuditNames;
  initialCursor: AuditCursor | null;
  filters: AuditFilters;
  options: AuditFilterOptions;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [names, setNames] = useState(initialNames);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyFilters(next: AuditFilters) {
    router.push(`/log${auditFiltersToQuery(next)}`);
  }

  async function loadMore() {
    if (cursor === null || pending) return;
    setPending(true);
    setError(null);

    const result = await loadAuditPage({ filters, cursor });
    setPending(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    setEntries((current) => [...current, ...result.data.entries]);
    setNames((current) => ({
      players: { ...current.players, ...result.data.names.players },
      sessions: { ...current.sessions, ...result.data.names.sessions },
    }));
    setCursor(result.data.nextCursor);
  }

  return (
    <div className="flex flex-col gap-4">
      <Filters filters={filters} options={options} onChange={applyFilters} />

      {entries.length === 0 ? (
        <EmptyState
          title="Keine Einträge."
          description={
            hasAuditFilters(filters)
              ? 'Mit diesen Filtern steht nichts im Log.'
              : 'Sobald jemand etwas erfasst, steht es hier.'
          }
          action={
            hasAuditFilters(filters) ? (
              <Button variant="secondary" onClick={() => applyFilters(NO_AUDIT_FILTERS)}>
                Filter zurücksetzen
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <LogRow entry={entry} names={names} />
            </li>
          ))}
        </ul>
      )}

      {error === null ? null : (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {cursor === null ? null : (
        <Button variant="secondary" onClick={loadMore} disabled={pending}>
          {pending ? 'Lädt …' : 'Mehr laden'}
        </Button>
      )}
    </div>
  );
}

function Filters({
  filters,
  options,
  onChange,
}: {
  filters: AuditFilters;
  options: AuditFilterOptions;
  onChange: (next: AuditFilters) => void;
}) {
  return (
    <Card className="flex flex-col gap-3 px-4 py-3">
      <FilterSelect
        id="log-filter-session"
        label="Session"
        value={filters.sessionId}
        options={options.sessions}
        onChange={(value) => onChange({ ...filters, sessionId: value })}
      />
      <FilterSelect
        id="log-filter-user"
        label="Nutzer"
        value={filters.userId}
        options={options.users}
        onChange={(value) => onChange({ ...filters, userId: value })}
      />
      <FilterSelect
        id="log-filter-table"
        label="Bereich"
        value={filters.tableName}
        options={AUDITED_TABLES.map((table) => ({ value: table, label: auditTableLabel(table) }))}
        onChange={(value) => onChange({ ...filters, tableName: value })}
      />
      {hasAuditFilters(filters) ? (
        <Button variant="secondary" onClick={() => onChange(NO_AUDIT_FILTERS)}>
          Filter zurücksetzen
        </Button>
      ) : null}
    </Card>
  );
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className="min-h-[44px] w-full rounded-xl border border-black/15 bg-transparent px-3 text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 dark:border-white/20"
      >
        <option value="">Alle</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function LogRow({ entry, names }: { entry: AuditEntry; names: AuditNames }) {
  const [open, setOpen] = useState(false);
  const actor = entry.userName ?? entry.userEmail ?? 'System';

  return (
    <Card className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 text-xs opacity-60">
        <span className="tabular-nums">{formatBerlinDateTime(entry.at)}</span>
        <span>
          {auditTableLabel(entry.tableName)} · {auditActionLabel(entry.action)}
        </span>
      </div>
      <p className="text-sm">
        <span className="font-medium">{actor}</span> {describeAuditEntry(entry, names)}
      </p>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mt-1 min-h-[44px] self-start text-left text-xs font-medium text-emerald-700 dark:text-emerald-400"
      >
        {open ? 'Rohdaten ausblenden' : 'Rohdaten anzeigen'}
      </button>

      {open ? (
        <div className="flex flex-col gap-2 text-xs">
          <RawData title="Vorher" data={entry.oldData} />
          <RawData title="Nachher" data={entry.newData} />
        </div>
      ) : null}
    </Card>
  );
}

function RawData({ title, data }: { title: string; data: unknown }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium opacity-70">{title}</span>
      <pre className="max-h-64 overflow-auto rounded-xl bg-black/5 p-2 text-[11px] leading-snug dark:bg-white/10">
        {data === null ? '–' : safeJson(data)}
      </pre>
    </div>
  );
}

/** The log must render even if a payload cannot be stringified (cycles, BigInt). */
function safeJson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2) ?? '–';
  } catch {
    return '–';
  }
}
