// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';

const datasheets = {
  datasheets: [
    {
      sha256: 'a'.repeat(64),
      url: 'https://example.invalid/ds.pdf',
      pageCount: 40,
      fetchedAt: '2026-09-11T09:00:00Z',
      parts: ['TPS54331D', 'TPS54331DR'],
    },
    {
      sha256: 'b'.repeat(64),
      url: 'https://example.invalid/other.pdf',
      pageCount: 12,
      fetchedAt: '2026-09-10T09:00:00Z',
      parts: [],
    },
  ],
};

describe('datasheets', () => {
  it('lists what has been read and what each one covers', async () => {
    renderApp('/datasheets', { datasheets: () => Promise.resolve(datasheets) });
    await waitFor(() => {
      expect(screen.getByText('TPS54331D, TPS54331DR')).toBeInTheDocument();
    });
    expect(screen.getByText('aaaaaaaaaaaa')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('opens a page, moves to another, and closes', async () => {
    renderApp('/datasheets', { datasheets: () => Promise.resolve(datasheets) });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'read it' })[0]).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getAllByRole('button', { name: 'read it' })[0] ?? new HTMLElement(),
    );
    expect(screen.getByRole('heading', { name: 'page 1' })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('page'));
    await userEvent.type(screen.getByLabelText('page'), '4');
    expect(screen.getByRole('heading', { name: 'page 4' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('find on this datasheet'), 'ordering');
    await userEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.queryByRole('heading', { name: /^page /u })).toBeNull();
  });

  it('never asks for a page before the first', async () => {
    renderApp('/datasheets', { datasheets: () => Promise.resolve(datasheets) });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'read it' })[0]).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getAllByRole('button', { name: 'read it' })[0] ?? new HTMLElement(),
    );
    await userEvent.clear(screen.getByLabelText('page'));
    expect(screen.getByRole('heading', { name: 'page 1' })).toBeInTheDocument();
  });

  it('says when nothing has been stored', async () => {
    renderApp('/datasheets', { datasheets: () => Promise.resolve({ datasheets: [] }) });
    await waitFor(() => {
      expect(screen.getByText('no datasheet has been stored yet')).toBeInTheDocument();
    });
  });
});
