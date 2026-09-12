// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Provenance } from './Provenance.js';

describe('Provenance', () => {
  it('offers the page a datasheet value was read from', async () => {
    const onOpenPage = vi.fn();
    renderAt(
      <Provenance
        provenance={{ source: 'datasheet', page: 4, sha256: 'a', quote: 'Input voltage range' }}
        onOpenPage={onOpenPage}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'page 4' }));
    expect(onOpenPage).toHaveBeenCalledWith(4);
  });

  it('states the page without offering it where nothing can open it', () => {
    renderAt(<Provenance provenance={{ source: 'datasheet', page: 7 }} />);
    expect(screen.getByText('page 7')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the distributor, the person, or the rule', () => {
    renderAt(
      <>
        <Provenance provenance={{ source: 'distributor', distributor: 'digikey' }} />
        <Provenance provenance={{ source: 'human', note: 'read the ordering table' }} />
        <Provenance provenance={{ source: 'derived', rule: 'feedback-accuracy.v1' }} />
      </>,
    );
    expect(screen.getByText('digikey')).toBeInTheDocument();
    expect(screen.getByText('by hand')).toBeInTheDocument();
    expect(screen.getByText('derived')).toBeInTheDocument();
  });

  it('copes with a distributor value that names no distributor', () => {
    renderAt(<Provenance provenance={{ source: 'distributor' }} />);
    expect(screen.getByText('distributor')).toBeInTheDocument();
  });

  it('copes with a human or derived value that carries no note', () => {
    renderAt(
      <>
        <Provenance provenance={{ source: 'human' }} />
        <Provenance provenance={{ source: 'derived' }} />
      </>,
    );
    expect(screen.getByText('by hand')).toBeInTheDocument();
    expect(screen.getByText('derived')).toBeInTheDocument();
  });

  it('treats a datasheet value with no page as not a citation', () => {
    renderAt(<Provenance provenance={{ source: 'datasheet' }} />);
    expect(screen.getByText('derived')).toBeInTheDocument();
  });
});
