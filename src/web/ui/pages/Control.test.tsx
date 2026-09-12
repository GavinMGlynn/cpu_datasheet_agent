// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';
import { run } from '../../../../test/ui/fixtures.js';
import type { Launch } from '../lib/types.js';

const estimate = {
  parts: 1,
  basis: 22,
  meanCostUsd: 3.84,
  estimateUsd: 3.84,
  worstCaseUsd: 4.6,
  basisDescription: 'from 22 extract run(s) already recorded',
};

const running: Launch = {
  id: 'launch-1',
  kind: 'extract',
  mpns: ['TPS54331DR', 'AP62200WU-7'],
  model: 'claude-opus-5',
  promptVersion: 'extract.v1',
  maxCostUsd: 4,
  allowSpend: false,
  actor: 'gavin',
  startedAt: '2026-09-12T00:00:00Z',
  state: 'running',
  runs: [run()],
  cancelling: false,
};

function stubs(overrides = {}) {
  return {
    estimate: () => Promise.resolve(estimate),
    launches: () => Promise.resolve({ launches: [running] }),
    ...overrides,
  };
}

describe('run control', () => {
  it('will not start until a part and a reason are given', async () => {
    renderApp('/control', stubs());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'start it' })).toBeDisabled();
    });
    expect(
      screen.getByText(/name some parts and this will say what they would cost/u),
    ).toBeInTheDocument();
  });

  it('says what it would cost before it asks', async () => {
    renderApp('/control', stubs());
    await userEvent.type(await screen.findByLabelText('parts, comma separated'), 'TPS54331DR');
    await userEvent.type(screen.getByLabelText('why'), 'checking the extraction');
    await waitFor(() => {
      expect(screen.getByText(/1 parts would cost about \$3.84/u)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'start it' }));
    const dialog = screen.getByRole('dialog', { name: 'this will spend money' });
    expect(dialog).toHaveTextContent('extracting 1 part');
    expect(dialog).toHaveTextContent('$3.84');
    expect(dialog).toHaveTextContent('it may not spend at the distributors');
  });

  it('starts a launch with everything the form said', async () => {
    const startLaunch = vi.fn((_body: Record<string, unknown>) =>
      Promise.resolve({ launch: running }),
    );
    const launches = vi.fn(() => Promise.resolve({ launches: [running] }));
    renderApp('/control', stubs({ startLaunch, launches }));
    await userEvent.type(
      await screen.findByLabelText('parts, comma separated'),
      'TPS54331DR, AP62200WU-7',
    );
    await userEvent.type(screen.getByLabelText('why'), 'checking the extraction');
    await userEvent.click(screen.getByLabelText('let it spend at the distributors'));
    await userEvent.clear(screen.getByLabelText('ceiling for the whole launch, dollars'));
    await userEvent.type(screen.getByLabelText('ceiling for the whole launch, dollars'), '20');
    await userEvent.clear(screen.getByLabelText('ceiling for one run, dollars'));
    await userEvent.type(screen.getByLabelText('ceiling for one run, dollars'), '5');
    await userEvent.clear(screen.getByLabelText('your name'));
    await userEvent.type(screen.getByLabelText('your name'), 'someone else');
    await userEvent.selectOptions(screen.getByLabelText('what to run'), 'verify');
    await userEvent.click(screen.getByRole('button', { name: 'start it' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('it may fetch from the distributors');
    await userEvent.click(screen.getByRole('button', { name: 'start the run' }));
    await waitFor(() => {
      expect(startLaunch).toHaveBeenCalledTimes(1);
    });
    expect(startLaunch.mock.calls[0]?.[0]).toMatchObject({
      kind: 'verify',
      mpns: ['TPS54331DR', 'AP62200WU-7'],
      ceilingUsd: 20,
      maxCostUsd: 5,
      allowSpend: true,
      confirmed: true,
      reason: 'checking the extraction',
      actor: 'someone else',
    });
    await waitFor(() => {
      expect(launches).toHaveBeenCalledTimes(2);
    });
  });

  it('shows what the server said when it refuses to start', async () => {
    renderApp('/control', stubs({ startLaunch: () => Promise.reject(new Error('no budget')) }));
    await userEvent.type(await screen.findByLabelText('parts, comma separated'), 'TPS54331DR');
    await userEvent.type(screen.getByLabelText('why'), 'checking it');
    await userEvent.click(screen.getByRole('button', { name: 'start it' }));
    await userEvent.click(screen.getByRole('button', { name: 'start the run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no budget');
  });

  it('closes the confirmation without starting anything', async () => {
    const startLaunch = vi.fn(() => Promise.resolve({ launch: running }));
    renderApp('/control', stubs({ startLaunch }));
    await userEvent.type(await screen.findByLabelText('parts, comma separated'), 'TPS54331DR');
    await userEvent.type(screen.getByLabelText('why'), 'checking it');
    await userEvent.click(screen.getByRole('button', { name: 'start it' }));
    await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(startLaunch).not.toHaveBeenCalled();
  });

  it('lists what is running, with what it has spent', async () => {
    renderApp('/control', stubs());
    await waitFor(() => {
      expect(screen.getByRole('cell', { name: 'TPS54331DR, AP62200WU-7' })).toBeInTheDocument();
    });
    expect(screen.getByText('$3.41')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('stops a launch after the part it is on', async () => {
    const cancelLaunch = vi.fn(() => Promise.resolve({ launch: { ...running, cancelling: true } }));
    const launches = vi.fn(() => Promise.resolve({ launches: [running] }));
    renderApp('/control', stubs({ cancelLaunch, launches }));
    await userEvent.click(await screen.findByRole('button', { name: 'stop after this part' }));
    await waitFor(() => {
      expect(cancelLaunch).toHaveBeenCalledWith('launch-1');
    });
    await waitFor(() => {
      expect(launches).toHaveBeenCalledTimes(2);
    });
  });

  it('reloads the list even when stopping fails', async () => {
    const launches = vi.fn(() => Promise.resolve({ launches: [running] }));
    renderApp(
      '/control',
      stubs({ cancelLaunch: () => Promise.reject(new Error('already done')), launches }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'stop after this part' }));
    await waitFor(() => {
      expect(launches).toHaveBeenCalledTimes(2);
    });
  });

  it('offers no stop for a launch that has ended', async () => {
    renderApp('/control', {
      ...stubs(),
      launches: () => Promise.resolve({ launches: [{ ...running, state: 'finished' as const }] }),
    });
    await waitFor(() => {
      expect(screen.getByText('finished')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'stop after this part' })).toBeNull();
  });

  it('shows a launch with no runs behind it yet', async () => {
    renderApp('/control', {
      ...stubs(),
      launches: () => Promise.resolve({ launches: [{ ...running, runs: [] }] }),
    });
    await waitFor(() => {
      expect(screen.getByText('0/2')).toBeInTheDocument();
    });
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('adds up a launch whose runs did not all report a cost', async () => {
    const { unfinishedRun } = await import('../../../../test/ui/fixtures.js');
    renderApp('/control', {
      ...stubs(),
      launches: () =>
        Promise.resolve({
          launches: [
            { ...running, runs: [run(), unfinishedRun('00000000-0000-4000-8000-000000000009')] },
          ],
        }),
    });
    await waitFor(() => {
      expect(screen.getByText('$3.41')).toBeInTheDocument();
    });
  });

  it('says when nothing has been started here', async () => {
    renderApp('/control', { ...stubs(), launches: () => Promise.resolve({ launches: [] }) });
    await waitFor(() => {
      expect(screen.getByText('nothing has been started from this browser')).toBeInTheDocument();
    });
  });
});
