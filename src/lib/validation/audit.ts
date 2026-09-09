import { z } from 'zod';
import { isAuditCursorTimestamp } from '@/lib/audit/cursor';
import { AUDITED_TABLES } from '@/lib/audit/describe';

/**
 * Validation for `loadAuditPage` (src/actions/audit.ts). The browser only ever
 * sends back a cursor it received from the server plus the current filters;
 * both are checked again here, because a server action is a public endpoint.
 */

const uuidOrNull = z.uuid({ message: 'Ungültiger Filter.' }).nullish().transform((v) => v ?? null);

export const auditPageSchema = z.object({
  filters: z
    .object({
      sessionId: uuidOrNull,
      userId: uuidOrNull,
      tableName: z
        .string()
        .refine((value) => AUDITED_TABLES.includes(value), { message: 'Unbekannte Tabelle.' })
        .nullish()
        .transform((value) => value ?? null),
    })
    .default({ sessionId: null, userId: null, tableName: null }),
  cursor: z
    .object({
      // `at` is put verbatim into the PostgREST `or(…)` expression of
      // `auditCursorFilter`, so it has to be a real ISO timestamp — a value
      // like `2026-01-01,id.gte.0` would otherwise add its own condition
      // there (Gaby WP8-F2). `id` stays a number: `audit_log.id` is a bigint.
      at: z
        .string()
        .max(64)
        .refine(isAuditCursorTimestamp, { message: 'Ungültiger Cursor.' }),
      id: z.number().int().nonnegative(),
    })
    .nullish()
    .transform((value) => value ?? null),
});

export type AuditPageInput = z.input<typeof auditPageSchema>;
