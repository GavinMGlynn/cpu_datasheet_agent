// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Checkbox, Select, TextField } from './Fields.js';

describe('Select', () => {
  it('labels itself and reports what was chosen', async () => {
    const onChange = vi.fn();
    renderAt(
      <Select
        label="status"
        value="extracted"
        options={[
          { value: 'extracted', label: 'extracted' },
          { value: 'verified', label: 'verified' },
        ]}
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('status'), 'verified');
    expect(onChange).toHaveBeenCalledWith('verified');
  });

  it('takes an id of its own where two share a label', () => {
    renderAt(
      <Select
        label="source"
        id="source-two"
        value="a"
        options={[{ value: 'a', label: 'a' }]}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText('source')).toHaveAttribute('id', 'source-two');
  });
});

describe('TextField', () => {
  it('reports what was typed', async () => {
    const onChange = vi.fn();
    renderAt(<TextField label="search" value="" onChange={onChange} placeholder="part number" />);
    await userEvent.type(screen.getByPlaceholderText('part number'), 'TP');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('takes numbers, and a longer answer', async () => {
    const onChange = vi.fn();
    renderAt(
      <>
        <TextField label="quantity" type="number" value="100" onChange={onChange} />
        <TextField label="why" value="" multiline onChange={onChange} id="why" />
      </>,
    );
    expect(screen.getByLabelText('quantity')).toHaveAttribute('type', 'number');
    await userEvent.type(screen.getByLabelText('why'), 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });
});

describe('Checkbox', () => {
  it('reports being ticked and unticked', async () => {
    const onChange = vi.fn();
    const { rerender } = renderAt(
      <Checkbox label="only failures" checked={false} onChange={onChange} />,
    );
    await userEvent.click(screen.getByLabelText('only failures'));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Checkbox label="only failures" checked id="own" onChange={onChange} />);
    await userEvent.click(screen.getByLabelText('only failures'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
