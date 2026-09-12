import { z } from 'zod';

import { Iso8601 } from '../core/primitives.js';

/**
 * Who may use the site, and what they may do with it.
 *
 * Two roles, because the site has a button that spends real money at a
 * distributor and another that rewrites the golden set (D76). Reading the
 * data and changing it are different permissions, and a front end that hides
 * a button is a courtesy rather than a control — every one of these is
 * checked at the endpoint.
 */
export const ROLES = ['viewer', 'admin'] as const;
export const Role = z.enum(ROLES);
export type Role = z.output<typeof Role>;

/** What each role may do, stated once so the server and the page agree. */
export function mayWrite(role: Role): boolean {
  return role === 'admin';
}

/**
 * A username is folded to lower case and compared that way: `Gavin` and
 * `gavin` are one account, because two accounts a person cannot tell apart
 * are an accident waiting to be audited.
 */
export const Username = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._@+-]*$/iu, {
    error: 'a username is letters, digits, and . _ @ + -',
  })
  .transform((value) => value.toLowerCase());

export const Account = z.strictObject({
  id: z.uuid(),
  username: Username,
  /** What the site calls them. Defaults to the username when nobody said. */
  displayName: z.string().trim().min(1).max(120),
  role: Role,
  /** Present when this account can sign in with a password. */
  hasPassword: z.boolean(),
  /** The issuer and subject this account signs in with, once bound (20E.5). */
  issuer: z.string().trim().min(1).max(400).optional(),
  subject: z.string().trim().min(1).max(400).optional(),
  createdAt: Iso8601,
  updatedAt: Iso8601,
  /** Set when the account may no longer sign in. Nothing is ever deleted. */
  disabledAt: Iso8601.optional(),
});
export type Account = z.output<typeof Account>;

/** An account as the site shows it: no hash, no identifiers of any kind. */
export interface PublicAccount {
  readonly username: string;
  readonly displayName: string;
  readonly role: Role;
}

export function publicAccount(account: Account): PublicAccount {
  return {
    username: account.username,
    displayName: account.displayName,
    role: account.role,
  };
}
