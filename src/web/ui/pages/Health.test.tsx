// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';
import type { Health } from '../lib/types.js';

const health: Health = {
  version: '1.0.0-test',
  now: '2026-09-12T06:00:00Z',
  source: {
    id: 'live',
    kind: 'live',
    label: 'Live store',
    exists: true,
    writable: true,
    bytes: 167_936,
    modifiedAt: '2026-09-12T00:00:00Z',
  },
  credentials: { digikey: true, mouser: false, nexar: false, anthropic: true },
  poppler: { available: true, versions: { pdftotext: '24.02.0' } },
  database: {
    file: '/data/chip.sqlite',
    migrations: ['initial', 'audit'],
    totals: {
      parts: 22,
      parametersStated: 585,
      parametersCited: 660,
      offers: 82,
      datasheets: 19,
      byStatus: { extracted: 14, verified: 8 },
      byManufacturer: { 'Texas Instruments': 14 },
    },
  },
  ledger: {
    dir: '/data/ledger',
    records: 2505,
    malformed: 0,
    firstAt: '2026-09-11T09:00:00Z',
    lastAt: '2026-09-12T03:34:00Z',
  },
  cacheDir: '/data/cache',
};

describe('health', () => {
  it('reports what is installed and where things live', async () => {
    renderApp('/health', { health: () => Promise.resolve(health) });
    await waitFor(() => {
      expect(screen.getByText('1.0.0-test')).toBeInTheDocument();
    });
    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(screen.getByText('pdftotext 24.02.0')).toBeInTheDocument();
    expect(screen.getByText('Every line readable')).toBeInTheDocument();
    expect(screen.getByText('/data/chip.sqlite')).toBeInTheDocument();
    expect(screen.getByText('initial, audit')).toBeInTheDocument();
    expect(screen.getByText('164.0 kB')).toBeInTheDocument();
  });

  it('says which credentials are present and shows no value', async () => {
    renderApp('/health', { health: () => Promise.resolve(health) });
    await waitFor(() => {
      expect(screen.getAllByText('Present')).toHaveLength(2);
    });
    expect(screen.getAllByText('Not configured')).toHaveLength(2);
  });

  it('says plainly when poppler is missing and the ledger is damaged', async () => {
    renderApp('/health', {
      health: () =>
        Promise.resolve({
          ...health,
          poppler: { available: false },
          ledger: { ...health.ledger, malformed: 3 },
          source: { ...health.source, writable: false },
        }),
    });
    await waitFor(() => {
      expect(screen.getByText('Missing')).toBeInTheDocument();
    });
    expect(screen.getByText('Datasheet pages cannot be read or rendered')).toBeInTheDocument();
    expect(screen.getByText('3 lines unreadable')).toBeInTheDocument();
    expect(screen.getByText(/read only/iu)).toBeInTheDocument();
  });

  it('copes with poppler present but unable to say which version', async () => {
    renderApp('/health', {
      health: () => Promise.resolve({ ...health, poppler: { available: true } }),
    });
    await waitFor(() => {
      expect(screen.getByText('Installed')).toBeInTheDocument();
    });
    expect(screen.queryByText(/pdftotext/iu)).toBeNull();
  });

  it('lists what the system does not do', async () => {
    renderApp('/health', { health: () => Promise.resolve(health) });
    await waitFor(() => {
      expect(screen.getByText('What this system does not do')).toBeInTheDocument();
    });
    expect(screen.getByText('L1')).toBeInTheDocument();
    expect(screen.getByText('L7')).toBeInTheDocument();
  });
});
