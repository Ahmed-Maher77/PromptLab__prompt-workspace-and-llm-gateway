/**
 * Default developer identity for single-tenant developer mode.
 * Centralized constant to eliminate data isolation and duplicate email collisions.
 */
export const DEFAULT_DEV_USER = {
  id: 'dev-user-001',
  email: 'developer@promptlab.local',
  displayName: 'Developer',
  role: 'admin',
} as const;

export const DEFAULT_USER_ID = DEFAULT_DEV_USER.id;
