/** Reject when `promise` does not settle within `ms`. Does not cancel the underlying work. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Resolve to `fallback` instead of throwing when the race times out. */
export async function withTimeoutFallback<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  label = 'operation',
): Promise<T> {
  try {
    return await withTimeout(promise, ms, label);
  } catch {
    return fallback;
  }
}

export type TimedResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'timeout' }
  | { status: 'error'; error: unknown };

/** Distinguish timeout vs error vs success — callers must not treat timeout as "missing". */
export async function withTimedResult<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<TimedResult<T>> {
  try {
    return { status: 'ok', value: await withTimeout(promise, ms, label) };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('timeout after')) return { status: 'timeout' };
    return { status: 'error', error };
  }
}
