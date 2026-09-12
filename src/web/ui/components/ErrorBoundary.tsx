import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The last line of defence.
 *
 * `Async` catches a request that failed; this catches a page that could not
 * render what came back — a payload of the wrong shape, a value nobody
 * expected. Without it React unmounts the whole tree and the person is left
 * looking at a blank page with no idea why.
 */

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Changing this resets the boundary, so navigating away from a broken page works. */
  readonly resetKey?: string;
}

interface ErrorBoundaryState {
  readonly error: Error | undefined;
  readonly resetKey: string | undefined;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: undefined, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Pick<ErrorBoundaryState, 'error'> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): ErrorBoundaryState | null {
    return props.resetKey === state.resetKey
      ? null
      : { error: undefined, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing else records this, and a page that broke once will break again:
    // the console is where a person looks, and the stack is the useful part.
    globalThis.console.error('this page could not be rendered', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) {
      return this.props.children;
    }
    return (
      <div className="failed" role="alert">
        <strong>This page could not be rendered.</strong> {error.message}
        <p className="caption">
          the data behind it is not the shape this page expects. the server's own answer is in the
          browser console.
        </p>
      </div>
    );
  }
}
