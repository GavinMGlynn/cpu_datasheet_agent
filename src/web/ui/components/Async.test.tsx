// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { ApiError } from '../lib/api.js';
import { Async } from './Async.js';

describe('Async', () => {
  it('says what it is loading', () => {
    renderAt(
      <Async state={{ status: 'loading' }} label="the parts">
        {() => <p>never</p>}
      </Async>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('loading the parts');
  });

  it('loads without a label', () => {
    renderAt(<Async state={{ status: 'loading' }}>{() => <p>never</p>}</Async>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the code the server sent', () => {
    renderAt(
      <Async
        state={{ status: 'failed', error: new ApiError(404, 'WEB_PART_NOT_FOUND', 'no such part') }}
      >
        {() => <p>never</p>}
      </Async>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('WEB_PART_NOT_FOUND');
    expect(screen.getByRole('alert')).toHaveTextContent('no such part');
  });

  it('shows an ordinary error plainly', () => {
    renderAt(
      <Async state={{ status: 'failed', error: new Error('the network went away') }}>
        {() => <p>never</p>}
      </Async>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('the network went away');
  });

  it('renders what it loaded', () => {
    renderAt(
      <Async state={{ status: 'loaded', value: 7 }}>{(value) => <p>{value} parts</p>}</Async>,
    );
    expect(screen.getByText('7 parts')).toBeInTheDocument();
  });
});
