// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Stat, Stats } from './Stat.js';

describe('Stat', () => {
  it('leads with the number and explains it underneath', () => {
    renderAt(<Stat label="spent" value="$87.24" note="22 parts" />);
    expect(screen.getByText('spent')).toBeInTheDocument();
    expect(screen.getByText('$87.24')).toBeInTheDocument();
    expect(screen.getByText('22 parts')).toBeInTheDocument();
  });

  it('works with nothing to add', () => {
    renderAt(<Stat label="parts" value="22" />);
    expect(screen.getByText('22')).toBeInTheDocument();
  });

  it('lays a row of them out together', () => {
    const { container } = renderAt(
      <Stats>
        <Stat label="a" value="1" />
        <Stat label="b" value="2" />
      </Stats>,
    );
    expect(container.querySelectorAll('.card')).toHaveLength(2);
  });
});
