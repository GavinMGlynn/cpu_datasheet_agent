// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { first, renderApp } from '../../../../test/ui/render.js';
import { parameterRow, run, summary, unfinishedRun } from '../../../../test/ui/fixtures.js';

function detail(overrides: Record<string, unknown> = {}) {
  return {
    part: {},
    summary: summary(),
    parameters: [
      parameterRow(),
      parameterRow({
        key: 'rdsOnLow',
        value: null,
        provenance: { source: 'derived', rule: 'x' },
        verdict: {
          parameterKey: 'rdsOnLow',
          verdict: 'contradicted',
          quote: 'Page says 0.33',
          page: 5,
          checkedAt: '2026-09-12T00:00:00Z',
          model: 'claude-opus-5',
        },
      }),
    ],
    runs: [run(), unfinishedRun('00000000-0000-4000-8000-000000000009')],
    escalations: [],
    datasheetMpns: ['TPS54331D', 'TPS54331DR'],
    ...overrides,
  };
}

describe('a part', () => {
  it('shows what is stored, where it came from, and what checked it', async () => {
    renderApp('/parts/TPS54331DR', { part: () => Promise.resolve(detail()) });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'TPS54331DR' })).toBeInTheDocument();
    });
    expect(screen.getByText('Texas Instruments')).toBeInTheDocument();
    expect(screen.getByText('28/30')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '28 V' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 4' })).toBeInTheDocument();
    expect(screen.getByText('Contradicted')).toBeInTheDocument();
    expect(screen.getByText('Not checked')).toBeInTheDocument();
    expect(screen.getByText('TPS54331D, TPS54331DR')).toBeInTheDocument();
  });

  it('opens the page a value cites', async () => {
    renderApp('/parts/TPS54331DR', { part: () => Promise.resolve(detail()) });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Page 4' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Page 4' }));
    expect(
      screen.getByRole('img', { name: /page 4 of the datasheet/iu }).getAttribute('src'),
    ).toContain('/pages/4/image');
  });

  it('lists the questions raised about it', async () => {
    renderApp('/parts/TPS54331DR', {
      part: () =>
        Promise.resolve(
          detail({
            escalations: [
              {
                id: 'e-1',
                mpn: 'TPS54331DR',
                kind: 'In conflict',
                question: 'Is Vin max 28 V or 30 V?',
                context: {},
                createdAt: '2026-09-11T00:00:00Z',
              },
              {
                id: 'e-2',
                mpn: 'TPS54331DR',
                kind: 'In conflict',
                question: 'Already answered',
                context: {},
                createdAt: '2026-09-11T00:00:00Z',
                resolution: { answer: '28 V', resolvedAt: '2026-09-12T00:00:00Z', by: 'gavin' },
              },
            ],
          }),
        ),
    });
    await waitFor(() => {
      expect(screen.getByText('Is Vin max 28 V or 30 V?')).toBeInTheDocument();
    });
    expect(screen.getByText('Already answered')).toBeInTheDocument();
  });

  it('corrects a value, and says what it will keep', async () => {
    const correctParameter = vi.fn(() => Promise.resolve({}));
    const part = vi.fn(() => Promise.resolve(detail()));
    renderApp('/parts/TPS54331DR', { part, correctParameter });
    await waitFor(() => {
      expect(first(screen.getAllByRole('button', { name: 'Correct' }))).toBeInTheDocument();
    });
    await userEvent.click(first(screen.getAllByRole('button', { name: 'Correct' })));
    expect(screen.getByRole('dialog', { name: 'Correct vinMax' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('Value, as JSON'));
    await userEvent.type(screen.getByLabelText('Value, as JSON'), '{{"value":26,"unit":"V"}');
    await userEvent.type(screen.getByLabelText('What you read, and where'), 'Page 2');
    await userEvent.type(screen.getByLabelText('Why you are changing it'), 'The ordering table');
    await userEvent.clear(screen.getByLabelText('Your name'));
    await userEvent.type(screen.getByLabelText('Your name'), 'someone');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));

    await waitFor(() => {
      expect(correctParameter).toHaveBeenCalledWith(
        'TPS54331DR',
        'vinMax',
        expect.objectContaining({
          note: 'Page 2',
          reason: 'The ordering table',
          actor: 'someone',
        }) as unknown,
      );
    });
    await waitFor(() => {
      expect(part).toHaveBeenCalledTimes(2);
    });
  });

  it('refuses a value that is not JSON before it asks the server', async () => {
    const correctParameter = vi.fn(() => Promise.resolve({}));
    renderApp('/parts/TPS54331DR', { part: () => Promise.resolve(detail()), correctParameter });
    await waitFor(() => {
      expect(first(screen.getAllByRole('button', { name: 'Correct' }))).toBeInTheDocument();
    });
    await userEvent.click(first(screen.getAllByRole('button', { name: 'Correct' })));
    await userEvent.clear(screen.getByLabelText('Value, as JSON'));
    await userEvent.type(screen.getByLabelText('Value, as JSON'), 'Twenty-eight volts');
    await userEvent.type(screen.getByLabelText('What you read, and where'), 'Page 2');
    await userEvent.type(screen.getByLabelText('Why you are changing it'), 'The ordering table');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That is not JSON');
    expect(correctParameter).not.toHaveBeenCalled();
  });

  it('shows what the server said when it refuses a correction', async () => {
    renderApp('/parts/TPS54331DR', {
      part: () => Promise.resolve(detail()),
      correctParameter: () =>
        Promise.reject(new Error('A verified part must have every value verified')),
    });
    await waitFor(() => {
      expect(first(screen.getAllByRole('button', { name: 'Correct' }))).toBeInTheDocument();
    });
    await userEvent.click(first(screen.getAllByRole('button', { name: 'Correct' })));
    await userEvent.type(screen.getByLabelText('What you read, and where'), 'Page 2');
    await userEvent.type(screen.getByLabelText('Why you are changing it'), 'The ordering table');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('every value verified');
  });

  it('closes the correction without storing anything', async () => {
    renderApp('/parts/TPS54331DR', { part: () => Promise.resolve(detail()) });
    await waitFor(() => {
      expect(first(screen.getAllByRole('button', { name: 'Correct' }))).toBeInTheDocument();
    });
    await userEvent.click(first(screen.getAllByRole('button', { name: 'Correct' })));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('goes back to the catalogue', async () => {
    renderApp('/parts/TPS54331DR', {
      part: () => Promise.resolve(detail()),
      parts: () => Promise.resolve({ source: 'live', total: 0, offset: 0, limit: 50, items: [] }),
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to catalogue' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Back to catalogue' }));
    await waitFor(() => {
      expect(globalThis.location.pathname).toBe('/parts');
    });
  });

  it('copes with a part that has no datasheet and no runs', async () => {
    renderApp('/parts/MCP16331T-E%2FCH', {
      part: () =>
        Promise.resolve(
          detail({
            summary: summary({ mpn: 'MCP16331T-E/CH', datasheet: undefined, bestPrice: null }),
            runs: [],
            datasheetMpns: [],
          }),
        ),
    });
    await waitFor(() => {
      expect(screen.getByText('Nothing else is recorded against it')).toBeInTheDocument();
    });
    expect(screen.getByText('No run has touched this part in this database.')).toBeInTheDocument();
  });
});
