/**
 * Every API route declares one of these permissions. A role is a named set of
 * permissions; release 1 seeds only the Owner role, which has all of them.
 * Adding a permission here automatically grants it to Owner on next start.
 */
export const PERMISSIONS = [
  'accounts:read',
  'accounts:write',
  'categories:read',
  'categories:write',
  'recipients:read',
  'recipients:write',
  'tags:read',
  'tags:write',
  'transactions:read',
  'transactions:write',
  'reports:read',
  'users:admin',
  'settings:admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const OWNER_ROLE = 'Owner';

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
