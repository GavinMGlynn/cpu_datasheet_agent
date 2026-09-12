import { describe, expect, it } from 'vitest';

import { RouteError, Router, isHttpMethod, type RouteLookup } from './router.js';

function found<H>(lookup: RouteLookup<H>): Extract<RouteLookup<H>, { kind: 'found' }> {
  if (lookup.kind !== 'found') {
    throw new Error(`expected a match, got ${lookup.kind}`);
  }
  return lookup;
}

function router(): Router<string> {
  return new Router<string>()
    .get('/api/parts', 'list')
    .get('/api/parts/:mpn', 'detail')
    .get('/api/parts/:mpn/parameters/:key', 'parameter')
    .post('/api/parts/:mpn/parameters/:key', 'correct')
    .delete('/api/cache/:namespace/:hash', 'purge')
    .put('/api/golden/:mpn', 'golden')
    .patch('/api/runs/:id', 'amend')
    .get('/assets/*path', 'asset');
}

describe('isHttpMethod', () => {
  it('accepts the methods the server serves and rejects the rest', () => {
    expect(isHttpMethod('GET')).toBe(true);
    expect(isHttpMethod('OPTIONS')).toBe(false);
  });
});

describe('Router.find', () => {
  it('matches a literal route', () => {
    expect(found(router().find('GET', '/api/parts')).handler).toBe('list');
  });

  it('captures parameters and reports the pattern that matched', () => {
    const match = found(router().find('GET', '/api/parts/TPS54331DR/parameters/vinMin'));
    expect(match.handler).toBe('parameter');
    expect(match.params).toStrictEqual({ mpn: 'TPS54331DR', key: 'vinMin' });
    expect(match.pattern).toBe('/api/parts/:mpn/parameters/:key');
  });

  it('decodes percent-encoded segments, so a slash in an MPN survives', () => {
    const match = found(router().find('GET', '/api/parts/LM2596S-3.3%2FNOPB'));
    expect(match.params).toStrictEqual({ mpn: 'LM2596S-3.3/NOPB' });
  });

  it('treats a trailing slash as the same route', () => {
    expect(found(router().find('GET', '/api/parts/')).handler).toBe('list');
  });

  it('captures the remainder of the path in a * segment', () => {
    const match = found(router().find('GET', '/assets/charts/cost.js'));
    expect(match.params).toStrictEqual({ path: 'charts/cost.js' });
  });

  it('matches a * segment that captures nothing', () => {
    expect(found(router().find('GET', '/assets')).params).toStrictEqual({ path: '' });
  });

  it('prefers the route registered first', () => {
    const table = new Router<string>()
      .get('/api/runs/active', 'active')
      .get('/api/runs/:id', 'one');
    expect(found(table.find('GET', '/api/runs/active')).handler).toBe('active');
    expect(found(table.find('GET', '/api/runs/7')).handler).toBe('one');
  });

  it('serves HEAD from a GET route', () => {
    expect(found(router().find('HEAD', '/api/parts')).handler).toBe('list');
  });

  it('prefers an explicit HEAD route over the GET fallback', () => {
    const table = new Router<string>().get('/ping', 'get').add('HEAD', '/ping', 'head');
    expect(found(table.find('HEAD', '/ping')).handler).toBe('head');
  });

  it('reports the methods a path does allow', () => {
    expect(router().find('DELETE', '/api/parts/TPS54331DR/parameters/vinMin')).toStrictEqual({
      kind: 'method_not_allowed',
      allow: ['GET', 'HEAD', 'POST'],
    });
  });

  it('does not offer HEAD where there is no GET', () => {
    expect(router().find('GET', '/api/golden/TPS54331DR')).toStrictEqual({
      kind: 'method_not_allowed',
      allow: ['PUT'],
    });
  });

  it('does not match a path shorter than the pattern', () => {
    expect(router().find('GET', '/api/parts/TPS54331DR/parameters')).toStrictEqual({
      kind: 'not_found',
    });
  });

  it('does not match a path longer than the pattern', () => {
    expect(router().find('GET', '/api/parts/TPS54331DR/offers/extra')).toStrictEqual({
      kind: 'not_found',
    });
  });

  it('does not match a different literal', () => {
    expect(router().find('GET', '/other/parts')).toStrictEqual({ kind: 'not_found' });
  });

  it('rejects a path that is not valid percent-encoding', () => {
    expect(() => router().find('GET', '/api/parts/%ZZ')).toThrow(
      expect.objectContaining({ code: 'WEB_BAD_PATH' }),
    );
  });

  it('rejects invalid encoding in a * segment too', () => {
    expect(() => router().find('GET', '/assets/%E0%A4%A')).toThrow(
      expect.objectContaining({ code: 'WEB_BAD_PATH' }),
    );
  });

  it('rejects invalid encoding compared against a literal', () => {
    expect(() => router().find('GET', '/%ZZ/parts')).toThrow(RouteError);
  });
});

describe('Router.add', () => {
  it('lists every registered pattern in order', () => {
    expect(new Router<string>().get('/a', 'a').post('/b', 'b').patterns()).toStrictEqual([
      'GET /a',
      'POST /b',
    ]);
  });

  it('rejects a pattern that does not start with a slash', () => {
    expect(() => new Router<string>().get('api/parts', 'x')).toThrow(
      expect.objectContaining({ code: 'WEB_ROUTE_PATTERN' }),
    );
  });

  it('rejects a repeated parameter name', () => {
    expect(() => new Router<string>().get('/a/:id/b/:id', 'x')).toThrow(/repeats the parameter/u);
  });

  it('rejects a * segment that is not last', () => {
    expect(() => new Router<string>().get('/assets/*path/x', 'x')).toThrow(/must be last/u);
  });

  it('rejects an unnamed parameter', () => {
    expect(() => new Router<string>().get('/a/:', 'x')).toThrow(/unnamed parameter/u);
  });

  it('rejects an unnamed * segment', () => {
    expect(() => new Router<string>().get('/a/*', 'x')).toThrow(/unnamed parameter/u);
  });
});
