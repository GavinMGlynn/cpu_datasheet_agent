// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../../../../test/ui/render.js';

const answer = {
  result: {
    reference: { mpn: 'TPS54331DR' },
    alternates: [
      {
        part: { mpn: 'AP63203WU-7', manufacturer: 'Diodes Incorporated', status: 'verified' },
        price: { amount: 0.94, currency: 'AUD' },
        saving: 0.34,
        differences: [
          {
            key: 'vinMax',
            reference: { value: 28, unit: 'V' },
            candidate: { value: 32, unit: 'V' },
            same: false,
          },
          { key: 'package', reference: 'SOIC-8', candidate: 'SOIC-8', same: true },
        ],
        pinCompatibility: 'not_assessed',
      },
      {
        part: { mpn: 'LM5164DDAR', manufacturer: 'Texas Instruments', status: 'extracted' },
        price: null,
        saving: null,
        differences: [],
        pinCompatibility: 'not_assessed',
      },
    ],
    excluded: [{ mpn: 'TPS62130RGTR', reason: 'not verified' }],
    disclaimer: 'pin compatibility has not been assessed.',
  },
};

describe('finding an alternate', () => {
  it('asks nothing until a part is named', async () => {
    const alternates = vi.fn(() => Promise.resolve(answer));
    renderApp('/alternates', { alternates });
    await waitFor(() => {
      expect(screen.getByText(/name a part and the constraints/u)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'find alternates' })).toBeDisabled();
    expect(alternates).not.toHaveBeenCalled();
  });

  it('sends every constraint it was given', async () => {
    const alternates = vi.fn((_body: Record<string, unknown>) => Promise.resolve(answer));
    renderApp('/alternates', { alternates });
    await waitFor(() => {
      expect(screen.getByLabelText('part to replace')).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText('part to replace'), 'TPS54331DR');
    await userEvent.type(screen.getByLabelText('input range it must cover'), '8-28');
    await userEvent.type(screen.getByLabelText('output current, amps'), '2');
    await userEvent.selectOptions(screen.getByLabelText('output'), 'adjustable');
    await userEvent.clear(screen.getByLabelText('quantity'));
    await userEvent.type(screen.getByLabelText('quantity'), '100');
    await userEvent.click(screen.getByLabelText('include parts nothing has verified'));
    await userEvent.click(screen.getByRole('button', { name: 'find alternates' }));
    await waitFor(() => {
      expect(alternates).toHaveBeenCalledTimes(1);
    });
    expect(alternates.mock.calls[0]?.[0]).toMatchObject({
      mpn: 'TPS54331DR',
      vinRange: { unit: 'V', min: 8, max: 28 },
      ioutMin: { unit: 'A', value: 2 },
      outputType: 'adjustable',
      quantity: 100,
      includeUnverified: true,
    });
  });

  it('shows what differs, what it saves, and the disclaimer', async () => {
    renderApp('/alternates', { alternates: () => Promise.resolve(answer) });
    await userEvent.type(await screen.findByLabelText('part to replace'), 'TPS54331DR');
    await userEvent.click(screen.getByRole('button', { name: 'find alternates' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AP63203WU-7' })).toBeInTheDocument();
    });
    // Sub-dollar prices carry a third digit: a tenth of a cent is a real
    // difference at ten thousand parts.
    expect(screen.getByText('AUD 0.940')).toBeInTheDocument();
    expect(screen.getByText('34%', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('32 V')).toBeInTheDocument();
    expect(screen.queryByText('SOIC-8')).toBeNull();
    expect(screen.getByText('no price in this currency')).toBeInTheDocument();
    expect(screen.getByText('pin compatibility has not been assessed.')).toBeInTheDocument();
    expect(screen.getByText(/TPS62130RGTR \(not verified\)/u)).toBeInTheDocument();
  });

  it('says plainly when nothing meets the constraints', async () => {
    renderApp('/alternates', {
      alternates: () =>
        Promise.resolve({
          result: { ...answer.result, alternates: [], excluded: [] },
        }),
    });
    await userEvent.type(await screen.findByLabelText('part to replace'), 'TPS54331DR');
    await userEvent.click(screen.getByRole('button', { name: 'find alternates' }));
    await waitFor(() => {
      expect(screen.getByText(/nothing stored meets those constraints/u)).toBeInTheDocument();
    });
  });

  it('shows what the server said when the query is refused', async () => {
    renderApp('/alternates', {
      alternates: () => Promise.reject(new Error('no stored part NOTHING-1')),
    });
    await userEvent.type(await screen.findByLabelText('part to replace'), 'NOTHING-1');
    await userEvent.click(screen.getByRole('button', { name: 'find alternates' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('no stored part NOTHING-1');
    });
  });
});
