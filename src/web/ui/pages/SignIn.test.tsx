// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp, renderAt, stubApi } from '../../../../test/ui/render.js';
import { ApiError } from '../lib/api.js';
import { SignIn } from './SignIn.js';

const signedOut = {
  accounts: 2,
  oidc: false,
  oidcLabel: null,
  signedInAs: null,
};

describe('SignIn', () => {
  it('asks for a username and a password', () => {
    renderAt(<SignIn api={stubApi()} state={signedOut} onSignedIn={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Chip Datasheet Agent' })).toBeVisible();
    expect(screen.getByLabelText('Username')).toBeVisible();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('signs in and says so', async () => {
    const signIn = vi.fn(() =>
      Promise.resolve({
        account: { username: 'gavin', displayName: 'Gavin', role: 'admin' as const },
      }),
    );
    const onSignedIn = vi.fn();
    renderAt(<SignIn api={stubApi({ signIn })} state={signedOut} onSignedIn={onSignedIn} />);
    await userEvent.type(screen.getByLabelText('Username'), 'gavin');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signIn).toHaveBeenCalledWith('gavin', 'correct horse battery staple');
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledTimes(1);
    });
  });

  it('says what is wrong without saying which half', async () => {
    const signIn = vi.fn(() =>
      Promise.reject(new ApiError(401, 'AUTH_REFUSED', 'that username and password do not match')),
    );
    renderAt(<SignIn api={stubApi({ signIn })} state={signedOut} onSignedIn={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Username'), 'gavin');
    await userEvent.type(screen.getByLabelText('Password'), 'not the password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That username and password do not match an account.',
    );
    // And it clears the password rather than leaving it on screen.
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('says to wait when it has been told to stop asking', async () => {
    const signIn = vi.fn(() =>
      Promise.reject(new ApiError(429, 'AUTH_LOCKED_OUT', 'too many failed attempts')),
    );
    renderAt(<SignIn api={stubApi({ signIn })} state={signedOut} onSignedIn={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Username'), 'gavin');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('repeats anything else it is told', async () => {
    const signIn = vi.fn(() => Promise.reject(new Error('the server went away')));
    renderAt(<SignIn api={stubApi({ signIn })} state={signedOut} onSignedIn={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Username'), 'gavin');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the server went away');
  });

  it('says how to make the first account when there are none', () => {
    renderAt(<SignIn api={stubApi()} state={{ ...signedOut, accounts: 0 }} onSignedIn={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('There are no accounts yet.');
    expect(screen.getByText(/chip-auth\.ts add/iu)).toBeVisible();
    expect(screen.getByLabelText('Username')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('offers single sign-on when an issuer is configured', () => {
    renderAt(
      <SignIn
        api={stubApi()}
        state={{ ...signedOut, oidc: true, oidcLabel: 'Sign in with Acme' }}
        onSignedIn={vi.fn()}
      />,
    );
    const link = screen.getByRole('link', { name: 'Sign in with Acme' });
    expect(link).toHaveAttribute('href', '/api/auth/oidc/start');
  });

  it('falls back to plain words on the button when the issuer has no name', () => {
    renderAt(<SignIn api={stubApi()} state={{ ...signedOut, oidc: true }} onSignedIn={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Single sign-on' })).toBeVisible();
  });
});

describe('the shell when nobody is signed in', () => {
  it('shows the sign-in page instead of the application', async () => {
    renderApp('/parts', {
      authState: () => Promise.resolve(signedOut),
    });
    expect(await screen.findByLabelText('Username')).toBeVisible();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('shows the application once the sign-in goes through', async () => {
    let account: { username: string; displayName: string; role: 'admin' } | null = null;
    renderApp('/parts', {
      authState: () => Promise.resolve({ ...signedOut, signedInAs: account }),
      signIn: () => {
        account = { username: 'gavin', displayName: 'Gavin', role: 'admin' };
        return Promise.resolve({ account });
      },
      sources: () => Promise.resolve({ sources: [] }),
      meta: () =>
        Promise.resolve({
          parameterKeys: [],
          classificationAxes: [],
          partStatuses: [],
          prompts: [],
          model: 'claude-opus-5',
          version: '1.0.0-test',
        }),
      parts: () => Promise.resolve({ source: 'live', total: 0, offset: 0, limit: 50, items: [] }),
    });
    await userEvent.type(await screen.findByLabelText('Username'), 'gavin');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Catalogue' })).toBeVisible();
    expect(screen.getByText('Gavin')).toBeVisible();
  });

  it('says so when the server will not even say whether anyone is signed in', async () => {
    renderApp('/', { authState: () => Promise.reject(new Error('the server went away')) });
    expect(await screen.findByRole('alert')).toHaveTextContent('the server went away');
  });

  it('signs out, and shows the way back in', async () => {
    let account: { username: string; displayName: string; role: 'admin' } | null = {
      username: 'gavin',
      displayName: 'Gavin',
      role: 'admin',
    };
    renderApp('/', {
      authState: () => Promise.resolve({ ...signedOut, signedInAs: account }),
      signOut: () => {
        account = null;
        return Promise.resolve({ signedOut: true });
      },
      sources: () => Promise.resolve({ sources: [] }),
      meta: () =>
        Promise.resolve({
          parameterKeys: [],
          classificationAxes: [],
          partStatuses: [],
          prompts: [],
          model: 'claude-opus-5',
          version: '1.0.0-test',
        }),
      overview: () => Promise.reject(new Error('not what this test is about')),
      spend: () => Promise.reject(new Error('not what this test is about')),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Username')).toBeVisible();
  });
});
