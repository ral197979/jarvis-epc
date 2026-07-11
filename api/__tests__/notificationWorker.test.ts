/**
 * AUDIT-P0-08 regression — notification delivery stubs must report failure,
 * not a fabricated success, so the retry/dead-letter logic in _processJob
 * actually engages instead of silently discarding every queued notification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()
vi.mock('../db/pool', () => ({ query: (...args: unknown[]) => queryMock(...args) }))

import { __testHooks } from '../services/notifications/notificationWorker'

const baseJob = {
  id: 'job-1', tenant_id: 'tenant-1', channel: 'in_app', template_key: 'x',
  recipient_ids: ['u1'], recipient_emails: [], payload: {}, attempts: 0,
  max_attempts: 3, action_id: null, event_type: null,
}

describe('notification delivery stubs', () => {
  it.each(['in_app', 'email', 'webhook', 'slack'])(
    '%s channel reports failure, not a fabricated success',
    async (channel) => {
      const result = await __testHooks.deliver({ ...baseJob, channel })
      expect(result.success).toBe(false)
      expect(result.error).toBe(`not_implemented:${channel}`)
    },
  )
})

describe('_processJob — stub failure engages retry/dead-letter, not delivered', () => {
  beforeEach(() => { queryMock.mockReset().mockResolvedValue({ rows: [] }) })

  it('marks a first-attempt failure as failed (retry), never delivered', async () => {
    await __testHooks.processJob({ ...baseJob, attempts: 0, max_attempts: 3 }, 'worker-1')

    const updateCall = queryMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE notification_jobs'),
    )
    expect(updateCall).toBeTruthy()
    const [sql] = updateCall as [string, unknown[]]
    expect(sql).toContain(`status = 'failed'`)
    expect(sql).not.toContain(`status = 'delivered'`)
  })

  it('moves an exhausted job to the dead-letter table instead of marking it delivered', async () => {
    await __testHooks.processJob({ ...baseJob, attempts: 2, max_attempts: 3 }, 'worker-1')

    const deadLetterCall = queryMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('notification_dead_letters'),
    )
    expect(deadLetterCall).toBeTruthy()

    const deliveredCall = queryMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes(`status = 'delivered'`),
    )
    expect(deliveredCall).toBeUndefined()
  })
})
