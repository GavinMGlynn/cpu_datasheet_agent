// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Page } from './Page.js';

describe('Page', () => {
  it('says what you are looking at', () => {
    renderAt(
      <Page
        title="Runs"
        subtitle="What the agent has done"
        actions={<button type="button">refresh</button>}
      >
        <p>The body</p>
      </Page>,
    );
    expect(screen.getByRole('heading', { name: 'Runs' })).toBeInTheDocument();
    expect(screen.getByText('What the agent has done')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'refresh' })).toBeInTheDocument();
    expect(screen.getByText('The body')).toBeInTheDocument();
  });

  it('works with nothing but a title', () => {
    renderAt(
      <Page title="Health">
        <p>body</p>
      </Page>,
    );
    expect(screen.getByRole('heading', { name: 'Health' })).toBeInTheDocument();
  });
});
