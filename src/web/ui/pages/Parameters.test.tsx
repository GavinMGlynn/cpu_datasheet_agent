// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';

const coverage = {
  coverage: [
    {
      key: 'vinMax',
      stated: 22,
      cited: 22,
      verified: 18,
      conflicted: 0,
      contradicted: 1,
      parts: 22,
      coverage: 1,
    },
    {
      key: 'maxDutyCycle',
      stated: 10,
      cited: 22,
      verified: 18,
      conflicted: 0,
      contradicted: 0,
      parts: 22,
      coverage: 0.45,
    },
    {
      key: 'voutFixed',
      stated: 3,
      cited: 22,
      verified: 18,
      conflicted: 0,
      contradicted: 0,
      parts: 22,
      coverage: 0.14,
    },
    {
      key: 'efficiencyPeak',
      stated: 4,
      cited: 22,
      verified: 18,
      conflicted: 0,
      contradicted: 0,
      parts: 22,
      coverage: 0.18,
    },
  ],
};

const distribution = {
  key: 'vinMax',
  unit: 'V',
  points: [{ mpn: 'TPS54331DR', min: 28, max: 28 }],
  summary: { count: 22, sum: 600, min: 5.5, max: 60, mean: 27, p50: 28, p90: 42, p99: 60 },
  buckets: [
    { from: 5.5, to: 20, count: 4 },
    { from: 20, to: 40, count: 15 },
  ],
  nonNumeric: 0,
};

describe('the parameter grid', () => {
  it('shows coverage per parameter and names the weakest', async () => {
    renderApp('/parameters', {
      coverage: () => Promise.resolve(coverage),
      distribution: () => Promise.resolve(distribution),
    });
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'parameters by parts' })).toBeInTheDocument();
    });
    expect(screen.getByText(/voutFixed 14%/u)).toBeInTheDocument();
    expect(screen.getByText(/efficiencyPeak 18%/u)).toBeInTheDocument();
  });

  it('plots the distribution of the parameter chosen', async () => {
    const request = vi.fn((key: string) => Promise.resolve({ ...distribution, key }));
    renderApp('/parameters', {
      coverage: () => Promise.resolve(coverage),
      distribution: request,
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /vinMax across the set/u })).toBeInTheDocument();
    });
    expect(screen.getByText('22 parts state a number; 0 do not')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('distribution of'), 'maxDutyCycle');
    await waitFor(() => {
      expect(request.mock.calls.at(-1)?.[0]).toBe('maxDutyCycle');
    });
  });

  it('says when a parameter has no numbers to plot', async () => {
    renderApp('/parameters?key=topology', {
      coverage: () => Promise.resolve(coverage),
      distribution: () =>
        Promise.resolve({ key: 'topology', points: [], buckets: [], nonNumeric: 22 }),
    });
    await waitFor(() => {
      expect(screen.getByText('no part states a number for this parameter')).toBeInTheDocument();
    });
    expect(screen.getByText('no numeric values to plot')).toBeInTheDocument();
  });

  it('labels a parameter with no unit as a plain count', async () => {
    renderApp('/parameters?key=aecQ100', {
      coverage: () => Promise.resolve(coverage),
      distribution: () =>
        Promise.resolve({
          key: 'aecQ100',
          points: [{ mpn: 'TPS54331DR', min: 1, max: 1 }],
          summary: { count: 1, sum: 1, min: 1, max: 1, mean: 1, p50: 1, p90: 1, p99: 1 },
          buckets: [{ from: 0, to: 1, count: 1 }],
          nonNumeric: 21,
        }),
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /aecQ100 across the set/u })).toBeInTheDocument();
    });
    expect(screen.getByText('1 parts state a number; 21 do not')).toBeInTheDocument();
  });

  it('copes with an empty database', async () => {
    renderApp('/parameters', {
      coverage: () => Promise.resolve({ coverage: [] }),
      distribution: () =>
        Promise.resolve({ key: 'vinMax', points: [], buckets: [], nonNumeric: 0 }),
    });
    await waitFor(() => {
      expect(screen.getByText('nothing stored yet')).toBeInTheDocument();
    });
  });
});
