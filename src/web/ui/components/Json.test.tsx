// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Json } from './Json.js';

describe('Json', () => {
  it('shows the value, formatted', () => {
    renderAt(<Json value={{ mpn: 'TPS54331DR' }} />);
    expect(screen.getByLabelText('json')).toHaveTextContent('"mpn": "TPS54331DR"');
  });

  it('takes a label, so a page can have two', () => {
    renderAt(<Json value={[1]} label="what went in" />);
    expect(screen.getByLabelText('what went in')).toBeInTheDocument();
  });
});
