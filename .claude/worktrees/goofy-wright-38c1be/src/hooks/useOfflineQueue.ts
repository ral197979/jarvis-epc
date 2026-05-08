import { useState, useEffect, useCallback } from 'react'

interface QueuedMutation {
  id: string
  url: string
  method: string
  body: string
  headers: Record<string, string>
  queuedAt: number
}

const DB_NAME = 'jarvis-offline'
const STORE_NAME = 'mutation-queue'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function enqueue(mutation: QueuedMutation): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).add(mutation)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function dequeueAll(): Promise<QueuedMutation[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => { store.clear(); resolve(req.result) }
    req.onerror = () => reject(req.error)
  })
}

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [queueLength, setQueueLength] = useState(0)
  const [replaying, setReplaying] = useState(false)

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine) return
    setReplaying(true)
    try {
      const mutations = await dequeueAll()
      setQueueLength(0)
      for (const m of mutations) {
        try {
          await fetch(m.url, { method: m.method, headers: m.headers, body: m.body })
        } catch {
          await enqueue(m)
          setQueueLength(q => q + 1)
        }
      }
    } finally {
      setReplaying(false)
    }
  }, [])

  useEffect(() => {
    const onOnline = () => { setIsOnline(true); syncQueue() }
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [syncQueue])

  const queueMutation = useCallback(async (url: string, method: string, body: unknown, headers: Record<string, string> = {}) => {
    const mutation: QueuedMutation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url, method,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...headers },
      queuedAt: Date.now(),
    }
    await enqueue(mutation)
    setQueueLength(q => q + 1)
  }, [])

  return { isOnline, queueLength, replaying, queueMutation, syncQueue }
}
