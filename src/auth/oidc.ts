/**
 * Single sign-on against any OpenID Connect issuer (20E).
 *
 * Written to the specification rather than to one provider: discovery says
 * where the endpoints are, the authorization code is exchanged from the
 * server with PKCE, and the ID token is verified against the issuer's own
 * keys. Nothing here is specific to Google, Entra, Keycloak or Auth0, and
 * none of it runs when no issuer is configured — this project has to work
 * with no network at all.
 */

export interface OidcIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly name?: string;
}

export interface Oidc {
  /** Whether an issuer is configured at all. */
  configured(): boolean;
  /** What the button says, which is the issuer's host unless told otherwise. */
  label(): string;
}
