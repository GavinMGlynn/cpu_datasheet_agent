// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Time } from './Time.js';

const now = new Date('2026-09-12T09:00:00Z');

describe('Time', () => {
  it('says how long ago, and exactly when on hover', () => {
    renderAt(<Time value="2026-09-11T09:00:00Z" now={now} />);
    const time = screen.getByText('yesterday');
    expect(time).toHaveAttribute('datetime', '2026-09-11T09:00:00Z');
    // The tooltip is the same instant in the reader's own time zone, which is
    // the thing the ledger's UTC cannot tell them.
    expect(time.getAttribute('title')).toMatch(/2026/u);
    expect(time.getAttribute('title')).toMatch(/September/u);
  });

  it('shows a dash where there is no time at all', () => {
    const { container } = renderAt(<Time value={undefined} />);
    expect(container.textContent).toBe('—');
    expect(container.querySelector('time')).toBeNull();
  });

  it('shows a dash for a value that is there but empty', () => {
    const { container } = renderAt(<Time value="" />);
    expect(container.textContent).toBe('—');
  });

  it('shows a dash where the field is null', () => {
    const { container } = renderAt(<Time value={null} />);
    expect(container.textContent).toBe('—');
  });

  it('reads the clock when nothing fixes it', () => {
    renderAt(<Time value={new Date().toISOString()} />);
    expect(screen.getByText('just now')).toBeInTheDocument();
  });
});
