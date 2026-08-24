import { ProviderError } from "./types.ts";

export type RetryOptions = {
  attempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  signal?: AbortSignal;
  remainingMs?: () => number;
};

export function abortableSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new ProviderError("timeout", true));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    function finish() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(new ProviderError("timeout", true));
    }
  });
}
export async function withRetry<T>(
  operation: (signal: AbortSignal, attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3,
    timeoutMs = options.timeoutMs ?? 10_000,
    base = options.baseDelayMs ?? 250,
    cap = options.maxDelayMs ?? 5_000;
  const sleep = options.sleep ?? abortableSleep,
    random = options.random ?? Math.random;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) throw new ProviderError("timeout", true);
    const remaining = options.remainingMs?.() ?? Number.POSITIVE_INFINITY;
    if (remaining <= 0) throw new ProviderError("timeout", true);
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(timeoutMs, remaining),
    );
    try {
      return await operation(controller.signal, attempt);
    } catch (error) {
      last = controller.signal.aborted && !(error instanceof ProviderError)
        ? new ProviderError("timeout", true)
        : error;
      if (
        !(last instanceof ProviderError) ||
        !last.retryable ||
        attempt === attempts
      ) {
        throw last;
      }
      const exponential = Math.min(cap, base * 2 ** (attempt - 1));
      const delay = Math.min(
        cap,
        last.retryAfterMs ?? exponential * (0.5 + random() * 0.5),
      );
      const remainingAfterAttempt = options.remainingMs?.() ??
        Number.POSITIVE_INFINITY;
      if (delay >= remainingAfterAttempt) {
        throw new ProviderError("timeout", true);
      }
      await sleep(delay, options.signal ?? controller.signal);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  throw last;
}
