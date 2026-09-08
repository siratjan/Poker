import type { Database } from '@/lib/database.types';

/** The three roles of SPEC §3. Kept in sync with the `app_role` enum. */
export type Role = Database['public']['Enums']['app_role'];

export const ROLES: readonly Role[] = ['admin', 'editor', 'viewer'] as const;

/** German labels for the UI. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  editor: 'Bearbeiter',
  viewer: 'Betrachter',
};

/** Rank of a role; higher includes everything below. */
const RANK: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** May create players, sessions and entries (SPEC §3: editor and admin). */
export function canEdit(role: Role | null | undefined): boolean {
  return role === 'editor' || role === 'admin';
}

/** May change roles, reopen sessions, close with a discrepancy (SPEC §3). */
export function isAdmin(role: Role | null | undefined): boolean {
  return role === 'admin';
}

/** Generic comparison: does `role` reach at least `minimum`? */
export function hasAtLeast(role: Role | null | undefined, minimum: Role): boolean {
  if (!isRole(role)) return false;
  return RANK[role] >= RANK[minimum];
}

/** German label, with a safe fallback for unknown values. */
export function roleLabel(role: Role | null | undefined): string {
  return isRole(role) ? ROLE_LABELS[role] : 'Unbekannt';
}
