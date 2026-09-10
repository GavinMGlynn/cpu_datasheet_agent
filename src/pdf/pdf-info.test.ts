import { describe, expect, it } from 'vitest';

import { PdfInfoError, parsePdfInfo } from './pdf-info.js';

const SAMPLE = [
  'Title:          XYZ54331 3-A Step-Down Converter',
  'Subject:',
  'Author:         Example Semiconductor',
  'Producer:       Acrobat Distiller 10.1.5',
  'CreationDate:   Thu Jan  1 00:00:00 2026 UTC',
  'Pages:          40',
  'Encrypted:      no',
  'Page size:      612 x 792 pts (letter)',
].join('\n');

describe('parsePdfInfo', () => {
  it('reads page count, title, producer, and the encrypted flag', () => {
    expect(parsePdfInfo(SAMPLE)).toEqual({
      pageCount: 40,
      title: 'XYZ54331 3-A Step-Down Converter',
      producer: 'Acrobat Distiller 10.1.5',
      encrypted: false,
    });
  });

  it('treats an empty field as absent without absorbing the next line', () => {
    expect(parsePdfInfo('Title:\nProducer:\nPages: 2\nEncrypted: no')).toEqual({
      pageCount: 2,
      title: undefined,
      producer: undefined,
      encrypted: false,
    });
  });

  it('treats a field padded with spaces as absent', () => {
    expect(parsePdfInfo('Title:      \nPages: 2')).toMatchObject({ title: undefined });
  });

  it('treats a missing field as absent', () => {
    expect(parsePdfInfo('Pages: 2\nEncrypted: no')).toEqual({
      pageCount: 2,
      title: undefined,
      producer: undefined,
      encrypted: false,
    });
  });

  it('reports an encrypted document', () => {
    expect(parsePdfInfo('Pages: 5\nEncrypted: yes (print:yes copy:no)').encrypted).toBe(true);
  });

  it('treats a missing encrypted line as not encrypted', () => {
    expect(parsePdfInfo('Pages: 5').encrypted).toBe(false);
  });

  it('rejects output with no page count', () => {
    expect(() => parsePdfInfo('Title: x\nEncrypted: no')).toThrow(PdfInfoError);
    try {
      parsePdfInfo('Title: x');
    } catch (error) {
      expect((error as PdfInfoError).code).toBe('PDF_INFO_UNPARSEABLE');
      expect((error as PdfInfoError).details).toEqual({ output: 'Title: x' });
    }
  });
});
