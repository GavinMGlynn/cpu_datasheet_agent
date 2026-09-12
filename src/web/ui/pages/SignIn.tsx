import type { ReactNode } from 'react';
import { useState } from 'react';

import type { Api, AuthState } from '../lib/api.js';
import { ApiError } from '../lib/api.js';
import { errorMessage } from '../lib/format.js';

/**
 * The way in.
 *
 * A username and a password, against an account in this installation's own
 * identity store (D75). There is no token in an address any more, and no
 * default account: when nobody has made one yet, this page says so and says
 * what to type, because the alternative is a person guessing at a password
 * that was never set.
 */

export interface SignInProps {
  readonly api: Api;
  readonly state: AuthState;
  /** Called once the server has accepted, so the shell can load itself. */
  readonly onSignedIn: () => void;
}

export function SignIn(props: SignInProps): ReactNode {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const noAccounts = props.state.accounts === 0;

  const submit = (): void => {
    setBusy(true);
    setFailure(undefined);
    props.api
      .signIn(username, password)
      .then(() => {
        props.onSignedIn();
      })
      .catch((error: unknown) => {
        setFailure(
          error instanceof ApiError && error.code === 'AUTH_LOCKED_OUT'
            ? 'Too many attempts. Wait a few minutes and try again.'
            : error instanceof ApiError && error.code === 'AUTH_REFUSED'
              ? 'That username and password do not match an account.'
              : errorMessage(error),
        );
      })
      .finally(() => {
        setBusy(false);
        setPassword('');
      });
  };

  return (
    <main className="signed-out">
      <div className="panel">
        <h1>Chip Datasheet Agent</h1>
        <p className="caption">Sign in to read the catalogue and what the agent has done.</p>

        {noAccounts ? (
          <div className="failed" role="alert" style={{ marginTop: 14 }}>
            <strong>There are no accounts yet.</strong>{' '}
            <span>
              Make one in the terminal that started the site:{' '}
              <code>npx tsx bin/chip-auth.ts add &lt;name&gt; --role admin</code>
            </span>
          </div>
        ) : null}

        <form
          className="stack"
          style={{ gap: 12, marginTop: 16 }}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              autoComplete="username"
              autoFocus
              disabled={noAccounts}
              onChange={(event) => {
                setUsername(event.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              disabled={noAccounts}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </div>
          {failure === undefined ? null : (
            <p className="danger" role="alert">
              {failure}
            </p>
          )}
          <div className="row">
            <button
              type="submit"
              className="action"
              disabled={busy || noAccounts || username.trim() === '' || password === ''}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {props.state.oidc ? (
              <a className="secondary button" href="/api/auth/oidc/start">
                {props.state.oidcLabel ?? 'Single sign-on'}
              </a>
            ) : null}
          </div>
        </form>
      </div>
    </main>
  );
}
