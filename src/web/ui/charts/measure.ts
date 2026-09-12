import { useEffect, useRef, useState } from 'react';

/**
 * The width a chart has to draw in.
 *
 * Recharts can measure for itself, but its container needs a `ResizeObserver`
 * and produces a chart whose size is unknown until layout has run — which is
 * neither testable nor deterministic. This measures once, listens if the
 * browser can, and otherwise hands back a sensible width so the chart renders
 * the same way every time.
 */

export const DEFAULT_CHART_WIDTH = 720;

export interface Measured<T extends Element> {
  readonly ref: React.RefObject<T | null>;
  readonly width: number;
}

export function useWidth<T extends Element>(fallback = DEFAULT_CHART_WIDTH): Measured<T> {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const measure = (): void => {
      const measured = element.getBoundingClientRect().width;
      setWidth(measured > 0 ? Math.round(measured) : fallback);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      // jsdom, and any browser old enough not to have it: the fallback width
      // is what the chart draws at, which is exactly what a test wants.
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [fallback]);

  return { ref, width };
}
