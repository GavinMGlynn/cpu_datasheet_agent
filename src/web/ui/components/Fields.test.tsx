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
        label="Status"
        value="Extracted"
        options={[
          { value: 'Extracted', label: 'Extracted' },
          { value: 'Verified', label: 'Verified' },
        ]}
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Verified');
    expect(onChange).toHaveBeenCalledWith('Verified');
  });

  it('takes an id of its own where two share a label', () => {
    renderAt(
      <Select
        label="Source"
        id="source-two"
        value="a"
        options={[{ value: 'a', label: 'a' }]}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByLabelText('Source')).toHaveAttribute('id', 'source-two');
  });
});

describe('TextField', () => {
  it('reports what was typed', async () => {
    const onChange = vi.fn();
    renderAt(<TextField label="Search" value="" onChange={onChange} placeholder="Part number" />);
    await userEvent.type(screen.getByPlaceholderText('Part number'), 'TP');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('takes numbers, and a longer answer', async () => {
    const onChange = vi.fn();
    renderAt(
      <>
        <TextField label="Quantity" type="number" value="100" onChange={onChange} />
        <TextField label="Why" value="" multiline onChange={onChange} id="why" />
      </>,
    );
    expect(screen.getByLabelText('Quantity')).toHaveAttribute('type', 'number');
    await userEvent.type(screen.getByLabelText('Why'), 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });
});

describe('Checkbox', () => {
  it('reports being ticked and unticked', async () => {
    const onChange = vi.fn();
    const { rerender } = renderAt(
      <Checkbox label="Only failures" checked={false} onChange={onChange} />,
    );
    await userEvent.click(screen.getByLabelText('Only failures'));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Checkbox label="Only failures" checked id="own" onChange={onChange} />);
    await userEvent.click(screen.getByLabelText('Only failures'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
