// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { HeatMap } from './HeatMap.js';

const cells = [
  { row: 'vinMax', column: 'found', value: 22, title: 'vinMax: stated for 22 of 22 parts' },
  { row: 'vinMax', column: 'cited', value: 22, title: 'vinMax: cites a page for 22 parts' },
  { row: 'maxDutyCycle', column: 'found', value: 10, title: 'maxDutyCycle: stated for 10 parts' },
  { row: 'maxDutyCycle', column: 'cited', value: 22, title: 'maxDutyCycle: cites a page for 22' },
];

describe('HeatMap', () => {
  it('draws a cell per row and column, with the number in it', () => {
    const { container } = renderAt(
      <HeatMap
        title="parameters by parts"
        caption="how much of the schema gets filled in"
        rows={['vinMax', 'maxDutyCycle']}
        columns={['found', 'cited']}
        cells={cells}
      />,
    );
    expect(screen.getByRole('img', { name: 'parameters by parts' })).toBeInTheDocument();
    expect(screen.getByText('how much of the schema gets filled in')).toBeInTheDocument();
    expect(container.querySelectorAll('rect')).toHaveLength(4);
    expect(screen.getAllByText('22')).toHaveLength(3);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('says what a cell means when the pointer is over it', () => {
    const { container } = renderAt(
      <HeatMap rows={['vinMax']} columns={['found']} cells={cells} title="coverage" />,
    );
    const cell = container.querySelector('rect');
    expect(cell).not.toBeNull();
    // The <title> inside the cell says the same thing for a pointer that
    // hovers without moving; this is the line under the grid.
    const live = (): string => container.querySelector('[aria-live]')?.textContent ?? '';
    fireEvent.mouseEnter(cell as Element);
    expect(live()).toBe('vinMax: stated for 22 of 22 parts');
    fireEvent.mouseLeave(cell as Element);
    expect(live().trim()).toBe('');
  });

  it('draws an empty cell where the grid has a hole', () => {
    renderAt(
      <HeatMap
        title="coverage"
        rows={['vinMax']}
        columns={['found', 'never measured']}
        cells={[{ row: 'vinMax', column: 'found', value: 22, title: 'vinMax: 22 of 22' }]}
      />,
    );
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('formats the numbers when asked', () => {
    renderAt(
      <HeatMap
        title="coverage"
        rows={['vinMax']}
        columns={['found']}
        cells={cells}
        format={(value) => `${String(value)} parts`}
      />,
    );
    expect(screen.getByText('22 parts')).toBeInTheDocument();
  });

  it('colours against the maximum it is given rather than the largest cell', () => {
    const { container } = renderAt(
      <HeatMap title="coverage" rows={['vinMax']} columns={['found']} cells={cells} max={44} />,
    );
    // 22 of 44 is halfway along the ramp rather than at its end.
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe('#3987e5');
  });

  it('copes with a grid where every value is zero', () => {
    const { container } = renderAt(
      <HeatMap
        title="coverage"
        rows={['vinMax']}
        columns={['found']}
        cells={[{ row: 'vinMax', column: 'found', value: 0, title: 'nothing' }]}
      />,
    );
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe('#cde2fb');
  });

  it('says when there is nothing stored at all', () => {
    renderAt(<HeatMap title="coverage" rows={[]} columns={['found']} cells={[]} />);
    expect(screen.getByText('nothing stored yet')).toBeInTheDocument();
  });
});
