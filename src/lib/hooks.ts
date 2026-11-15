import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Refetch, keeping the current data on screen while it loads. */
  reload: () => void;
  /** Replace the data locally (e.g. after a mutation returned the new value). */
  setData: (data: T) => void;
}

/**
 * Runs an async loader when `deps` change, with cancellation. When the deps change the old data is
 * dropped (it belongs to something else); `reload()` refreshes in the background instead.
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  const lastDeps = useRef<DependencyList | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const controller = new AbortController();
    const depsChanged =
      !lastDeps.current || lastDeps.current.length !== deps.length || lastDeps.current.some((d, i) => !Object.is(d, deps[i]));
    lastDeps.current = deps;
    setState((s) => ({ data: depsChanged ? null : s.data, error: null, loading: true }));
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, error: null, loading: false });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState((s) => ({ data: s.data, error, loading: false }));
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((data: T) => setState({ data, error: null, loading: false }), []);
  return { ...state, reload, setData };
}

/** The current time, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Calls `fn` every `intervalMs` while the page is visible (pauses in background tabs). */
export function useInterval(fn: () => void, intervalMs: number | null): void {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (intervalMs === null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') saved.current();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
