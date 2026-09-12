import type { Migration } from '../../db/migrate.js';

/**
 * The single sign-on handshake, while it is in flight (20E.3).
 *
 * A row per redirect to the identity provider, holding the PKCE verifier,
 * the nonce and where the browser was going. It lives in the database rather
 * than in a signed cookie: this installation already has a place for
 * short-lived server-side state, and a row can be deleted the moment it is
 * used, which a cookie cannot.
 */
export const migration: Migration = {
  id: 2,
  name: 'oidc-flows',
  up: `
CREATE TABLE oidc_flows (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  redirect_to TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX oidc_flows_expires ON oidc_flows (expires_at);
`,
};
