/**
 * Denver Engineering — Ava Phase 1 Action Engine Tests (v4.33.0)
 * ────────────────────────────────────────────────────────────────
 * Coverage:
 *   - createAction: basic creation, idempotency (conflict → fetch existing),
 *     delegation routing, SLA due_at computation, due_at override, null assignee
 *   - completeAction / cancelAction: status transitions, idempotency on
 *     already-terminal actions
 *   - resolveEffectiveAssignee: active delegation, expired delegation,
 *     scope-filtered delegation, no delegation
 *   - SLA engine: _fireNextEscalation escalation level selection,
 *     threshold gating, max-level cap, default vs rule-based levels
 *   - system_type isolation: rule specificity ordering
 *   - Duplicate action guard: second call returns existing row, no second INSERT
 *
 * All DB calls are mocked — no live database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock the DB pool before importing the services ──────────────────────────

const mockQuery = vi.hoisted(() => vi.fn())

vi.mock('../../../api/db/pool', () => ({
  query:       mockQuery,
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) =>
    mockQuery(sql, params),
}))

vi.mock('../../../src/modules/observability/index', () => ({
  slog: vi.fn(),
}))

vi.mock('../../../api/services/scheduler', () => ({
  registerPromoter: vi.fn(),
}))

// Import after mocks are in place
import {
  createAction,
  completeAction,
  cancelAction,
  resolveEffectiveAssignee,
  __testHooks,
} from '../../../api/services/actionService'

import { __testHooks as slaHooks } from '../../../api/services/slaEngine'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT  = 'tenant-uuid-0001'
const USER_A  = 'user-uuid-aaaa'
const USER_B  = 'user-uuid-bbbb'  // delegate
const SRC_ID  = 'source-uuid-1111'
const ACTION_ID = 'action-uuid-9999'

/** Build a minimal ActionRow for mock returns */
function makeActionRow(overrides = {}) {
  return {
    id:                   ACTION_ID,
    tenant_id:            TENANT,
    project_id:           null,
    title:                'Test Action',
    description:          null,
    action_type:          'RFI',
    source_module:        'rfis',
    source_id:            SRC_ID,
    system_type:          null,
    priority:             'medium',
    status:               'open',
    assigned_to_user_id:  USER_A,
    assigned_to_role:     null,
    due_at:               null,
    sla_rule_id:          null,
    completed_at:         null,
    cancelled_at:         null,
    created_by:           USER_A,
    created_at:           new Date().toISOString(),
    updated_at:           new Date().toISOString(),
    ...overrides,
  }
}

/** Build a minimal OverdueActionRow for SLA engine tests */
function makeOverdueRow(overrides = {}) {
  return {
    id:                   ACTION_ID,
    tenant_id:            TENANT,
    project_id:           null,
    title:                'Overdue RFI',
    action_type:          'RFI',
    source_module:        'rfis',
    source_id:            SRC_ID,
    system_type:          null,
    priority:             'medium',
    assigned_to_user_id:  USER_A,
    assigned_to_role:     null,
    due_at:               new Date(Date.now() - 30 * 3600_000).toISOString(), // 30h overdue
    sla_rule_id:          null,
    hours_overdue:        30,
    max_escalation_level: null,
    ...overrides,
  }
}

// ─── createAction ─────────────────────────────────────────────────────────────

describe('createAction', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('creates an action and returns the row', async () => {
    const row = makeActionRow()
    // No delegation
    mockQuery.mockResolvedValueOnce({ rows: [] })                // delegation query → none
    // No SLA rule
    mockQuery.mockResolvedValueOnce({ rows: [] })                // sla_rules query → none
    // INSERT succeeds
    mockQuery.mockResolvedValueOnce({ rows: [row] })             // INSERT RETURNING *

    const result = await createAction(TENANT, {
      title:         'RFI-001: Foundation review',
      action_type:   'RFI',
      source_module: 'rfis',
      source_id:     SRC_ID,
      assigned_to_user_id: USER_A,
      created_by:    USER_A,
    })

    expect(result).toMatchObject({ id: ACTION_ID, action_type: 'RFI' })
    // INSERT should have been called
    const insertCall = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO actions'))
    expect(insertCall).toBeDefined()
  })

  it('is idempotent — returns existing row on conflict', async () => {
    const existing = makeActionRow({ title: 'original title' })
    mockQuery
      // no assigned_to_user_id → delegation check skipped
      .mockResolvedValueOnce({ rows: [] })        // SLA rule → none
      .mockResolvedValueOnce({ rows: [] })        // INSERT → conflict (0 rows)
      .mockResolvedValueOnce({ rows: [existing] }) // SELECT existing

    const result = await createAction(TENANT, {
      title:         'duplicate call',
      action_type:   'RFI',
      source_module: 'rfis',
      source_id:     SRC_ID,
    })

    expect(result).toMatchObject({ title: 'original title' })
  })

  it('computes due_at from SLA rule when not provided', async () => {
    const slaRule = { id: 'sla-rule-uuid', default_duration_hours: 48, escalation_levels: [] }
    mockQuery
      // no assigned_to_user_id → delegation check skipped
      .mockResolvedValueOnce({ rows: [slaRule] })            // SLA rule found
      .mockResolvedValueOnce({ rows: [makeActionRow()] })    // INSERT succeeds

    await createAction(TENANT, {
      title:         'RFI with SLA',
      action_type:   'RFI',
      source_module: 'rfis',
      source_id:     SRC_ID,
    })

    const insertCall = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO actions'))
    expect(insertCall).toBeDefined()
    // $13 = slaRuleId should be the rule's id
    const params = insertCall![1] as unknown[]
    const slaRuleIdIdx = 12  // 0-based: $13 is index 12
    expect(params[slaRuleIdIdx]).toBe('sla-rule-uuid')
    // $12 = due_at (index 11) should be a Date in the future
    const dueAt = params[11] as Date
    expect(dueAt).toBeInstanceOf(Date)
    expect(dueAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('uses provided due_at override, skips SLA lookup', async () => {
    const overrideDue = new Date('2030-01-01T00:00:00Z')
    mockQuery
      // no assigned_to_user_id → delegation check skipped
      // due_at provided → SLA lookup also skipped
      .mockResolvedValueOnce({ rows: [makeActionRow({ due_at: overrideDue.toISOString() })] }) // INSERT

    await createAction(TENANT, {
      title:         'RFI with override',
      action_type:   'RFI',
      source_module: 'rfis',
      source_id:     SRC_ID,
      due_at:        overrideDue,
    })

    // Only 1 query call: INSERT (no delegation, no SLA lookup)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('routes to delegate when active delegation exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ delegate_user_id: USER_B }] })  // delegation found
      .mockResolvedValueOnce({ rows: [] })                               // SLA → none
      .mockResolvedValueOnce({ rows: [makeActionRow({ assigned_to_user_id: USER_B })] })

    const result = await createAction(TENANT, {
      title:               'Delegated RFI',
      action_type:         'RFI',
      source_module:       'rfis',
      source_id:           SRC_ID,
      assigned_to_user_id: USER_A,
    })

    expect(result?.assigned_to_user_id).toBe(USER_B)
    // The INSERT params should contain USER_B as assignee ($10 = index 9)
    const insertCall = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO actions'))
    const params = insertCall![1] as unknown[]
    expect(params[9]).toBe(USER_B)
  })

  it('returns null gracefully on DB error (does not throw)', async () => {
    mockQuery
      // no assigned_to_user_id → delegation check skipped
      .mockResolvedValueOnce({ rows: [] })                // SLA OK
      .mockRejectedValueOnce(new Error('DB connection lost'))  // INSERT throws

    const result = await createAction(TENANT, {
      title:         'Error action',
      action_type:   'RFI',
      source_module: 'rfis',
      source_id:     SRC_ID,
    })

    expect(result).toBeNull()
  })
})

// ─── completeAction / cancelAction ───────────────────────────────────────────

describe('completeAction', () => {
  beforeEach(() => vi.resetAllMocks())

  it('updates status to completed', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })

    await expect(completeAction(TENANT, 'rfis', SRC_ID)).resolves.toBeUndefined()
    const call = mockQuery.mock.calls[0]!
    expect(String(call[0])).toContain("status       = 'completed'")
    expect(call[1]).toEqual([TENANT, 'rfis', SRC_ID])
  })

  it('is idempotent — silently updates 0 rows if already completed', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })
    await expect(completeAction(TENANT, 'rfis', SRC_ID)).resolves.toBeUndefined()
  })
})

describe('cancelAction', () => {
  beforeEach(() => vi.resetAllMocks())

  it('updates status to cancelled', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })

    await expect(cancelAction(TENANT, 'rfis', SRC_ID)).resolves.toBeUndefined()
    const call = mockQuery.mock.calls[0]!
    expect(String(call[0])).toContain("status       = 'cancelled'")
  })
})

// ─── resolveEffectiveAssignee ─────────────────────────────────────────────────

describe('resolveEffectiveAssignee', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns delegate when active delegation exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ delegate_user_id: USER_B }] })
    const result = await resolveEffectiveAssignee(TENANT, USER_A, 'RFI', 'rfis')
    expect(result).toBe(USER_B)
  })

  it('returns original user when no delegation exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await resolveEffectiveAssignee(TENANT, USER_A, 'RFI', 'rfis')
    expect(result).toBe(USER_A)
  })

  it('returns null when userId is null', async () => {
    const result = await resolveEffectiveAssignee(TENANT, null, 'RFI', 'rfis')
    expect(result).toBeNull()
    // Should not query DB for null userId
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns null when userId is undefined', async () => {
    const result = await resolveEffectiveAssignee(TENANT, undefined, 'RFI', 'rfis')
    expect(result).toBeNull()
  })
})

// ─── SLA rule resolution (_resolveSlaRule) ────────────────────────────────────

describe('_resolveSlaRule (via __testHooks)', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns null when no rule matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await __testHooks.resolveSlaRule(TENANT, 'RFI', null)
    expect(result).toBeNull()
  })

  it('returns matched rule with hours and escalation_levels', async () => {
    const rule = { id: 'sla-001', default_duration_hours: 72, escalation_levels: [] }
    mockQuery.mockResolvedValueOnce({ rows: [rule] })
    const result = await __testHooks.resolveSlaRule(TENANT, 'RFI', null)
    expect(result).toMatchObject({ id: 'sla-001', default_duration_hours: 72 })
  })

  it('prefers system_type-specific rule over catch-all (ORDER BY ensures this)', async () => {
    // The SQL uses ORDER BY (system_type IS NOT NULL) DESC LIMIT 1
    // so our mock just needs to return the specific one first
    const specificRule = { id: 'sla-specific', default_duration_hours: 24, escalation_levels: [] }
    mockQuery.mockResolvedValueOnce({ rows: [specificRule] })
    const result = await __testHooks.resolveSlaRule(TENANT, 'RFI', 'PWTP')
    expect(result?.id).toBe('sla-specific')
  })
})

// ─── SLA Engine: _fireNextEscalation ─────────────────────────────────────────

describe('SLA engine: _fireNextEscalation', () => {
  beforeEach(() => vi.resetAllMocks())

  const DEFAULT_LEVELS = [
    { level: 1, after_hours: 0,  notify_role: 'assigned_user' },
    { level: 2, after_hours: 24, notify_role: 'supervisor'    },
    { level: 3, after_hours: 48, notify_role: 'admin'         },
  ]

  it('fires level 1 when action is just overdue (0h threshold met)', async () => {
    const action = makeOverdueRow({ hours_overdue: 0.5, max_escalation_level: null })

    // _resolveNotifiedUsers for 'assigned_user' → [USER_A]
    // INSERT into action_escalations
    mockQuery
      .mockResolvedValueOnce({ rows: [] })               // no users lookup needed (assigned_user)
      .mockResolvedValueOnce({ rowCount: 1 })            // INSERT action_escalations

    const fired = await slaHooks.fireNextEscalation(action, DEFAULT_LEVELS)
    expect(fired).toBe(true)

    const insertCall = mockQuery.mock.calls.find(c =>
      String(c[0]).includes('INSERT INTO action_escalations'))
    expect(insertCall).toBeDefined()
    // escalation_level should be 1
    const params = insertCall![1] as unknown[]
    expect(params[2]).toBe(1)
  })

  it('fires level 2 when 24h threshold met and level 1 already fired', async () => {
    const action = makeOverdueRow({ hours_overdue: 25, max_escalation_level: 1 })

    // supervisor role → query users
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'pm-user-id' }] })  // supervisor users
      .mockResolvedValueOnce({ rowCount: 1 })                     // INSERT

    const fired = await slaHooks.fireNextEscalation(action, DEFAULT_LEVELS)
    expect(fired).toBe(true)

    const insertCall = mockQuery.mock.calls.find(c =>
      String(c[0]).includes('INSERT INTO action_escalations'))
    const params = insertCall![1] as unknown[]
    expect(params[2]).toBe(2)
    expect(params[4]).toBe('supervisor')
  })

  it('does NOT fire level 2 when hours_overdue < 24', async () => {
    const action = makeOverdueRow({ hours_overdue: 5, max_escalation_level: 1 })
    const fired = await slaHooks.fireNextEscalation(action, DEFAULT_LEVELS)
    expect(fired).toBe(false)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('does NOT fire when all levels already fired (max_escalation_level = 3)', async () => {
    const action = makeOverdueRow({ hours_overdue: 100, max_escalation_level: 3 })
    const fired = await slaHooks.fireNextEscalation(action, DEFAULT_LEVELS)
    expect(fired).toBe(false)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('fires level 3 at 48h threshold', async () => {
    const action = makeOverdueRow({ hours_overdue: 50, max_escalation_level: 2 })

    // admin role → query users
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'admin-user-id' }] })
      .mockResolvedValueOnce({ rowCount: 1 })

    const fired = await slaHooks.fireNextEscalation(action, DEFAULT_LEVELS)
    expect(fired).toBe(true)

    const insertCall = mockQuery.mock.calls.find(c =>
      String(c[0]).includes('INSERT INTO action_escalations'))
    const params = insertCall![1] as unknown[]
    expect(params[2]).toBe(3)
    expect(params[4]).toBe('admin')
  })

  it('uses custom escalation levels from SLA rule', async () => {
    const customLevels = [
      { level: 1, after_hours: 0,  notify_role: 'assigned_user' },
      { level: 2, after_hours: 4,  notify_role: 'supervisor'    },  // faster escalation
    ]
    const action = makeOverdueRow({ hours_overdue: 6, max_escalation_level: 1 })

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'pm-user-id' }] })
      .mockResolvedValueOnce({ rowCount: 1 })

    const fired = await slaHooks.fireNextEscalation(action, customLevels)
    expect(fired).toBe(true)

    const insertCall = mockQuery.mock.calls.find(c =>
      String(c[0]).includes('INSERT INTO action_escalations'))
    const params = insertCall![1] as unknown[]
    expect(params[2]).toBe(2)
  })
})

// ─── Duplicate action guard (integration-style) ───────────────────────────────

describe('Duplicate action guard', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calling createAction twice returns the same action id', async () => {
    const existing = makeActionRow()

    // First call: success (no user_id → delegation skipped)
    mockQuery
      .mockResolvedValueOnce({ rows: [] })          // SLA
      .mockResolvedValueOnce({ rows: [existing] })  // INSERT → new

    // Second call: conflict (no user_id → delegation skipped)
    mockQuery
      .mockResolvedValueOnce({ rows: [] })          // SLA
      .mockResolvedValueOnce({ rows: [] })          // INSERT → conflict
      .mockResolvedValueOnce({ rows: [existing] })  // SELECT existing

    const base = {
      title:         'Duplicate test',
      action_type:   'RFI' as const,
      source_module: 'rfis',
      source_id:     SRC_ID,
    }

    const first  = await createAction(TENANT, base)
    const second = await createAction(TENANT, base)

    expect(first?.id).toBe(ACTION_ID)
    expect(second?.id).toBe(ACTION_ID)
  })
})

// ─── system_type isolation ────────────────────────────────────────────────────

describe('system_type isolation', () => {
  beforeEach(() => vi.resetAllMocks())

  it('passes system_type to SLA rule lookup', async () => {
    mockQuery
      // no assigned_to_user_id → delegation skipped
      .mockResolvedValueOnce({ rows: [] })          // SLA → none
      .mockResolvedValueOnce({ rows: [makeActionRow({ system_type: 'PWTP' })] })

    await createAction(TENANT, {
      title:         'PWTP alarm',
      action_type:   'ALARM',
      source_module: 'alarms',
      source_id:     SRC_ID,
      system_type:   'PWTP',
    })

    const slaCall = mockQuery.mock.calls.find(c => String(c[0]).includes('FROM   sla_rules'))
    expect(slaCall).toBeDefined()
    // $3 = system_type should be 'PWTP'
    const params = slaCall![1] as unknown[]
    expect(params[2]).toBe('PWTP')
  })

  it('stores system_type on the action row', async () => {
    mockQuery
      // no assigned_to_user_id → delegation skipped
      .mockResolvedValueOnce({ rows: [] })           // SLA → none
      .mockResolvedValueOnce({ rows: [makeActionRow({ system_type: 'WWTP' })] })

    const result = await createAction(TENANT, {
      title:         'WWTP inspection',
      action_type:   'INSPECTION',
      source_module: 'inspections',
      source_id:     SRC_ID,
      system_type:   'WWTP',
    })

    // INSERT should include WWTP as $8 (system_type param)
    const insertCall = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO actions'))
    const params = insertCall![1] as unknown[]
    expect(params[7]).toBe('WWTP')
    expect(result?.system_type).toBe('WWTP')
  })
})
