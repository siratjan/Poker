/**
 * Return contract of every server action (docs/ARBEITSPAKETE.md, project-wide
 * conventions): `{ ok: true, data } | { ok: false, error: { code, message } }`.
 * A server action never throws towards the client, and every message is German.
 */

export type ActionError = {
  code: string;
  /** German, ready to be shown to the user. */
  message: string;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/** An error a server action is allowed to produce, with a code the UI can branch on. */
export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/** Fallback for anything unexpected — never leak a raw exception to the client. */
export const UNEXPECTED_ERROR: ActionError = {
  code: 'UNEXPECTED',
  message: 'Etwas ist schiefgelaufen. Bitte noch einmal versuchen.',
};

/**
 * Runs `fn` and maps its outcome onto {@link ActionResult}.
 *
 * `AppError` (thrown by `requireEditor()` / `requireAdmin()`, for example)
 * becomes a readable `{ ok: false }`; anything else is logged on the server and
 * reported generically, so no Postgres text ever reaches the browser.
 *
 * Next.js control-flow signals (`redirect()`, `notFound()`) must keep bubbling,
 * so they are re-thrown untouched.
 */
export async function actionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;

    if (error instanceof AppError) {
      return fail(error.code, error.message);
    }

    console.error('[action]', error);
    return { ok: false, error: UNEXPECTED_ERROR };
  }
}

/**
 * `redirect()` and `notFound()` work by throwing. Swallowing those would turn a
 * navigation into a silent error, so they are recognised by their digest.
 */
export function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== 'string') return false;
  return digest === 'NEXT_NOT_FOUND' || digest.startsWith('NEXT_REDIRECT');
}
