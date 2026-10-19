import type { ApiError } from '@finance/shared';

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Called on any 401 so the app can show the login page. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; keepalive?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, keepalive } = options;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      keepalive,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new RequestError(0, 'offline', 'Cannot reach the server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new RequestError(res.status, err.error ?? 'error', err.message ?? `Request failed (${res.status})`, err.details);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
