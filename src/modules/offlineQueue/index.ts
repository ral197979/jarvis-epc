/**
 * Denver Engineering — Offline Mutation Queue  (v4.31.0)
 * ────────────────────────────────────────────────
 * IndexedDB-backed queue for offline-captured field mutations.
 * Pairs with the server's /api/v1/field-sync/batch endpoint:
 *
 *   1. UI captures a mutation → enqueue() writes it to IndexedDB with
 *      a fresh client_op_id and status='pending'
 *   2. If online, flush() runs immediately. Offline, the item waits.
 *   3. On 'online' event (or SW message), flush() drains the queue
 *      by POSTing a batch. Each op's status updates per result.
 *   4. Ops that returned status='conflict' or 'error' stay in the
 *      store with that flag so the UI can surface them for resolution.
 *
 * Dependency-free — uses the native IndexedDB API, no Dexie/idb.
 */

export type QueuedOpStatus = 'pending' | 'synced' | 'conflict' | 'failed'

export interface QueuedOp {
  client_op_id:    string                 // primary key
  resource:        string                 // 'action_items' | 'daily_logs' | ...
  op:              'create' | 'update'
  data:            Record<string, unknown>
  id?:             string                 // for updates
  base_updated_at?: string                 // for updates (optimistic lock)
  queued_at:       number                 // epoch ms
  synced_at?:      number
  attempts:        number
  status:          QueuedOpStatus
  server_resource_id?: string
  server_response?:    Record<string, unknown>
  error?:          string
}

export interface EnqueueInput {
  resource:        string
  op:              'create' | 'update'
  data:            Record<string, unknown>
  id?:             string
  base_updated_at?: string
}

const DB_NAME    = 'jarvis-offline'
const DB_VERSION = 1
const STORE      = 'field_sync_queue'

// ─── IndexedDB plumbing ───────────────────────────────────────────────────────

let _dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'client_op_id' })
        store.createIndex('by_status', 'status', { unique: false })
        store.createIndex('by_resource', 'resource', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
  return _dbPromise
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDb().then(db => {
    const t = db.transaction(STORE, mode)
    return t.objectStore(STORE)
  })
}

function promisifyReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// UUID-v4-ish generator (no external lib). Good enough for op ids.
function uuid(): string {
  const s = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : (function fallback() {
        const b = new Uint8Array(16)
        ;(typeof crypto !== 'undefined' ? crypto : { getRandomValues: (x: Uint8Array) => {
          for (let i = 0; i < x.length; i++) x[i] = Math.floor(Math.random() * 256)
          return x
        }}).getRandomValues(b)
        b[6] = (b[6] & 0x0f) | 0x40
        b[8] = (b[8] & 0x3f) | 0x80
        const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
      })()
  return s
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Queue a mutation. If the caller is online, kick a flush in the
 * background — the returned promise resolves when the item is
 * persisted locally, not when the server ack'd it.
 */
export async function enqueue(input: EnqueueInput): Promise<QueuedOp> {
  const row: QueuedOp = {
    client_op_id:    uuid(),
    resource:        input.resource,
    op:              input.op,
    data:            input.data,
    ...(input.id ? { id: input.id } : {}),
    ...(input.base_updated_at ? { base_updated_at: input.base_updated_at } : {}),
    queued_at:       Date.now(),
    attempts:        0,
    status:          'pending',
  }
  const store = await tx('readwrite')
  await promisifyReq(store.add(row))

  // Fire-and-forget flush when online — non-blocking.
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    flush().catch(() => {})
  }
  return row
}

/** All ops, regardless of status. UI typically filters by status. */
export async function all(): Promise<QueuedOp[]> {
  const store = await tx('readonly')
  return promisifyReq(store.getAll() as IDBRequest<QueuedOp[]>)
}

export async function pending(): Promise<QueuedOp[]> {
  const store = await tx('readonly')
  const ix = store.index('by_status')
  return promisifyReq(ix.getAll(IDBKeyRange.only('pending')) as IDBRequest<QueuedOp[]>)
}

export async function byStatus(status: QueuedOpStatus): Promise<QueuedOp[]> {
  const store = await tx('readonly')
  const ix = store.index('by_status')
  return promisifyReq(ix.getAll(IDBKeyRange.only(status)) as IDBRequest<QueuedOp[]>)
}

export async function remove(clientOpId: string): Promise<void> {
  const store = await tx('readwrite')
  await promisifyReq(store.delete(clientOpId))
}

/** Reset a failed/conflict item back to pending so the next flush retries. */
export async function requeue(clientOpId: string): Promise<void> {
  const store = await tx('readwrite')
  const existing = await promisifyReq(store.get(clientOpId) as IDBRequest<QueuedOp | undefined>)
  if (!existing) return
  await promisifyReq(store.put({ ...existing, status: 'pending', error: undefined }))
}

// ─── Flush ────────────────────────────────────────────────────────────────────

interface FlushResult {
  attempted: number
  succeeded: number
  conflicts: number
  failed:    number
}

let _flushInFlight: Promise<FlushResult> | null = null

/**
 * Send all pending ops to /api/v1/field-sync/batch. Idempotent and
 * safe to call concurrently — the in-flight promise is shared.
 * Server's client_op_id deduping means accidental double-flush is harmless.
 */
export async function flush(): Promise<FlushResult> {
  if (_flushInFlight) return _flushInFlight
  _flushInFlight = _doFlush().finally(() => { _flushInFlight = null })
  return _flushInFlight
}

async function _doFlush(): Promise<FlushResult> {
  const result: FlushResult = { attempted: 0, succeeded: 0, conflicts: 0, failed: 0 }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return result

  const items = await pending()
  if (items.length === 0) return result
  result.attempted = items.length

  const token = getToken()
  if (!token) return result

  // Server accepts up to 100 per batch; chunk larger queues.
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100)
    try {
      const res = await fetch('/api/v1/field-sync/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          operations: chunk.map(it => ({
            client_op_id: it.client_op_id,
            resource:     it.resource,
            op:           it.op,
            data:         it.data,
            ...(it.id ? { id: it.id } : {}),
            ...(it.base_updated_at ? { base_updated_at: it.base_updated_at } : {}),
          })),
        }),
      })
      if (!res.ok) {
        // Transport-level failure: mark attempts and move on (next flush retries)
        for (const it of chunk) await _bumpAttempt(it.client_op_id)
        result.failed += chunk.length
        continue
      }
      const body = await res.json() as {
        results: Array<{
          client_op_id: string
          status: 'success' | 'conflict' | 'error' | 'replay'
          resource_id?: string
          resource?: Record<string, unknown>
          current?: Record<string, unknown>
          error?: string
        }>
      }
      for (const r of body.results) {
        if (r.status === 'success' || r.status === 'replay') {
          await _markSynced(r.client_op_id, r.resource_id, r.resource)
          result.succeeded++
        } else if (r.status === 'conflict') {
          await _markConflict(r.client_op_id, r.current)
          result.conflicts++
        } else {
          await _markFailed(r.client_op_id, r.error ?? 'unknown error')
          result.failed++
        }
      }
    } catch {
      for (const it of chunk) await _bumpAttempt(it.client_op_id)
      result.failed += chunk.length
    }
  }
  return result
}

async function _markSynced(id: string, serverId?: string, resource?: Record<string, unknown>): Promise<void> {
  const store = await tx('readwrite')
  const existing = await promisifyReq(store.get(id) as IDBRequest<QueuedOp | undefined>)
  if (!existing) return
  await promisifyReq(store.put({
    ...existing, status: 'synced', synced_at: Date.now(),
    ...(serverId ? { server_resource_id: serverId } : {}),
    ...(resource ? { server_response: resource } : {}),
    attempts: existing.attempts + 1,
  }))
}

async function _markConflict(id: string, current?: Record<string, unknown>): Promise<void> {
  const store = await tx('readwrite')
  const existing = await promisifyReq(store.get(id) as IDBRequest<QueuedOp | undefined>)
  if (!existing) return
  await promisifyReq(store.put({
    ...existing, status: 'conflict',
    ...(current ? { server_response: current } : {}),
    attempts: existing.attempts + 1,
  }))
}

async function _markFailed(id: string, err: string): Promise<void> {
  const store = await tx('readwrite')
  const existing = await promisifyReq(store.get(id) as IDBRequest<QueuedOp | undefined>)
  if (!existing) return
  await promisifyReq(store.put({
    ...existing, status: 'failed', error: err,
    attempts: existing.attempts + 1,
  }))
}

async function _bumpAttempt(id: string): Promise<void> {
  const store = await tx('readwrite')
  const existing = await promisifyReq(store.get(id) as IDBRequest<QueuedOp | undefined>)
  if (!existing) return
  await promisifyReq(store.put({ ...existing, attempts: existing.attempts + 1 }))
}

function getToken(): string {
  try { return localStorage.getItem('jarvis_token') ?? '' } catch { return '' }
}

// ─── Auto-flush triggers ──────────────────────────────────────────────────────

/**
 * Install browser listeners that auto-flush on online events and on
 * service-worker nudges. Call once at app boot (in main.jsx/tsx).
 */
export function installAutoFlush(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => { flush().catch(() => {}) })
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'jarvis-online') flush().catch(() => {})
    })
  }
  // Kick an initial flush in case the app boot caught pending items
  // left over from a prior session.
  flush().catch(() => {})
}

// ─── Test-only hooks ──────────────────────────────────────────────────────────

export const __testHooks = {
  resetDb: () => { _dbPromise = null },
  uuid,
}
