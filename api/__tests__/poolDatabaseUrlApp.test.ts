/**
 * AUDIT-P0-06 regression — DATABASE_URL_APP must fail closed in production.
 *
 * Before this fix, an unset DATABASE_URL_APP silently fell back to the
 * owner-privileged pool for every tenantQuery()/tenantTransaction() call,
 * which PostgreSQL exempts from Row Level Security by default — the same
 * bug class AUD-002 was meant to close, just reintroduced as an opt-in
 * default instead of a fail-closed one. This asserts the module now refuses
 * to load with NODE_ENV=production and DATABASE_URL_APP unset, and still
 * loads (with only a warning) in non-production environments — preserving
 * the existing local-dev/CI ergonomics the audit's own remediation roadmap
 * called out as intentional.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('pg', () => {
  class FakePool {
    on() { return this }
    connect() { return Promise.resolve({ query: vi.fn(), release: vi.fn() }) }
    query() { return Promise.resolve({ rows: [] }) }
    end() { return Promise.resolve() }
  }
  return { Pool: FakePool }
})

const ORIGINAL_ENV = { ...process.env }

describe('DATABASE_URL_APP fail-closed behavior', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('__process_exit_called__')
    }) as never)
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    exitSpy.mockRestore()
  })

  it('refuses to load in production when DATABASE_URL_APP is unset', async () => {
    process.env['NODE_ENV'] = 'production'
    delete process.env['DATABASE_URL_APP']
    process.env['DATABASE_URL'] = 'postgresql://owner@localhost:5432/db'

    await expect(import('../db/pool')).rejects.toThrow('__process_exit_called__')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('loads normally in production when DATABASE_URL_APP is set', async () => {
    process.env['NODE_ENV'] = 'production'
    process.env['DATABASE_URL_APP'] = 'postgresql://jarvis_app@localhost:5432/db'
    process.env['DATABASE_URL'] = 'postgresql://owner@localhost:5432/db'

    await expect(import('../db/pool')).resolves.toBeDefined()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('still loads in development when DATABASE_URL_APP is unset (warns, does not exit)', async () => {
    process.env['NODE_ENV'] = 'development'
    delete process.env['DATABASE_URL_APP']
    process.env['DATABASE_URL'] = 'postgresql://owner@localhost:5432/db'

    await expect(import('../db/pool')).resolves.toBeDefined()
    expect(exitSpy).not.toHaveBeenCalled()
  })
})
