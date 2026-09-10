import { describe, it } from 'vitest';

import { datasheet } from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import { Datasheet } from './datasheet.js';

describe('Datasheet', () => {
  it('accepts the fixture and an empty MPN list', () => {
    expectAccepts(Datasheet, datasheet());
    expectAccepts(Datasheet, datasheet({ coversMpns: [] }));
  });

  it('rejects duplicate covered MPNs', () => {
    expectRejects(
      Datasheet,
      datasheet({ coversMpns: ['TPS54331D', 'TPS54331DR', 'TPS54331D'] }),
      'coversMpns.2',
    );
  });

  it.each([
    ['a non-normalised MPN', datasheet({ coversMpns: ['tps54331d'] })],
    ['an ftp URL', datasheet({ url: 'ftp://ti.com/x.pdf' })],
    ['a bad digest', datasheet({ sha256: 'xyz' })],
    ['zero pages', datasheet({ pageCount: 0 })],
    ['a fractional page count', datasheet({ pageCount: 2.5 })],
    ['an empty local path', datasheet({ localPath: ' ' })],
    ['an extra key', datasheet({ title: 'TPS54331' })],
  ])('rejects %s', (_label, value) => {
    expectRejects(Datasheet, value);
  });
});
