// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('says the state in words, with a colour beside it', () => {
    const { container } = renderAt(<Badge kind="partStatus" value="needs_human" />);
    expect(screen.getByText('needs human')).toBeInTheDocument();
    expect(container.querySelector('.dot')).not.toBeNull();
  });

  it('knows every table it was given', () => {
    renderAt(
      <>
        <Badge kind="verdict" value="contradicted" />
        <Badge kind="runResult" value="extracted" />
        <Badge kind="launchState" value="running" />
        <Badge kind="confidence" value="conflict" />
      </>,
    );
    expect(screen.getByText('contradicted')).toBeInTheDocument();
    expect(screen.getByText('extracted')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('conflict')).toBeInTheDocument();
  });

  it('says a value it has no colour for, without one', () => {
    const { container } = renderAt(<Badge kind="partStatus" value="invented" />);
    expect(screen.getByText('invented')).toBeInTheDocument();
    expect(container.querySelector('.dot')).toBeNull();
  });

  it('says "unknown" rather than nothing', () => {
    renderAt(<Badge kind="partStatus" value={undefined} />);
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});
