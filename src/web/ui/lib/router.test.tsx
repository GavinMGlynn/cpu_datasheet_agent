// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../../../../test/ui/render.js';
import { navigate, parseRoute, replace, useNavigate, useRoute, withQuery, href } from './router.js';

describe('parseRoute', () => {
  it('splits a path into decoded segments and a query', () => {
    const route = parseRoute('/parts/LM2596S-3.3%2FNOPB?source=live&quantity=100');
    expect(route.segments).toStrictEqual(['parts', 'LM2596S-3.3/NOPB']);
    expect(route.query.get('quantity')).toBe('100');
    expect(route.path).toBe('/parts/LM2596S-3.3%2FNOPB');
  });

  it('has no segments at the root', () => {
    expect(parseRoute('/').segments).toStrictEqual([]);
  });
});

describe('useRoute', () => {
  it('follows the address bar as it changes', () => {
    globalThis.history.replaceState({}, '', '/parts');
    const { result } = renderHook(() => useRoute());
    expect(result.current.segments).toStrictEqual(['parts']);
    act(() => {
      navigate('/runs?kind=extract');
    });
    expect(result.current.segments).toStrictEqual(['runs']);
    expect(result.current.query.get('kind')).toBe('extract');
  });

  it('follows the back button', () => {
    globalThis.history.replaceState({}, '', '/parts');
    const { result } = renderHook(() => useRoute());
    act(() => {
      navigate('/runs');
    });
    act(() => {
      globalThis.history.replaceState({}, '', '/parts');
      globalThis.dispatchEvent(new Event('popstate'));
    });
    expect(result.current.segments).toStrictEqual(['parts']);
  });

  it('stops listening when the component goes away', () => {
    const { unmount, result } = renderHook(() => useRoute());
    unmount();
    act(() => {
      navigate('/evals');
    });
    expect(result.current.segments).not.toContain('evals');
  });
});

describe('navigation', () => {
  it('replaces the current entry without stacking one up', () => {
    globalThis.history.replaceState({}, '', '/parts');
    const before = globalThis.history.length;
    act(() => {
      replace('/parts?status=verified');
    });
    expect(globalThis.location.search).toBe('?status=verified');
    expect(globalThis.history.length).toBe(before);
  });

  it('hands back a function that navigates', () => {
    const { result } = renderHook(() => useNavigate());
    act(() => {
      result.current('/tools');
    });
    expect(globalThis.location.pathname).toBe('/tools');
  });
});

describe('withQuery', () => {
  const route = parseRoute('/parts?status=verified&sort=mpn');

  it('changes what it is given and keeps the rest', () => {
    expect(withQuery(route, { sort: 'price' })).toBe('/parts?status=verified&sort=price');
  });

  it('drops a parameter set to nothing', () => {
    expect(withQuery(route, { status: undefined, sort: '' })).toBe('/parts');
  });

  it('takes numbers and booleans', () => {
    expect(withQuery(parseRoute('/parts'), { offset: 50, verified: true })).toBe(
      '/parts?offset=50&verified=true',
    );
  });
});

describe('href', () => {
  it('encodes each segment', () => {
    expect(href(['parts', 'LM2596S-3.3/NOPB'])).toBe('/parts/LM2596S-3.3%2FNOPB');
  });

  it('adds a query when there is one', () => {
    expect(href(['runs'], new URLSearchParams({ kind: 'verify' }))).toBe('/runs?kind=verify');
  });
});
