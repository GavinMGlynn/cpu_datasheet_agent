// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('says the state in words, with a colour beside it', () => {
    const { container } = renderAt(<Badge kind="partStatus" value="needs_human" />);
    expect(screen.getByText('Needs a person')).toBeInTheDocument();
    expect(container.querySelector('.dot')).not.toBeNull();
  });

  it('knows every table it was given', () => {
    renderAt(
      <>
        <Badge kind="verdict" value="Contradicted" />
        <Badge kind="runResult" value="Extracted" />
        <Badge kind="launchState" value="Running" />
        <Badge kind="confidence" value="In conflict" />
      </>,
    );
    expect(screen.getByText('Contradicted')).toBeInTheDocument();
    expect(screen.getByText('Extracted')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('In conflict')).toBeInTheDocument();
  });

  it('says a value it has no colour for, without one', () => {
    const { container } = renderAt(<Badge kind="partStatus" value="Invented" />);
    expect(screen.getByText('Invented')).toBeInTheDocument();
    expect(container.querySelector('.dot')).toBeNull();
  });

  it('says "Unknown" rather than nothing', () => {
    renderAt(<Badge kind="partStatus" value={undefined} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
