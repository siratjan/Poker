import type { ReactNode } from 'react';
import { hasAtLeast, type Role } from '@/lib/auth/roles';

export type RoleGateProps = {
  /** Role of the current user (from getCurrentUser()). */
  role: Role | null | undefined;
  /** Minimum role needed to see the children. */
  minimum: Role;
  children: ReactNode;
  /** Optional replacement when the role is not sufficient. */
  fallback?: ReactNode;
};

/**
 * Shows its children only for a sufficient role.
 *
 * Comfort only — never a security boundary. Rights are enforced by RLS and
 * database triggers (CLAUDE.md); this just keeps buttons out of sight that
 * would fail anyway.
 */
export function RoleGate({ role, minimum, children, fallback = null }: RoleGateProps) {
  return <>{hasAtLeast(role, minimum) ? children : fallback}</>;
}
