/**
 * Turning live Digi-Key responses into committed test fixtures.
 *
 * Responses carry account-scoped fields that identify the caller. They are
 * removed here rather than at the call site, so a recorder cannot forget.
 */

/** Keys whose values identify the account or the caller, at any depth. */
const SENSITIVE_KEY = /account|customer|token|secret|client[-_]?id|apikey|api[-_]key/i;

/**
 * Returns a copy with account-identifying fields removed.
 *
 * A matching key is dropped entirely rather than blanked, because a blank
 * field would still assert the shape of something the fixture should not
 * describe. Everything else passes through unchanged so the fixture stays a
 * faithful record of the API.
 */
export function sanitiseFixture(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitiseFixture(item));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      continue;
    }
    out[key] = sanitiseFixture(child);
  }
  return out;
}

/** Filesystem-safe name for a fixture, since part numbers contain `/` and `#`. */
export function fixtureName(mpn: string, operation: string): string {
  const slug = mpn
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug}.${operation}.json`;
}
