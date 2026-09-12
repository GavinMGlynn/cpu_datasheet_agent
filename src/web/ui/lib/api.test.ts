// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApi, tokenFromCookies } from './api.js';

/**
 * The client, against a fake fetch. What matters is the address it asks for,
 * the headers it sends, and what it does with a refusal.
 */

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeFetch(answer: unknown = {}, status = 200): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: status < 400,
      status,
      text: () => Promise.resolve(JSON.stringify(answer)),
    } as Response);
  }) as unknown as typeof fetch;
  return { fetch: fetcher, calls };
}

describe('reading', () => {
  it('asks for what it was asked for, with the query it was given', async () => {
    const { fetch, calls } = fakeFetch({ total: 0, items: [] });
    const api = createApi({ fetch });
    await api.parts({ source: 'live', text: 'TPS', limit: 50, offset: 0 });
    expect(calls[0]?.url).toBe('/api/parts?source=live&text=TPS&limit=50&offset=0');
  });

  it('drops empty parameters rather than sending them empty', async () => {
    const { fetch, calls } = fakeFetch();
    await createApi({ fetch }).parts({ source: 'live', text: '' });
    expect(calls[0]?.url).toBe('/api/parts?source=live');
  });

  it('encodes a part number with a slash in it', async () => {
    const { fetch, calls } = fakeFetch();
    await createApi({ fetch }).part('LM2596S-3.3/NOPB', { source: 'live' });
    expect(calls[0]?.url).toBe('/api/parts/LM2596S-3.3%2FNOPB?source=live');
  });

  it('sends the cookie and asks for JSON', async () => {
    const { fetch, calls } = fakeFetch();
    await createApi({ fetch }).sources();
    expect(calls[0]?.init?.credentials).toBe('same-origin');
    expect((calls[0]?.init?.headers as Record<string, string>).accept).toBe('application/json');
  });

  it('reaches every read endpoint it offers', async () => {
    const { fetch, calls } = fakeFetch();
    const api = createApi({ fetch, baseUrl: 'http://server.invalid' });
    await Promise.all([
      api.health('live'),
      api.meta(),
      api.coverage('live'),
      api.datasheets('live'),
      api.verifications('TPS54331DR', 'live'),
      api.distribution('vinMax', 'live', 8),
      api.compare(['a', 'b'], 'live'),
      api.runs({ source: 'live' }),
      api.run('run-1', 'live'),
      api.ledger({ tool: 'read_pages' }),
      api.ledgerCall('call-1'),
      api.overview('live'),
      api.spend('live', 'day'),
      api.spendBy('model', 'live'),
      api.tools(),
      api.errors(),
      api.evals(),
      api.evalReport('one'),
      api.evalParameters('one'),
      api.evalFailures('one'),
      api.evalCompare('one', 'two'),
      api.golden(),
      api.goldenHealth(),
      api.escalations({ source: 'live', resolved: false }),
      api.audit({ source: 'live' }),
      api.cache(),
      api.launches(),
      api.launch('launch-1'),
      api.estimate('extract', 22, 'live'),
    ]);
    expect(calls).toHaveLength(29);
    expect(calls.every((call) => call.url.startsWith('http://server.invalid/api/'))).toBe(true);
  });

  it('builds the address of a rendered page', () => {
    expect(createApi().pageImageUrl('abc', 4, 'live')).toBe(
      '/api/datasheets/abc/pages/4/image?source=live',
    );
  });
});

describe('signing in and out', () => {
  it('asks the server who is signed in before anything else', async () => {
    const { fetch, calls } = fakeFetch({ accounts: 1, oidc: false, signedInAs: null });
    await createApi({ fetch }).authState();
    expect(calls[0]?.url).toBe('/api/auth/state');
    expect(calls[0]?.init?.method).toBeUndefined();
  });

  it('sends the credentials as JSON, and carries no token: there is none yet', async () => {
    const { fetch, calls } = fakeFetch({ account: { username: 'gavin' } });
    await createApi({ fetch, cookies: () => '' }).signIn('gavin', 'correct horse battery staple');
    expect(calls[0]?.url).toBe('/api/auth/login');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ username: 'gavin', password: 'correct horse battery staple' }),
    );
    expect((calls[0]?.init?.headers as Record<string, string>)['x-chip-token']).toBeUndefined();
  });

  it('signs out here, and everywhere, repeating the session token', async () => {
    const { fetch, calls } = fakeFetch({ signedOut: true });
    const api = createApi({ fetch, token: 'the-token' });
    await api.signOut();
    await api.signOutEverywhere();
    expect(calls.map((one) => one.url)).toStrictEqual([
      '/api/auth/logout',
      '/api/auth/logout-everywhere',
    ]);
    expect((calls[0]?.init?.headers as Record<string, string>)['x-chip-token']).toBe('the-token');
  });

  it('changes the password, sending both', async () => {
    const { fetch, calls } = fakeFetch({ changed: true });
    await createApi({ fetch, token: 'the-token' }).changePassword('old one', 'a new passphrase');
    expect(calls[0]?.url).toBe('/api/auth/password');
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ current: 'old one', next: 'a new passphrase' }),
    );
  });
});

describe('writing', () => {
  it('repeats the token in a header, because a cookie alone is refused', async () => {
    const { fetch, calls } = fakeFetch();
    const api = createApi({ fetch, token: 'the-token' });
    await api.correctParameter('TPS54331DR', 'vinMax', { value: 1 });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-chip-token']).toBe('the-token');
    expect(headers['content-type']).toBe('application/json');
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('reads the token from the readable cookie the server set', async () => {
    const { fetch, calls } = fakeFetch();
    const api = createApi({ fetch, cookies: () => 'other=1; chip_csrf=from-the-cookie' });
    await api.setStatus('TPS54331DR', { status: 'needs_human' });
    expect((calls[0]?.init?.headers as Record<string, string>)['x-chip-token']).toBe(
      'from-the-cookie',
    );
  });

  it('sends no token header when there is nothing to send', async () => {
    const { fetch, calls } = fakeFetch();
    const api = createApi({ fetch, cookies: () => '' });
    await api.setStatus('TPS54331DR', { status: 'needs_human' });
    expect((calls[0]?.init?.headers as Record<string, string>)['x-chip-token']).toBeUndefined();
  });

  it('reads the cookie on every write, not once at startup', async () => {
    const { fetch, calls } = fakeFetch();
    let jar = '';
    const api = createApi({ fetch, cookies: () => jar });
    await api.setStatus('TPS54331DR', { status: 'needs_human' });
    jar = 'chip_csrf=arrived-later';
    await api.setStatus('TPS54331DR', { status: 'needs_human' });
    expect((calls[1]?.init?.headers as Record<string, string>)['x-chip-token']).toBe(
      'arrived-later',
    );
  });

  it('reaches every write endpoint it offers', async () => {
    const { fetch, calls } = fakeFetch();
    const api = createApi({ fetch, cookies: () => '' });
    await Promise.all([
      api.alternates({ mpn: 'x' }, 'live'),
      api.resolveEscalation('e-1', {}),
      api.startLaunch({}),
      api.cancelLaunch('launch-1'),
    ]);
    expect(calls.map((call) => call.url)).toStrictEqual([
      '/api/alternates?source=live',
      '/api/escalations/e-1/resolve',
      '/api/launches',
      '/api/launches/launch-1/cancel',
    ]);
  });
});

describe('tokenFromCookies', () => {
  it('finds the readable half of the session pair', () => {
    expect(tokenFromCookies('chip_csrf=abc')).toBe('abc');
    expect(tokenFromCookies('a=1; chip_csrf=abc%2Fdef; b=2')).toBe('abc/def');
  });

  it('finds nothing in a jar that has none', () => {
    expect(tokenFromCookies('')).toBeUndefined();
    expect(tokenFromCookies('a=1; nonsense; =2')).toBeUndefined();
  });
});

describe('failures', () => {
  it('throws the code the server sent', async () => {
    const { fetch } = fakeFetch(
      { error: { code: 'WEB_PART_NOT_FOUND', message: 'no such part', details: { mpn: 'x' } } },
      404,
    );
    await expect(createApi({ fetch }).part('x', {})).rejects.toMatchObject({
      status: 404,
      code: 'WEB_PART_NOT_FOUND',
      message: 'no such part',
      details: { mpn: 'x' },
    });
  });

  it('copes with a refusal that carries no envelope', async () => {
    const { fetch } = fakeFetch({}, 500);
    await expect(createApi({ fetch }).sources()).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'request failed with 500',
    });
  });

  it('copes with an empty body', async () => {
    const fetcher = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
      } as Response)) as unknown as typeof fetch;
    await expect(createApi({ fetch: fetcher }).sources()).resolves.toBeNull();
  });

  it('is an Error, so anything that catches errors catches it', () => {
    const error = new ApiError(404, 'X', 'y');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
  });

  it('reads the cookies of the document when it is given no reader', async () => {
    const { fetch, calls } = fakeFetch();
    globalThis.document = { cookie: 'chip_csrf=from-the-document' } as Document;
    await createApi({ fetch }).setStatus('TPS54331DR', { status: 'needs_human' });
    expect((calls[0]?.init?.headers as Record<string, string>)['x-chip-token']).toBe(
      'from-the-document',
    );
  });

  it('uses the global fetch when it is given none', async () => {
    const spy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') } as Response),
    );
    vi.stubGlobal('fetch', spy);
    await createApi().sources();
    expect(spy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
