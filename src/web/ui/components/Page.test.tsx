// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Page } from './Page.js';

describe('Page', () => {
  it('says what you are looking at', () => {
    renderAt(
      <Page
        title="runs"
        subtitle="what the agent has done"
        actions={<button type="button">refresh</button>}
      >
        <p>the body</p>
      </Page>,
    );
    expect(screen.getByRole('heading', { name: 'runs' })).toBeInTheDocument();
    expect(screen.getByText('what the agent has done')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'refresh' })).toBeInTheDocument();
    expect(screen.getByText('the body')).toBeInTheDocument();
  });

  it('works with nothing but a title', () => {
    renderAt(
      <Page title="health">
        <p>body</p>
      </Page>,
    );
    expect(screen.getByRole('heading', { name: 'health' })).toBeInTheDocument();
  });
});
