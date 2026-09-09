import type { z } from 'zod';
import { AppError } from '@/lib/actions/result';

/**
 * Validates `input` against `schema` and returns the parsed value, or throws
 * `AppError('VALIDATION', <first German message>)`. `actionResult()` turns that
 * into `{ ok: false, error: { code: 'VALIDATION', message } }`, so a bad form
 * value reaches the user as one readable sentence instead of a thrown ZodError.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'Die Eingabe ist ungültig.';
    throw new AppError('VALIDATION', message);
  }
  return result.data;
}
