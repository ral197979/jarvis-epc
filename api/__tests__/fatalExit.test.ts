/**
 * AUDIT-P0-09 regression — fatal exit paths must flush Sentry + the pino
 * logger (bounded by a timeout) before process.exit(1), instead of exiting
 * on the same tick a fatal log line was written (which could lose it to
 * pino's async transport, as reproduced live during remediation: three
 * separate boot attempts against a broken DB connection produced zero
 * captured log output despite the code path calling log.fatal()).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fatalExit } from '../services/observability/errorTracking'

describe('fatalExit', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('__process_exit_called__')
    }) as never)
  })

  afterEach(() => {
    exitSpy.mockRestore()
  })

  it('calls logger.fatal, flushes the logger, then exits(1) — in that order', async () => {
    const order: string[] = []
    const logger = {
      fatal: vi.fn(() => { order.push('fatal') }),
      flush: vi.fn((cb?: (err?: Error) => void) => { order.push('flush'); cb?.() }),
    }

    await expect(fatalExit(logger, new Error('db unreachable'), '[startup] boom'))
      .rejects.toThrow('__process_exit_called__')

    order.push('exit') // exitSpy throwing proves exit() was reached after the above
    expect(order).toEqual(['fatal', 'flush', 'exit'])
    expect(logger.fatal).toHaveBeenCalledWith({ err: 'db unreachable' }, '[startup] boom')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('still exits even if logger.flush never calls back (bounded timeout, not hung)', async () => {
    const logger = {
      fatal: vi.fn(),
      flush: vi.fn(() => { /* never calls back — simulates a stuck transport */ }),
    }

    await expect(fatalExit(logger, new Error('x'), 'msg', 50))
      .rejects.toThrow('__process_exit_called__')

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('still exits even if logger.flush throws synchronously', async () => {
    const logger = {
      fatal: vi.fn(),
      flush: vi.fn(() => { throw new Error('transport broke') }),
    }

    await expect(fatalExit(logger, new Error('x'), 'msg', 50))
      .rejects.toThrow('__process_exit_called__')

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
