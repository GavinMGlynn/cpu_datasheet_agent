import { describe, expect, it, vi } from 'vitest';

import {
  buckParameters,
  humanProvenance,
  param,
  part,
  q,
  type Loose,
} from '../../test/helpers/core-fixtures.js';
import { Part } from '../core/part.js';
import { parseOrThrow } from '../core/validation-error.js';
import {
  DEFAULT_MAX_PAGE_IMAGE_BYTES,
  DEFAULT_PAGE_IMAGE_DPI,
  citedPages,
  collectPageImages,
  type PageRenderer,
} from './page-images.js';

function build(overrides: Loose = {}): Part {
  return parseOrThrow(Part, part(overrides), 'Part');
}

function renderer(
  bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]),
): PageRenderer & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    renderPage: (_ref, page) => {
      calls.push(page);
      return Promise.resolve({ bytes });
    },
  };
}

describe('citedPages', () => {
  it('lists each distinct cited page once, in order', () => {
    const pages = citedPages(build());

    expect(pages).toEqual([...pages].sort((a, b) => a - b));
    expect(new Set(pages).size).toBe(pages.length);
    expect(pages).toContain(4);
  });

  it('is empty when nothing cites a datasheet', () => {
    const humanSourced: Loose = {};
    for (const [key, value] of Object.entries(buckParameters())) {
      humanSourced[key] = { ...(value as Loose), provenance: humanProvenance() };
    }
    const { datasheet: _datasheet, ...rest } = part({ parameters: humanSourced });

    expect(citedPages(parseOrThrow(Part, rest, 'Part'))).toEqual([]);
  });
});

describe('collectPageImages', () => {
  it('renders each cited page once, as a data URI', async () => {
    const fake = renderer();

    const images = await collectPageImages(build(), fake);

    expect(fake.calls).toEqual(citedPages(build()));
    expect(images.get(4)).toBe('data:image/png;base64,iVBORw==');
  });

  it('renders at the default resolution unless told otherwise', async () => {
    const fake = renderer();
    const spy = vi.spyOn(fake, 'renderPage');

    await collectPageImages(
      build({ parameters: buckParameters({ vinMin: param(q(3.5, 'V'), 4) }) }),
      fake,
      {
        dpi: 300,
      },
    );

    expect(spy.mock.calls[0]?.[2]).toBe(300);
    expect(DEFAULT_PAGE_IMAGE_DPI).toBe(150);
  });

  it('passes the datasheet path and digest to the renderer', async () => {
    const fake = renderer();
    const spy = vi.spyOn(fake, 'renderPage');
    const subject = build();

    await collectPageImages(subject, fake);

    expect(spy.mock.calls[0]?.[0]).toEqual({
      localPath: subject.datasheet?.localPath,
      sha256: subject.datasheet?.sha256,
    });
  });

  it('yields nothing for a part with no datasheet', async () => {
    const humanSourced: Loose = {};
    for (const [key, value] of Object.entries(buckParameters())) {
      humanSourced[key] = { ...(value as Loose), provenance: humanProvenance() };
    }
    const { datasheet: _datasheet, ...rest } = part({ parameters: humanSourced });
    const fake = renderer();

    const images = await collectPageImages(parseOrThrow(Part, rest, 'Part'), fake);

    expect(images.size).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it('skips a page whose image is larger than the cap, keeping the rest', async () => {
    const fake = renderer(Buffer.alloc(64));

    const images = await collectPageImages(build(), fake, { maxBytesPerPage: 32 });

    expect(images.size).toBe(0);
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(DEFAULT_MAX_PAGE_IMAGE_BYTES).toBe(4 * 1024 * 1024);
  });
});
