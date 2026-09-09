import { z } from 'zod';
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
      at: z.string().min(1).max(64),
      id: z.number().int().nonnegative(),
    })
    .nullish()
    .transform((value) => value ?? null),
});

export type AuditPageInput = z.input<typeof auditPageSchema>;
