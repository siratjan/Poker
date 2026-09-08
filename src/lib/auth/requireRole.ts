import { AppError } from '@/lib/actions/result';
import { getCurrentUser, type CurrentUser } from './getCurrentUser';
import { canEdit, isAdmin } from './roles';

/**
 * Role guards for server actions.
 *
 * These are politeness, not the security boundary: authorisation is enforced by
 * RLS and database triggers (CLAUDE.md). Checking here first only turns a raw
 * `42501` from Postgres into a sentence a person can read.
 */

export const NOT_LOGGED_IN = 'Du bist nicht angemeldet. Bitte melde dich neu an.';
export const FORBIDDEN_EDITOR =
  'Dafür brauchst du mindestens die Rolle „Bearbeiter“. Ein Admin kann sie dir geben.';
export const FORBIDDEN_ADMIN = 'Das darf nur ein Admin.';

/** The logged-in user, or `AppError('UNAUTHENTICATED')`. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user === null) {
    throw new AppError('UNAUTHENTICATED', NOT_LOGGED_IN);
  }
  return user;
}

/** Editor or admin, or `AppError('FORBIDDEN')`. */
export async function requireEditor(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canEdit(user.role)) {
    throw new AppError('FORBIDDEN', FORBIDDEN_EDITOR);
  }
  return user;
}

/** Admin, or `AppError('FORBIDDEN')`. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isAdmin(user.role)) {
    throw new AppError('FORBIDDEN', FORBIDDEN_ADMIN);
  }
  return user;
}
