// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { ErrorBoundary } from './ErrorBoundary.js';

function Boom(props: { readonly explode: boolean }): ReactNode {
  if (props.explode) {
    throw new Error('cannot read properties of undefined');
  }
  return <p>the page</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders the page when it works', () => {
    renderAt(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  it('says what went wrong instead of blanking the screen', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderAt(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('this page could not be rendered');
    expect(screen.getByRole('alert')).toHaveTextContent('cannot read properties of undefined');
    expect(quiet).toHaveBeenCalled();
  });

  it('recovers when the address changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = renderAt(
      <ErrorBoundary resetKey="/broken">
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(
      <ErrorBoundary resetKey="/other">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  it('stays broken while the address is the same', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = renderAt(
      <ErrorBoundary resetKey="/broken">
        <Boom explode />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKey="/broken">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
