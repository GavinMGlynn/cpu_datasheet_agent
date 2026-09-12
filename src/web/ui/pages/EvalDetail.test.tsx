// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';

const id = '2026-09-11T16-00-31-043Z-extract.v1-claude-opus-5';

const report = {
  report: {
    promptVersion: 'extract.v1',
    model: 'claude-opus-5',
    costUsd: 87.24,
    turns: 355,
    starved: ['LMR33630ADDAR', 'TLV62569DBVR'],
    set: { recall: 0.906, precision: 0.906, provenanceAccuracy: 0.593, withinOnePage: 0.132 },
    parts: [
      { mpn: 'TPS54331DR', score: { recall: 1, precision: 1 }, run: { costUsd: 3.41, turns: 18 } },
    ],
  },
};

const parameters = {
  parameters: [
    {
      key: 'maxDutyCycle',
      correct: 5,
      stated: 14,
      accuracy: 0.357,
      wrongParts: ['TPS54331DR'],
      missingParts: [],
      citationExact: 9,
      citationWithinOne: 2,
    },
    {
      key: 'vinMax',
      correct: 22,
      stated: 22,
      accuracy: 1,
      wrongParts: [],
      missingParts: [],
      citationExact: 20,
      citationWithinOne: 1,
    },
    {
      key: 'never',
      correct: 0,
      stated: 0,
      accuracy: 0,
      wrongParts: [],
      missingParts: ['AP62200WU-7'],
      citationExact: 0,
      citationWithinOne: 0,
    },
  ],
};

const failures = {
  failures: [
    {
      mpn: 'TPS54331DR',
      key: 'maxDutyCycle',
      score: 'wrong',
      page: 'exact',
      expected: { value: 90, unit: 'percent' },
      actual: { value: 93, unit: 'percent' },
    },
  ],
};

function stubs() {
  return {
    evalReport: () => Promise.resolve(report),
    evalParameters: () => Promise.resolve(parameters),
    evalFailures: () => Promise.resolve(failures),
  };
}

describe('one evaluation', () => {
  it('leads with the scores and what they cost', async () => {
    renderApp(`/evals/${encodeURIComponent(id)}`, stubs());
    await waitFor(() => {
      expect(screen.getByText('extract.v1')).toBeInTheDocument();
    });
    expect(screen.getAllByText('90.6%')).toHaveLength(2);
    expect(screen.getByText('59.3%')).toBeInTheDocument();
    expect(screen.getByText('$87.24')).toBeInTheDocument();
    expect(
      screen.getByText(/2 parts wanted something the cache did not have/iu),
    ).toBeInTheDocument();
  });

  it('puts the least reliable parameter first, and names the parts', async () => {
    renderApp(`/evals/${encodeURIComponent(id)}`, stubs());
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /accuracy by parameter/iu })).toBeInTheDocument();
    });
    expect(screen.getByRole('cell', { name: '5/14' })).toBeInTheDocument();
    // Once as the part maxDutyCycle was wrong for, once in the failures table.
    expect(screen.getAllByRole('cell', { name: 'TPS54331DR' })).toHaveLength(2);
    expect(screen.getByRole('cell', { name: 'AP62200WU-7' })).toBeInTheDocument();
  });

  it('lists every value that did not match, with both sides', async () => {
    renderApp(`/evals/${encodeURIComponent(id)}`, stubs());
    await waitFor(() => {
      expect(screen.getByText('Every value that did not match')).toBeInTheDocument();
    });
    expect(screen.getByRole('cell', { name: '90 %' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '93 %' })).toBeInTheDocument();
  });

  it('sorts the parameter table', async () => {
    renderApp(`/evals/${encodeURIComponent(id)}`, stubs());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sort by right' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Sort by right' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sort by cited exactly' }));
    expect(screen.getAllByRole('table').length).toBeGreaterThan(1);
  });

  it('says when nothing was starved and nothing failed', async () => {
    renderApp(`/evals/${encodeURIComponent(id)}`, {
      evalReport: () => Promise.resolve({ report: { ...report.report, starved: [] } }),
      evalParameters: () => Promise.resolve(parameters),
      evalFailures: () => Promise.resolve({ failures: [] }),
    });
    await waitFor(() => {
      expect(screen.getByText('Every value matched the golden reading.')).toBeInTheDocument();
    });
    expect(screen.queryByText(/wanted something the cache did not have/iu)).toBeNull();
  });

  it('goes back to the evaluations', async () => {
    renderApp(`/evals/${encodeURIComponent(id)}`, {
      ...stubs(),
      evals: () => Promise.resolve({ results: [] }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Back to evaluations' }));
    await waitFor(() => {
      expect(globalThis.location.pathname).toBe('/evals');
    });
  });
});
