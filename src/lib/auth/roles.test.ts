import { describe, expect, it } from 'vitest';
import {
  ROLES,
  ROLE_LABELS,
  canEdit,
  hasAtLeast,
  isAdmin,
  isRole,
  roleLabel,
  type Role,
} from './roles';

describe('roles', () => {
  it('knows exactly the three roles of SPEC §3', () => {
    expect([...ROLES]).toEqual(['admin', 'editor', 'viewer']);
    expect(Object.keys(ROLE_LABELS).sort()).toEqual(['admin', 'editor', 'viewer']);
  });

  it('labels the roles in German', () => {
    expect(ROLE_LABELS.admin).toBe('Admin');
    expect(ROLE_LABELS.editor).toBe('Bearbeiter');
    expect(ROLE_LABELS.viewer).toBe('Betrachter');
  });

  it.each<[Role, boolean]>([
    ['admin', true],
    ['editor', true],
    ['viewer', false],
  ])('canEdit(%s) is %s', (role, expected) => {
    expect(canEdit(role)).toBe(expected);
  });

  it.each<[Role, boolean]>([
    ['admin', true],
    ['editor', false],
    ['viewer', false],
  ])('isAdmin(%s) is %s', (role, expected) => {
    expect(isAdmin(role)).toBe(expected);
  });

  it('treats null and undefined as no rights at all', () => {
    expect(canEdit(null)).toBe(false);
    expect(canEdit(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(hasAtLeast(null, 'viewer')).toBe(false);
  });

  it('orders the roles viewer < editor < admin', () => {
    expect(hasAtLeast('admin', 'viewer')).toBe(true);
    expect(hasAtLeast('admin', 'editor')).toBe(true);
    expect(hasAtLeast('admin', 'admin')).toBe(true);
    expect(hasAtLeast('editor', 'viewer')).toBe(true);
    expect(hasAtLeast('editor', 'editor')).toBe(true);
    expect(hasAtLeast('editor', 'admin')).toBe(false);
    expect(hasAtLeast('viewer', 'viewer')).toBe(true);
    expect(hasAtLeast('viewer', 'editor')).toBe(false);
    expect(hasAtLeast('viewer', 'admin')).toBe(false);
  });

  it('recognises only the known role strings', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('Admin')).toBe(false);
    expect(isRole('superuser')).toBe(false);
    expect(isRole('')).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(2)).toBe(false);
  });

  it('falls back to a readable label for unknown values', () => {
    expect(roleLabel('editor')).toBe('Bearbeiter');
    expect(roleLabel(null)).toBe('Unbekannt');
  });

  it('keeps canEdit and hasAtLeast in agreement', () => {
    for (const role of ROLES) {
      expect(canEdit(role)).toBe(hasAtLeast(role, 'editor'));
      expect(isAdmin(role)).toBe(hasAtLeast(role, 'admin'));
    }
  });
});
