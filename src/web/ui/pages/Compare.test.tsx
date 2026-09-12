// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';
import { parameterRow, summary } from '../../../../test/ui/fixtures.js';

const comparison = {
  parts: [
    {
      summary: summary(),
      parameters: [parameterRow(), parameterRow({ key: 'package', value: 'SOIC-8' })],
    },
    {
      summary: summary({ mpn: 'AP62200WU-7' }),
      parameters: [
        parameterRow({ value: { value: 18, unit: 'V' } }),
        parameterRow({ key: 'package', value: 'SOIC-8' }),
      ],
    },
  ],
  keys: ['vinMax', 'package'],
};

describe('comparing parts', () => {
  it('asks for nothing until it is given part numbers', async () => {
    const compare = vi.fn(() => Promise.resolve(comparison));
    renderApp('/compare', { compare });
    await waitFor(() => {
      expect(screen.getByText(/name some parts above/iu)).toBeInTheDocument();
    });
    expect(compare).not.toHaveBeenCalled();
  });

  it('puts the parts side by side and marks what differs', async () => {
    renderApp('/compare?mpns=TPS54331DR,AP62200WU-7', {
      compare: () => Promise.resolve(comparison),
    });
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'AP62200WU-7' })).toBeInTheDocument();
    });
    expect(screen.getByText('28 V')).toBeInTheDocument();
    expect(screen.getByText('18 V')).toBeInTheDocument();
    // The package is the same for both, so it is not emphasised.
    expect(screen.getAllByText('SOIC-8')).toHaveLength(2);
    expect(screen.getAllByRole('strong').length).toBeGreaterThan(0);
  });

  it('asks the server again when the list changes', async () => {
    const compare = vi.fn((_mpns: readonly string[]) => Promise.resolve(comparison));
    renderApp('/compare?mpns=TPS54331DR', { compare });
    await waitFor(() => {
      expect(compare).toHaveBeenCalledTimes(1);
    });
    await userEvent.type(screen.getByLabelText('Part numbers, comma separated'), ',AP62200WU-7');
    await waitFor(() => {
      expect(compare.mock.calls.at(-1)?.[0]).toStrictEqual(['TPS54331DR', 'AP62200WU-7']);
    });
  });
});
