import { z } from 'zod';
import { formatCents } from '@/lib/money';
import type { Role } from '@/lib/auth/roles';
import { MAX_AMOUNT_CENTS } from '@/lib/validation/entries';

/**
 * Validation for the admin server actions (src/actions/admin.ts,
 * docs/ARBEITSPAKETE.md WP8, step 1).
 *
 * Quick amounts: 1–6 values, every one a positive integer number of cents,
 * pairwise distinct, stored sorted ascending. The upper bound is the same typo
 * guard as for a buy-in — a quick button that offers 100.000,00 € is a mistake,
 * not a feature.
 *
 * E-mail addresses of the whitelist are lower-cased here, because 0001 checks
 * `email = lower(email)`: a capitalised address would otherwise fail with a
 * check violation instead of a readable sentence.
 */

export const MIN_QUICK_AMOUNTS = 1;
export const MAX_QUICK_AMOUNTS = 6;

/** `satisfies` keeps this list honest if the `app_role` enum ever grows. */
const ROLE_VALUES = ['admin', 'editor', 'viewer'] as const satisfies readonly Role[];

const roleSchema = z.enum(ROLE_VALUES, { message: 'Bitte eine gültige Rolle wählen.' });

const quickAmount = z
  .number({ message: 'Bitte einen gültigen Betrag eingeben.' })
  .int({ message: 'Bitte einen gültigen Betrag eingeben.' })
  .positive({ message: 'Ein Schnellbetrag muss größer als 0 sein.' })
  .max(MAX_AMOUNT_CENTS, {
    message: `Ein Schnellbetrag darf höchstens ${formatCents(MAX_AMOUNT_CENTS)} sein.`,
  });

export const setUserRoleSchema = z.object({
  userId: z.uuid({ message: 'Ungültiger Nutzer.' }),
  role: roleSchema,
});

export const setQuickAmountsSchema = z.object({
  cents: z
    .array(quickAmount)
    .min(MIN_QUICK_AMOUNTS, { message: 'Mindestens ein Schnellbetrag muss übrig bleiben.' })
    .max(MAX_QUICK_AMOUNTS, {
      message: `Höchstens ${MAX_QUICK_AMOUNTS} Schnellbeträge sind möglich.`,
    })
    .refine((values) => new Set(values).size === values.length, {
      message: 'Jeder Schnellbetrag darf nur einmal vorkommen.',
    })
    // Stored sorted, so the buttons always appear in the same order.
    .transform((values) => [...values].sort((a, b) => a - b)),
});

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, { message: 'Bitte eine E-Mail-Adresse eingeben.' })
  .max(200, { message: 'Diese E-Mail-Adresse ist zu lang.' })
  .pipe(z.email({ message: 'Das ist keine gültige E-Mail-Adresse.' }));

export const upsertWhitelistSchema = z.object({
  email: emailSchema,
  role: roleSchema,
});

export const removeWhitelistSchema = z.object({
  email: emailSchema,
});

export type SetUserRoleInput = z.input<typeof setUserRoleSchema>;
export type SetQuickAmountsInput = z.input<typeof setQuickAmountsSchema>;
export type UpsertWhitelistInput = z.input<typeof upsertWhitelistSchema>;
