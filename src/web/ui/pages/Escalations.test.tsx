// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Escalation } from '../lib/types.js';
import { renderApp } from '../../../../test/ui/render.js';

const open: Escalation = {
  id: '3f5a1c2e-8b7d-4e6f-9a0b-1c2d3e4f5a6b',
  mpn: 'TPS54331DR',
  kind: 'In conflict',
  question: 'Datasheet says 28 V, Digi-Key says 30 V. Which is right?',
  context: { datasheet: 28, distributor: 30 },
  options: ['28 V, the datasheet', '30 V, the distributor'],
  createdAt: '2026-09-11T09:00:00Z',
};

const { options: _options, ...withoutOptions } = open;

const answered: Escalation = {
  ...withoutOptions,
  id: '4f5a1c2e-8b7d-4e6f-9a0b-1c2d3e4f5a6b',
  resolution: { answer: '28 V', resolvedAt: '2026-09-12T00:00:00Z', by: 'gavin' },
};

describe('questions', () => {
  it('lists the open ones with what the run was looking at', async () => {
    renderApp('/escalations', { escalations: () => Promise.resolve({ escalations: [open] }) });
    await waitFor(() => {
      expect(screen.getByText(open.question)).toBeInTheDocument();
    });
    expect(screen.getByLabelText('What the run was looking at')).toHaveTextContent(
      '"datasheet": 28',
    );
  });

  it('shows an answered question with who answered it', async () => {
    renderApp('/escalations?', {
      escalations: () => Promise.resolve({ escalations: [answered] }),
    });
    await waitFor(() => {
      expect(screen.getByText(/answered by gavin/iu)).toBeInTheDocument();
    });
  });

  it('narrows to open, answered, or everything', async () => {
    const escalations = vi.fn((_options: { resolved?: boolean }) =>
      Promise.resolve({ escalations: [open] }),
    );
    renderApp('/escalations', { escalations });
    await waitFor(() => {
      expect(escalations.mock.calls[0]?.[0]).toMatchObject({ resolved: false });
    });
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'resolved');
    await waitFor(() => {
      expect(escalations.mock.calls.at(-1)?.[0]).toMatchObject({ resolved: true });
    });
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'all');
    await waitFor(() => {
      expect(escalations.mock.calls.at(-1)?.[0]).not.toHaveProperty('resolved');
    });
  });

  it('answers one, offering the options the run gave', async () => {
    const resolveEscalation = vi.fn(() => Promise.resolve({}));
    const escalations = vi.fn(() => Promise.resolve({ escalations: [open] }));
    renderApp('/escalations', { escalations, resolveEscalation });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Answer' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await userEvent.click(screen.getByRole('button', { name: '28 V, the datasheet' }));
    await userEvent.type(screen.getByLabelText('Why you are answering it'), 'Read page 2 myself');
    await userEvent.clear(screen.getByLabelText('Your name'));
    await userEvent.type(screen.getByLabelText('Your name'), 'Someone else');
    await userEvent.click(screen.getByRole('button', { name: 'Record answer' }));
    await waitFor(() => {
      expect(resolveEscalation).toHaveBeenCalledWith(
        open.id,
        expect.objectContaining({
          answer: '28 V, the datasheet',
          reason: 'Read page 2 myself',
        }) as unknown,
      );
    });
    await waitFor(() => {
      expect(escalations).toHaveBeenCalledTimes(2);
    });
  });

  it('shows what the server said when it refuses the answer', async () => {
    renderApp('/escalations', {
      escalations: () => Promise.resolve({ escalations: [open] }),
      resolveEscalation: () => Promise.reject(new Error('Already resolved')),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Answer' }));
    await userEvent.type(screen.getByLabelText('Your answer'), '28 V');
    await userEvent.type(screen.getByLabelText('Why you are answering it'), 'Checked it');
    await userEvent.click(screen.getByRole('button', { name: 'Record answer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already resolved');
  });

  it('closes the answer without recording anything', async () => {
    renderApp('/escalations', { escalations: () => Promise.resolve({ escalations: [open] }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Answer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a question with no options to choose from', async () => {
    renderApp('/escalations', {
      escalations: () => Promise.resolve({ escalations: [withoutOptions] }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Answer' }));
    expect(screen.queryByRole('button', { name: '28 V, the datasheet' })).toBeNull();
    expect(screen.getByLabelText('Your answer')).toBeInTheDocument();
  });

  it('says when nothing is waiting', async () => {
    renderApp('/escalations', { escalations: () => Promise.resolve({ escalations: [] }) });
    await waitFor(() => {
      expect(screen.getByText('Nothing is waiting on a person.')).toBeInTheDocument();
    });
  });
});
