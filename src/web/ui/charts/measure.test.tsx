// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderAt } from '../../../../test/ui/render.js';
import { DEFAULT_CHART_WIDTH, useWidth } from './measure.js';

/** A component whose only job is to report the width the hook gave it. */
function Probe(props: { readonly fallback?: number }): ReactNode {
  const { ref, width } = useWidth<HTMLDivElement>(props.fallback);
  return (
    <div ref={ref} data-testid="probe">
      {width}
    </div>
  );
}

function widthOf(): number {
  return Number(screen.getByTestId('probe').textContent);
}

/** jsdom measures everything as zero; this says what the element is worth. */
function measuring(width: number): () => void {
  const property = 'getBoundingClientRect';
  const original = Object.getOwnPropertyDescriptor(Element.prototype, property);
  const rect = (): DOMRect => ({
    width,
    height: 100,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 100,
    toJSON: () => ({}),
  });
  Object.defineProperty(Element.prototype, property, { value: rect, configurable: true });
  return () => {
    if (original !== undefined) {
      Object.defineProperty(Element.prototype, property, original);
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useWidth', () => {
  it('falls back to a width a chart can be drawn at', () => {
    renderAt(<Probe />);
    expect(widthOf()).toBe(DEFAULT_CHART_WIDTH);
  });

  it('takes the fallback it is given', () => {
    renderAt(<Probe fallback={320} />);
    expect(widthOf()).toBe(320);
  });

  it('measures the element it was attached to', () => {
    const restore = measuring(640);
    try {
      renderAt(<Probe />);
      expect(widthOf()).toBe(640);
    } finally {
      restore();
    }
  });

  it('keeps the fallback where the element has no width yet', () => {
    const restore = measuring(0);
    try {
      renderAt(<Probe fallback={256} />);
      expect(widthOf()).toBe(256);
    } finally {
      restore();
    }
  });

  it('does nothing where the ref was never attached to anything', () => {
    function Unattached(): ReactNode {
      const { width } = useWidth<HTMLDivElement>(200);
      return <div data-testid="probe">{width}</div>;
    }
    renderAt(<Unattached />);
    expect(widthOf()).toBe(200);
  });

  it('watches for resizes where the browser can, and stops when it goes away', () => {
    const observed: Element[] = [];
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(private readonly callback: () => void) {}
      observe(element: Element): void {
        observed.push(element);
        this.callback();
      }
      disconnect = disconnect;
      unobserve = (): void => undefined;
    }
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const restore = measuring(480);
    try {
      const { unmount } = renderAt(<Probe />);
      expect(observed).toHaveLength(1);
      expect(widthOf()).toBe(480);
      unmount();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
