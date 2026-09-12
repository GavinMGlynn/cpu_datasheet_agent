// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { Dialog } from './Dialog.js';

function dialog(overrides: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  renderAt(
    <Dialog
      title="This will spend money"
      confirmLabel="Start the run"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    >
      <p>About $4.27</p>
    </Dialog>,
  );
  return { onConfirm, onCancel };
}

describe('Dialog', () => {
  it('asks the question and offers both answers', () => {
    dialog();
    expect(screen.getByRole('dialog', { name: 'This will spend money' })).toBeInTheDocument();
    expect(screen.getByText('About $4.27')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start the run' })).toBeEnabled();
  });

  it('confirms and cancels', async () => {
    const { onConfirm, onCancel } = dialog();
    await userEvent.click(screen.getByRole('button', { name: 'Start the run' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('takes escape as no', async () => {
    const { onCancel } = dialog();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores any other key', async () => {
    const { onCancel } = dialog();
    await userEvent.keyboard('{Enter}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('will not be confirmed twice while it is working', () => {
    dialog({ busy: true });
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
  });

  it('refuses to confirm until the form is filled in', () => {
    dialog({ confirmDisabled: true });
    expect(screen.getByRole('button', { name: 'Start the run' })).toBeDisabled();
  });

  it('stops listening for escape once it is gone', async () => {
    const onCancel = vi.fn();
    const { unmount } = renderAt(
      <Dialog title="x" confirmLabel="y" onConfirm={() => undefined} onCancel={onCancel}>
        <p>body</p>
      </Dialog>,
    );
    unmount();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('is a viewer when there is nothing to agree to', async () => {
    const onCancel = vi.fn();
    renderAt(
      <Dialog wide title="Page 4 of 40" onCancel={onCancel}>
        <p>the page</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toHaveClass('dialog', 'wide');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
