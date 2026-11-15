import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Rendered instead of the children after an error. */
  fallback: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  children: ReactNode;
  /** When this value changes, a caught error is cleared and the children are tried again. */
  resetKey?: unknown;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

/** Contains a failure (a missing image, a WebGL hiccup…) to one part of the page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    if (import.meta.env.DEV) console.warn('[ErrorBoundary]', error);
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      const { fallback } = this.props;
      return typeof fallback === 'function' ? fallback(error, this.reset) : fallback;
    }
    return this.props.children;
  }
}
