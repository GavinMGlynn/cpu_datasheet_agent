import { describe, expect, it } from 'vitest';

import {
  buckParameters,
  classification,
  datasheet,
  distributorProvenance,
  humanProvenance,
  offer,
  param,
  part,
  q,
  verification,
  withConfidence,
  type Loose,
} from '../../test/helpers/core-fixtures.js';
import { Part } from '../core/part.js';
import { parseOrThrow } from '../core/validation-error.js';
import { renderPartReport } from './part-report.js';

function build(overrides: Loose = {}): Part {
  return parseOrThrow(Part, part(overrides), 'Part');
}

const GENERATED = '2026-09-10T12:00:00Z';

function render(overrides: Loose = {}, options = {}): string {
  return renderPartReport(build(overrides), { generatedAt: GENERATED, ...options });
}

describe('document shape', () => {
  it('emits a title and style but no document wrapper, so it serves a file and an artifact alike', () => {
    const html = render();

    expect(html.startsWith('<title>TPS54331DR</title>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).not.toContain('<!doctype');
    expect(html).not.toContain('<html');
    expect(html).not.toContain('<body');
  });

  it('needs no network: no external stylesheet, font, or script', () => {
    const html = render();

    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('opens with the part, its manufacturer, and its status', () => {
    const html = render();

    expect(html).toContain('<h1>TPS54331DR</h1>');
    expect(html).toContain('Texas Instruments');
    expect(html).toContain('buck regulator');
    expect(html).toContain('>extracted<');
  });

  it('closes with when the part was recorded and when the report was made', () => {
    expect(render()).toContain(`Report generated ${GENERATED}`);
  });

  it('uses the current time when none is given', () => {
    const before = Date.now();
    const html = renderPartReport(build());
    const stamp = /Report generated (\S+Z)\./.exec(html)?.[1] ?? '';

    expect(Date.parse(stamp)).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe('parameters', () => {
  it('lists every parameter with its value, source, and confidence', () => {
    const html = render();

    expect(html).toContain('<code>vinMin</code>');
    expect(html).toContain('<code>aecQ100</code>');
    expect(html).toContain('3.5 V');
    expect(html).toContain('570 kHz');
    expect(html).toContain('datasheet page 4 (text)');
    expect((html.match(/badge extracted/g) ?? []).length).toBeGreaterThan(20);
  });

  it('says plainly when a datasheet does not state a value', () => {
    expect(render()).toContain('not stated');
  });

  it('shows the quote under the source when the extraction recorded one', () => {
    const html = render({
      parameters: buckParameters({
        vinMax: {
          value: q(28, 'V'),
          provenance: {
            source: 'datasheet',
            sha256: 'a'.repeat(64),
            page: 4,
            method: 'text',
            quote: 'VIN 3.5 V to 28 V',
          },
          confidence: 'extracted',
        },
      }),
    });

    expect(html).toContain('<div class="quote">VIN 3.5 V to 28 V</div>');
  });

  it('marks a parameter in conflict', () => {
    const html = render({
      parameters: buckParameters({ vinMax: param(q(28, 'V'), 4, 'conflict') }),
      status: 'needs_human',
    });

    expect(html).toContain('badge conflict');
    expect(html).toContain('needs human');
  });

  it('describes every kind of source', () => {
    const parameters = buckParameters({
      vinMin: { value: q(3.5, 'V'), provenance: distributorProvenance(), confidence: 'extracted' },
      vinMax: { value: q(28, 'V'), provenance: humanProvenance(), confidence: 'extracted' },
      ioutMax: {
        value: q(3, 'A'),
        provenance: { source: 'derived', from: ['vinMin'], rule: 'iout.v1' },
        confidence: 'extracted',
      },
    });

    const html = render({ parameters });

    expect(html).toContain('digikey 296-28446-1-ND');
    expect(html).toContain('recorded by hand');
    expect(html).toContain('derived by iout.v1 from vinMin');
  });
});

describe('cited pages', () => {
  it('is absent when no page images are supplied', () => {
    expect(render()).not.toContain('Cited pages');
  });

  it('shows each supplied page beside the values taken from it', () => {
    const html = render({}, { pageImages: new Map([[4, 'pages/page-4.png']]) });

    expect(html).toContain('Cited pages');
    expect(html).toContain('<h3>Page 4</h3>');
    expect(html).toContain('src="pages/page-4.png"');
    expect(html).toContain('alt="Datasheet page 4"');
    expect(html).toContain('<code>vinMin</code>');
  });

  it('shows the quote alongside the page image', () => {
    const html = render(
      {
        parameters: buckParameters({
          vinMax: {
            value: q(28, 'V'),
            provenance: {
              source: 'datasheet',
              sha256: 'a'.repeat(64),
              page: 4,
              method: 'text',
              quote: 'VIN max 28 V',
            },
            confidence: 'extracted',
          },
        }),
      },
      { pageImages: new Map([[4, 'p4.png']]) },
    );

    expect(html).toContain('VIN max 28 V');
  });

  it('shows several cited pages in page order', () => {
    const html = render(
      {
        parameters: buckParameters({
          vinMin: param(q(3.5, 'V'), 9),
          vinMax: param(q(28, 'V'), 4),
        }),
      },
      {
        pageImages: new Map([
          [9, 'p9.png'],
          [4, 'p4.png'],
        ]),
      },
    );

    expect(html.indexOf('<h3>Page 4</h3>')).toBeLessThan(html.indexOf('<h3>Page 9</h3>'));
    expect(html).toContain('src="p4.png"');
    expect(html).toContain('src="p9.png"');
  });

  it('ignores pages with no image and renders nothing when none match', () => {
    const withOne = render({}, { pageImages: new Map([[4, 'p4.png']]) });
    expect(withOne).not.toContain('<h3>Page 5</h3>');

    expect(render({}, { pageImages: new Map([[99, 'p99.png']]) })).not.toContain('Cited pages');
    expect(render({}, { pageImages: new Map() })).not.toContain('Cited pages');
  });

  it('has no pages to show when nothing cites a datasheet', () => {
    const humanSourced: Loose = {};
    for (const [key, value] of Object.entries(buckParameters())) {
      humanSourced[key] = { ...(value as Loose), provenance: humanProvenance() };
    }
    const { datasheet: _datasheet, ...rest } = part({ parameters: humanSourced });

    const html = renderPartReport(parseOrThrow(Part, rest, 'Part'), {
      pageImages: new Map([[4, 'p4.png']]),
      generatedAt: GENERATED,
    });

    expect(html).not.toContain('Cited pages');
    expect(html).toContain('No datasheet attached');
  });
});

describe('datasheet', () => {
  it('shows the source, digest, page count, and the other parts it covers', () => {
    const html = render();

    expect(html).toContain('ti.com');
    expect(html).toContain('<code>TPS54331D</code>');
    expect(html).toContain('40');
  });

  it('says when the ordering table has not been read', () => {
    expect(render({ datasheet: datasheet({ coversMpns: [] }) })).toContain(
      'ordering table not read yet',
    );
  });
});

describe('offers', () => {
  it('lists each offer with its packaging, stock, and price breaks', () => {
    const html = render();

    expect(html).toContain('296-28446-1-ND');
    expect(html).toContain('cut tape');
    expect(html).toContain('12000');
    expect(html).toContain('2.31 AUD');
  });

  it('summarises the best price at the requested quantity', () => {
    const html = render({}, { quantity: 100 });

    expect(html).toContain('Best at 100');
    expect(html).toContain('1.42 AUD');
  });

  it('says when nothing is priced at the quantity asked for', () => {
    const html = render({ offers: [offer({ moq: 5000 })] }, { quantity: 1 });

    expect(html).toContain('no price at this quantity');
  });

  it('handles an offer with no pricing at all', () => {
    expect(render({ offers: [offer({ priceBreaks: [] })] })).toContain('no pricing');
  });

  it('says when there are no offers', () => {
    expect(render({ offers: [] })).toContain('No distributor offers recorded');
  });
});

describe('classification and verification', () => {
  it('lists each axis with the rule that produced it', () => {
    const html = render();

    expect(html).toContain('vinClass');
    expect(html).toContain('le_42v');
    expect(html).toContain('via vin-class.v1');
  });

  it('joins a feature set and names an empty one', () => {
    const html = render({
      classifications: [
        classification({ axis: 'features', value: ['enable', 'sync'], derivedFrom: ['enablePin'] }),
      ],
    });
    expect(html).toContain('enable, sync');

    const empty = render({
      classifications: [
        classification({ axis: 'features', value: [], derivedFrom: ['enablePin'] }),
      ],
    });
    expect(empty).toContain('none');
  });

  it('says when a part is not classified or not verified', () => {
    const html = render({ classifications: [] });

    expect(html).toContain('Not classified');
    expect(html).toContain('Not verified');
  });

  it('lists verifications with verdict, page, and who checked', () => {
    const html = render({
      parameters: withConfidence(buckParameters(), 'verified'),
      status: 'verified',
      verifications: [verification()],
    });

    expect(html).toContain('badge confirmed');
    expect(html).toContain('claude-opus-5');
    expect(html).toContain('verify.v1');
    expect(html).toContain('Input voltage range 3.5 V to 28 V');
  });

  it('marks a verification that found nothing on the page', () => {
    const { quote: _quote, ...notFound } = verification({ verdict: 'not_found' });
    const html = render({ verifications: [notFound] });

    expect(html).toContain('not found');
    expect(html).toContain('no quote');
  });
});

describe('escaping', () => {
  it('escapes values that contain markup or quotes', () => {
    const html = render({
      parameters: buckParameters({ package: param('8-SOIC (0.154", 3.90mm Width)') }),
      manufacturer: 'Acme <b>Semi</b> & Co',
    });

    expect(html).toContain('0.154&quot;');
    expect(html).toContain('Acme &lt;b&gt;Semi&lt;/b&gt; &amp; Co');
    expect(html).not.toContain('<b>Semi</b>');
  });

  it('escapes a datasheet quote and an image path', () => {
    const html = render(
      {
        parameters: buckParameters({
          vinMax: {
            value: q(28, 'V'),
            provenance: {
              source: 'datasheet',
              sha256: 'a'.repeat(64),
              page: 4,
              method: 'text',
              quote: 'VIN < 30 V & rising',
            },
            confidence: 'extracted',
          },
        }),
      },
      { pageImages: new Map([[4, 'a"b.png']]) },
    );

    expect(html).toContain('VIN &lt; 30 V &amp; rising');
    expect(html).toContain('src="a&quot;b.png"');
  });
});
