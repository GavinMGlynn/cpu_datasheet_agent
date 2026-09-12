// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';
import type { AuditEvent } from '../lib/types.js';

const correction: AuditEvent = {
  id: '00000000-0000-4000-9000-000000000001',
  at: '2026-09-12T00:00:00Z',
  actor: 'gavin',
  action: 'parameter.correct',
  targetKind: 'Parameter',
  targetId: 'TPS54331DR:vinMax',
  reason: 'The ordering table on page 2 says 28 V',
  before: { value: 30, unit: 'V' },
  after: { value: 28, unit: 'V' },
};

const purge: AuditEvent = {
  ...correction,
  id: '00000000-0000-4000-9000-000000000002',
  action: 'cache.purge',
  targetKind: 'cache',
  targetId: 'pdf_text/aaa',
  before: undefined,
  after: undefined,
};

describe('the audit trail', () => {
  it('shows who changed what, why, and what it replaced', async () => {
    renderApp('/audit', {
      audit: () => Promise.resolve({ total: 2, offset: 0, limit: 200, items: [correction, purge] }),
    });
    await waitFor(() => {
      expect(screen.getByText('2 changes')).toBeInTheDocument();
    });
    expect(screen.getByText('parameter.correct')).toBeInTheDocument();
    // Both fixtures carry the same reason.
    expect(screen.getAllByText('The ordering table on page 2 says 28 V')).toHaveLength(2);
    expect(screen.getByLabelText('Before')).toHaveTextContent('30');
    expect(screen.getByLabelText('After')).toHaveTextContent('28');
    // The purge replaced nothing and left nothing.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('narrows to one kind of change', async () => {
    const audit = vi.fn((_options: { targetKind?: string }) =>
      Promise.resolve({ total: 1, offset: 0, limit: 200, items: [correction] }),
    );
    renderApp('/audit', { audit });
    await waitFor(() => {
      expect(audit.mock.calls[0]?.[0]).not.toHaveProperty('targetKind');
    });
    await userEvent.selectOptions(screen.getByLabelText('What was changed'), 'cache');
    await waitFor(() => {
      expect(audit.mock.calls.at(-1)?.[0]).toMatchObject({ targetKind: 'cache' });
    });
  });

  it('says when nothing has been changed by hand', async () => {
    renderApp('/audit', {
      audit: () => Promise.resolve({ total: 0, offset: 0, limit: 200, items: [] }),
    });
    await waitFor(() => {
      expect(
        screen.getByText('Nothing has been changed by hand in this database.'),
      ).toBeInTheDocument();
    });
  });
});
