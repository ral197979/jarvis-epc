/**
 * Thin HTTP client for the existing Denver Engineering API.
 *
 * The whole app runs on mock adapters by default (`VITE_USE_MOCKS !== 'false'`),
 * so no backend is required to render every screen. To go live, set
 * `VITE_USE_MOCKS=false` and `VITE_API_BASE`, then flip the `USE_MOCKS` branch in
 * each adapter to call `api<T>()`. Auth/CSRF mirror the existing server contract:
 * httpOnly session cookie + `X-CSRF-Token` header (see api/server.ts requireCsrf).
 */

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1'
export const USE_MOCKS = (import.meta.env.VITE_USE_MOCKS as string | undefined) !== 'false'

function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith('csrf_token='))
    ?.split('=')[1]
}

export interface ApiOptions extends RequestInit {
  /** Tenant override; defaults to the active tenant cookie set by the server. */
  tenantId?: string
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { tenantId, headers, ...rest } = opts
  const token = csrfToken()
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-CSRF-Token': token } : {}),
      ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
      ...headers,
    },
    ...rest,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`API ${res.status} ${res.statusText} — ${path}${detail ? `: ${detail}` : ''}`)
  }
  return res.json() as Promise<T>
}

/** Simulate network latency for mock adapters so loading states are exercised. */
export function mock<T>(value: T, ms = 280): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}
