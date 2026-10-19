/**
 * The engine's HTTP client, pointed at the in-extension router.
 *
 * The engine's `api-client` spoke to a Fastify server over `fetch`. The Mochi OS
 * view calls `api.get/post/...` directly, so the port keeps that call shape and
 * hands the request to `st/api`, which serves it from SillyTavern.
 */
import { ApiError, request } from '../st/api';

export { ApiError };

export interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function withQuery(path: string, params?: RequestOptions['params']): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  if (!query) return path;
  return path.includes('?') ? `${path}&${query}` : `${path}?${query}`;
}

export const api = {
  get: <T = unknown>(path: string, options?: RequestOptions): Promise<T> =>
    request('GET', withQuery(path, options?.params)) as Promise<T>,
  post: <T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request('POST', path, body, options) as Promise<T>,
  put: <T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request('PUT', path, body, options) as Promise<T>,
  patch: <T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request('PATCH', path, body, options) as Promise<T>,
  delete: <T = unknown>(path: string, options?: RequestOptions): Promise<T> =>
    request('DELETE', withQuery(path, options?.params), undefined, options) as Promise<T>,
};

export default api;
