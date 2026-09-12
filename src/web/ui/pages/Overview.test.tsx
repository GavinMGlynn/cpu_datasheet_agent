// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';

const overview = {
  runs: {
    runs: 47,
    finished: 44,
    costUsd: 109.33,
    turns: 981,
    byResult: { extracted: 22, verified: 8, rejected: 12, unfinished: 3, needs_human: 2 },
  },
  value: {
    parts: 22,
    parametersStated: 585,
    parametersVerified: 480,
    perPart: 4.97,
    perStatedParameter: 0.187,
    totalUsd: 109.33,
  },
  ledger: { records: 2505, failures: 18 },
  cache: { misses: 7, missRate: 0.01 },
  gate: { total: 1101, decisions: { allow: 1101 } },
};

const spend = {
  points: [
    { key: '2026-09-11', costUsd: 87.24, cumulativeUsd: 87.24, runs: 22, turns: 355 },
    { key: '2026-09-12', costUsd: 22.09, cumulativeUsd: 109.33, runs: 19, turns: 626 },
  ],
};

describe('the overview', () => {
  it('leads with what is stored and what it cost', async () => {
    renderApp('/', {
      overview: () => Promise.resolve(overview),
      spend: () => Promise.resolve(spend),
    });
    await waitFor(() => {
      expect(screen.getByText('585')).toBeInTheDocument();
    });
    expect(screen.getByText('$109.33')).toBeInTheDocument();
    expect(screen.getByText('$4.97')).toBeInTheDocument();
    expect(screen.getByText('2,505')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How the runs ended' })).toBeInTheDocument();
    expect(screen.getByText('Extracted')).toBeInTheDocument();
    expect(screen.getByText(/refused 0.0%/iu)).toBeInTheDocument();
  });

  it('plots what it has cost, day by day', async () => {
    renderApp('/', {
      overview: () => Promise.resolve(overview),
      spend: () => Promise.resolve(spend),
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'What it has cost, day by day' }),
      ).toBeInTheDocument();
    });
  });

  it('falls back to the hour when everything was spent inside one day', async () => {
    const asked: string[] = [];
    renderApp('/', {
      overview: () => Promise.resolve(overview),
      spend: (_source: string, granularity: string) => {
        asked.push(granularity);
        return Promise.resolve(
          granularity === 'day'
            ? {
                points: [
                  {
                    key: '2026-09-11',
                    costUsd: 109.33,
                    cumulativeUsd: 109.33,
                    runs: 47,
                    turns: 981,
                  },
                ],
              }
            : {
                points: [
                  {
                    key: '2026-09-11T11',
                    costUsd: 45.23,
                    cumulativeUsd: 45.23,
                    runs: 20,
                    turns: 400,
                  },
                  {
                    key: '2026-09-11T12',
                    costUsd: 64.1,
                    cumulativeUsd: 109.33,
                    runs: 27,
                    turns: 581,
                  },
                ],
              },
        );
      },
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'What it has cost, hour by hour' }),
      ).toBeInTheDocument();
    });
    expect(asked).toStrictEqual(['day', 'hour']);
  });

  it('says plainly when nothing has run', async () => {
    renderApp('/', {
      overview: () =>
        Promise.resolve({
          ...overview,
          runs: { ...overview.runs, byResult: {} },
          gate: { total: 0, decisions: {} },
        }),
      spend: () => Promise.resolve({ points: [] }),
    });
    await waitFor(() => {
      expect(screen.getByText(/nothing has run against this database yet/iu)).toBeInTheDocument();
    });
    expect(screen.getByText('No runs in this window.')).toBeInTheDocument();
  });

  it('shows the refusal rather than a blank page', async () => {
    renderApp('/', {
      overview: () => Promise.reject(new Error('The database went away')),
      spend: () => Promise.resolve(spend),
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('The database went away');
    });
  });
});
