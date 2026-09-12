# auth

Who may use the site, what they may do, and how the browser proves it. Its own
database (`data/auth.sqlite`), its own command line (`bin/chip-auth.ts`), and
no dependency outside `node:crypto`.

## The first account

```
npx tsx bin/chip-auth.ts add gavin --role admin      # prompts for a password
npx tsx bin/chip-auth.ts list
npx tsx bin/chip-auth.ts passwd gavin
npx tsx bin/chip-auth.ts role gavin viewer
npx tsx bin/chip-auth.ts disable gavin               # and `enable`
npx tsx bin/chip-auth.ts sessions gavin              # and `revoke`
```

There is no default account and no default password: the server says how to
make one when none exists, and so does the sign-in page. A password is typed
at a prompt with the echo off, or piped in with `--password-stdin` — never
passed as an argument, where the shell history and `ps` would keep it.

## Passwords

scrypt from `node:crypto` (RFC 7914), N=2¹⁵, r=8, p=1, a 32-byte key and a
16-byte salt per account. Stored as `scrypt$N$r$p$salt$hash`, so the cost
travels with the hash: raising it later does not invalidate what is stored,
and a weaker hash is rewritten the next time that password is typed.

Twelve characters minimum, two hundred maximum, and no composition rules —
those are what produce `Password1!` on a sticky note.

## Sessions

32 random bytes in a cookie. What is stored is the SHA-256 of it, so a copy of
the database cannot be replayed against the site. `chip_session` is HttpOnly
and `SameSite=Strict`; `chip_csrf` carries a second value the page can read and
repeat in `x-chip-token`, which is what makes a cross-site request fail even
with the cookie attached.

Twelve hours idle, seven days absolute, both enforced server-side. The id is
rotated at every sign-in, so a session cannot be fixed in advance, and a
session dies the moment its account is disabled or its password changes.

## Refusing

A sign-in against an account that does not exist still costs a full scrypt
verify, so the timing says nothing about which accounts are real, and the
message is the same either way. Five failures per account or per address close
the door for fifteen minutes; a correct password during the lockout is still
refused, and the count starts again when the lockout runs out.

## Roles

`viewer` reads everything the site shows. `admin` may correct a value, answer
a question, purge the cache, replace a golden file and start a run that spends
money. Checked at the endpoint (`requireWrite`), never only in the browser.

## Single sign-on

Optional, and off unless an issuer is configured:

```
AUTH_OIDC_ISSUER=https://accounts.example.com
AUTH_OIDC_CLIENT_ID=…
AUTH_OIDC_CLIENT_SECRET=…
AUTH_OIDC_REDIRECT_URI=http://127.0.0.1:5174/api/auth/oidc/callback
AUTH_OIDC_LABEL=Sign in with Example        # optional
AUTH_OIDC_SCOPES=openid email profile       # optional
```

Any OpenID Connect issuer: discovery finds the endpoints, the authorization
code is exchanged from the server with PKCE (S256), and the ID token is
verified against the issuer's own keys — signature, issuer, audience, expiry
with a minute of skew, and the nonce. RS256 and ES256; anything else is
refused rather than guessed at. `jwt.ts` does that verification in about a
hundred lines rather than taking a dependency, because this is the one place
where a supply-chain problem would be an authentication bypass.

The handshake in flight — state, PKCE verifier, nonce, where the browser was
going — is a row in `oidc_flows`, deleted the moment it is used, so a `state`
is good exactly once. It expires after five minutes.

An identity is matched to an account by issuer and subject, or bound on first
use to an account whose username is the verified email. There is no
self-registration: an admin makes the account first, or binds it by hand with
`chip-auth bind`.

## Invariants

- A password hash leaves the store through exactly one method, and the sign-in
  path is its only caller.
- Nothing here logs a password, a hash, a session cookie or a token; the
  redactor covers the rest.
- The identity database is never one of the site's readable "sources": it is
  opened once, by the server, and nothing in `src/web/data/` knows it exists.
