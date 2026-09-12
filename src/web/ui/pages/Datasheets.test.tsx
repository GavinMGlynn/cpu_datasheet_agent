// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { first, renderApp } from '../../../../test/ui/render.js';

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

  it('opens a page in front of the table, moves through it, and closes', async () => {
    renderApp('/datasheets', { datasheets: () => Promise.resolve(datasheets) });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'View' })[0]).toBeInTheDocument();
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'View' })[0] ?? new HTMLElement());
    // A dialog, so what opened is in front of the reader rather than a
    // thousand pixels below the button they pressed.
    expect(screen.getByRole('dialog')).toHaveAccessibleName('TPS54331D, TPS54331DR · page 1 of 40');
    expect(screen.getByAltText('Page 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByAltText('Page 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByAltText('Page 1')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Page'));
    await userEvent.type(screen.getByLabelText('Page'), '4');
    expect(screen.getByAltText('Page 4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('will not step past either end of the datasheet', async () => {
    renderApp('/datasheets', { datasheets: () => Promise.resolve(datasheets) });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'View' })[1]).toBeInTheDocument();
    });
    // The second datasheet is twelve pages, and nothing this database holds
    // has a page thirteen.
    await userEvent.click(screen.getAllByRole('button', { name: 'View' })[1] ?? new HTMLElement());
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Page'));
    await userEvent.type(screen.getByLabelText('Page'), '12');
    expect(screen.getByAltText('Page 12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Page'), '9');
    expect(screen.getByAltText('Page 12')).toBeInTheDocument();
  });

  it('names a datasheet nothing is known to cover by its digest', async () => {
    renderApp('/datasheets', { datasheets: () => Promise.resolve(datasheets) });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'View' })[1]).toBeInTheDocument();
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'View' })[1] ?? new HTMLElement());
    expect(screen.getByRole('dialog')).toHaveAccessibleName('bbbbbbbbbbbb · page 1 of 12');
  });

  it('never asks for a page before the first', async () => {
    renderApp('/datasheets', { datasheets: () => Promise.resolve(datasheets) });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'View' })[0]).toBeInTheDocument();
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'View' })[0] ?? new HTMLElement());
    await userEvent.clear(screen.getByLabelText('Page'));
    expect(screen.getByAltText('Page 1')).toBeInTheDocument();
  });

  it('sorts by length and by when it was read', async () => {
    renderApp('/datasheets', { datasheets: () => Promise.resolve(datasheets) });
    await waitFor(() => {
      expect(screen.getByText('TPS54331D, TPS54331DR')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Sort by pages' }));
    expect(first(screen.getAllByRole('row').slice(1)).textContent).toContain('12');
    await userEvent.click(screen.getByRole('button', { name: 'Sort by fetched' }));
    expect(first(screen.getAllByRole('row').slice(1)).textContent).toContain('bbbbbbbbbbbb');
  });

  it('says when nothing has been stored', async () => {
    renderApp('/datasheets', { datasheets: () => Promise.resolve({ datasheets: [] }) });
    await waitFor(() => {
      expect(screen.getByText('No datasheet has been stored yet.')).toBeInTheDocument();
    });
  });
});
