import { PDFDocument, StandardFonts } from 'pdf-lib';

/** A line of text, or a row of cells laid out at fixed column positions. */
export type FixtureLine = string | readonly string[];

export interface PageSpec {
  readonly lines: readonly FixtureLine[];
}

export interface PdfSpec {
  readonly title?: string;
  readonly producer?: string;
  readonly pages: readonly PageSpec[];
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const TOP = PAGE_HEIGHT - MARGIN;
const LEADING = 16;
const COLUMN_WIDTH = 100;

/**
 * Builds a PDF with known text so poppler can be exercised for real without
 * committing a copyrighted datasheet. Cell rows are drawn at fixed column
 * positions, which `pdftotext -layout` renders as space-separated columns.
 */
export async function buildPdf(spec: PdfSpec): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(spec.title ?? '');
  doc.setProducer(spec.producer ?? 'chip-datasheet-agent tests');
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const pageSpec of spec.pages) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageSpec.lines.forEach((line, index) => {
      const y = TOP - index * LEADING;
      if (typeof line === 'string') {
        page.drawText(line, { x: MARGIN, y, size: 11, font });
        return;
      }
      line.forEach((cell, column) => {
        page.drawText(cell, { x: MARGIN + column * COLUMN_WIDTH, y, size: 9, font });
      });
    });
  }
  return Buffer.from(await doc.save());
}

/**
 * A four-page stand-in for a buck-regulator datasheet: a cover, an ordering
 * table covering several MPNs, a dense electrical table whose rows lose their
 * labels through text extraction, and absolute maximum ratings.
 */
export function datasheetSpec(): PdfSpec {
  return {
    title: 'XYZ54331 3-A Step-Down Converter',
    pages: [
      {
        lines: [
          'XYZ54331 3-A Wide Input Range Step-Down Converter',
          '',
          'Features',
          'Input voltage range 3.5 V to 28 V',
          'Up to 3 A continuous output current',
          'Adjustable output from 0.8 V',
          '',
          'Pin Configuration and Functions',
          'The device is offered in an 8-pin SOIC package.',
        ],
      },
      {
        lines: [
          'Ordering Information',
          '',
          ['Part Number', 'Package', 'Temperature', 'Packaging'],
          ['XYZ54331D', 'SOIC-8', '-40 to 150 C', 'Tube'],
          ['XYZ54331DR', 'SOIC-8', '-40 to 150 C', 'Tape and Reel'],
          ['XYZ54331DDAR', 'SO PowerPAD', '-40 to 150 C', 'Tape and Reel'],
          '',
          'Package Information',
          'Mechanical data are given at the end of this document.',
        ],
      },
      {
        lines: [
          'Electrical Characteristics',
          'Over operating free-air temperature range unless otherwise noted',
          '',
          ['Parameter', 'Min', 'Typ', 'Max', 'Unit'],
          ['3.5', '12.0', '28.0', 'V', ''],
          ['0.784', '0.800', '0.816', 'V', ''],
          ['456', '570', '684', 'kHz', ''],
          ['0.06', '0.08', '0.11', 'Ohm', ''],
          ['1.0', '1.6', '2.2', 'mA', ''],
          ['85', '91', '96', '%', ''],
        ],
      },
      {
        lines: [
          'Absolute Maximum Ratings',
          '',
          'Input voltage VIN: 30 V maximum',
          'Recommended Operating Conditions are listed on page 3.',
        ],
      },
    ],
  };
}

/** A one-page PDF whose only line is the given text. */
export function simpleSpec(text: string): PdfSpec {
  return { title: 'simple', pages: [{ lines: [text] }] };
}
