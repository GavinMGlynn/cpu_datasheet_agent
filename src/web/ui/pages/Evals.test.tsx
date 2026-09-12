// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';

const listing = {
  results: [
    {
      id: '2026-09-11T16-00-31-043Z-extract.v1-claude-opus-5',
      promptVersion: 'extract.v1',
      model: 'claude-opus-5',
      startedAt: '2026-09-11T16:00:31Z',
      parts: 22,
      recall: 0.906,
      precision: 0.906,
      provenanceAccuracy: 0.593,
      withinOnePage: 0.132,
      costUsd: 87.24,
      turns: 355,
      starved: 5,
    },
    {
      id: '2026-09-12T02-00-00-000Z-extract.v2-claude-opus-5',
      promptVersion: 'extract.v2',
      model: 'claude-opus-5',
      startedAt: '2026-09-12T02:00:00Z',
      parts: 22,
      recall: 0.93,
      precision: 0.93,
      provenanceAccuracy: 0.7,
      withinOnePage: 0.1,
      costUsd: 80,
      turns: 320,
      starved: 0,
    },
  ],
};

describe('evaluations', () => {
  it('lists what each prompt scored and what it cost', async () => {
    renderApp('/evals', { evals: () => Promise.resolve(listing) });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'extract.v1' })).toBeInTheDocument();
    });
    // Recall and precision are the same number in this result.
    expect(screen.getAllByText('90.6%')).toHaveLength(2);
    expect(screen.getByText('59.3%')).toBeInTheDocument();
    expect(screen.getByText('$87.24')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/measures the cache rather than the prompt/iu)).toBeInTheDocument();
  });

  it('sorts by every score it shows', async () => {
    renderApp('/evals', { evals: () => Promise.resolve(listing) });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sort by recall' })).toBeInTheDocument();
    });
    for (const column of ['recall', 'precision', 'citations exact', 'cost']) {
      await userEvent.click(screen.getByRole('button', { name: `Sort by ${column}` }));
    }
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('opens one', async () => {
    renderApp('/evals', {
      evals: () => Promise.resolve(listing),
      evalReport: () =>
        Promise.resolve({
          report: {
            promptVersion: 'extract.v1',
            model: 'claude-opus-5',
            costUsd: 87.24,
            turns: 355,
            starved: [],
            set: {
              recall: 0.906,
              precision: 0.906,
              provenanceAccuracy: 0.593,
              withinOnePage: 0.13,
            },
            parts: [],
          },
        }),
      evalParameters: () => Promise.resolve({ parameters: [] }),
      evalFailures: () => Promise.resolve({ failures: [] }),
    });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'extract.v1' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('link', { name: 'extract.v1' }));
    await waitFor(() => {
      expect(globalThis.location.pathname).toContain('/evals/');
    });
  });

  it('says when nothing has been evaluated', async () => {
    renderApp('/evals', { evals: () => Promise.resolve({ results: [] }) });
    await waitFor(() => {
      expect(screen.getByText('No evaluation has been run yet.')).toBeInTheDocument();
    });
  });
});
