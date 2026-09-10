import { describe, expect, it } from 'vitest';

import { escapeHtml } from './escape.js';

describe('escapeHtml', () => {
  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
  ])('escapes %s', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it('escapes a package name containing a quote, as Digi-Key writes them', () => {
    expect(escapeHtml('8-SOIC (0.154", 3.90mm Width)')).toBe('8-SOIC (0.154&quot;, 3.90mm Width)');
  });

  it('neutralises markup in a datasheet quote', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes ampersands once, not twice', () => {
    expect(escapeHtml('Tape & Reel')).toBe('Tape &amp; Reel');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('leaves ordinary text and empty strings alone', () => {
    expect(escapeHtml('TPS54331DR')).toBe('TPS54331DR');
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml('-40 °C ~ 150 °C')).toBe('-40 °C ~ 150 °C');
  });
});
