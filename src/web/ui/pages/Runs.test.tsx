// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';
import { run, unfinishedRun } from '../../../../test/ui/fixtures.js';

function page(items = [run(), unfinishedRun('00000000-0000-4000-8000-000000000009')]) {
  return { total: items.length, offset: 0, limit: 500, items };
}

describe('runs', () => {
  it('lists what the agent did, with cost, turns and duration', async () => {
    renderApp('/runs', { runs: () => Promise.resolve(page()) });
    await waitFor(() => {
      expect(screen.getByText('2 runs')).toBeInTheDocument();
    });
    expect(screen.getByText('$3.41')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('4m 0s')).toBeInTheDocument();
    expect(screen.getByText('unfinished')).toBeInTheDocument();
    // The unfinished run has no cost, turns, calls or duration to show.
    expect(screen.getAllByText('—').length).toBeGreaterThan(2);
  });

  it('filters by kind and by how the run ended', async () => {
    const runs = vi.fn((_options: { kind?: string; result?: string }) => Promise.resolve(page()));
    renderApp('/runs', { runs });
    await waitFor(() => {
      expect(runs).toHaveBeenCalledTimes(1);
    });
    await userEvent.selectOptions(screen.getByLabelText('kind'), 'verify');
    await waitFor(() => {
      expect(runs.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'verify' });
    });
    await userEvent.selectOptions(screen.getByLabelText('ended'), 'needs_human');
    await waitFor(() => {
      expect(runs.mock.calls.at(-1)?.[0]).toMatchObject({ result: 'needs_human' });
    });
  });

  it('sorts on every column it offers', async () => {
    renderApp('/runs', { runs: () => Promise.resolve(page()) });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sort by cost' })).toBeInTheDocument();
    });
    for (const column of [
      'part',
      'kind',
      'ended',
      'cost',
      'turns',
      'tool calls',
      'took',
      'model',
    ]) {
      await userEvent.click(screen.getByRole('button', { name: `sort by ${column}` }));
    }
    expect(screen.getAllByRole('row').length).toBe(3);
  });

  it('opens a run', async () => {
    renderApp('/runs', {
      runs: () => Promise.resolve(page()),
      run: () => Promise.resolve({ run: run(), calls: [], tree: [] }),
    });
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'TPS54331DR' })[0]).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getAllByRole('link', { name: 'TPS54331DR' })[0] ?? new HTMLElement(),
    );
    await waitFor(() => {
      expect(globalThis.location.pathname).toContain('/runs/');
    });
  });

  it('says when nothing matches', async () => {
    renderApp('/runs', { runs: () => Promise.resolve(page([])) });
    await waitFor(() => {
      expect(screen.getByText('no run matches those filters')).toBeInTheDocument();
    });
  });
});
