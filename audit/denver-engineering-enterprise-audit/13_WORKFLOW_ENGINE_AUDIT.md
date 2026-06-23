# 13 — WORKFLOW ENGINE AUDIT
## Actions, SLA Engine, Notifications, State Machines

---

## Overview

The workflow engine spans: Action Center (unified task tracking), SLA policy engine, delegation resolution, notification system, automation rules, and runbooks.

---

## Action Center

**Implementation:** `api/routes/actions.ts` (702 lines — largest route file, verified)

### Action Types (from source)

```
RFI | SUBMITTAL | PUNCH_ITEM | COMPLIANCE_TASK | INSPECTION |
BIM_ISSUE | DAILY_LOG | WORK_ORDER | ALARM | TEMPLATE_ASSIGNMENT
```

### Action Lifecycle

```
created → open → in_progress → pending_approval → approved/completed → closed
                              ↓
                           rejected → open (back)
```

### Key Features (Verified)

| Feature | Status | Evidence |
|---------|--------|----------|
| Unified inbox (all modules) | ✅ | `/actions/inbox` endpoint |
| Overdue tracking | ✅ | due_at < NOW() query with hours_overdue |
| Action summary (counts by type) | ✅ | `/actions/summary` |
| Action timeline / event history | ✅ | `actionEventPublisher.ts` |
| Dependency graph | ✅ | `actionDependencyGraph.ts` — blocker/blocked-by |
| Workload analytics | ✅ | `/actions/analytics/workload` |
| Trends analytics | ✅ | `/actions/analytics/trends` |
| AI-scored action ranking | ✅ | `actionScoringService.ts` |
| SLA pause/resume | ✅ | `/actions/:id/sla/pause|resume` |
| Delegation resolution | ✅ | `approval_delegations` table |
| Relations (duplicates, linked) | ✅ | `actionRelationshipService.ts` |

---

## SLA Policy Engine

**Implementation:** `api/services/sla/slaPolicyEngine.ts` (verified)

### Features (Verified from Source)

```typescript
// Business-hours-aware SLA computation:
// - Skip holidays from holiday_dates[]
// - Skip non-business days from business_days[] (e.g., [1,2,3,4,5])
// - Apply timezone (e.g., 'America/Denver')
// - Compute due_at in business hours from now

// Pause/Resume:
// - SLA can be paused (e.g., waiting on external response)
// - Pause duration tracked in paused_duration_mins
// - Remaining minutes adjusted for pauses

// Escalation:
// - Grace period before first escalation (grace_period_minutes)
// - Cooldown between escalations (escalation_cooldown_minutes)
// - Escalation levels stored in sla_rules.escalation_levels JSONB
```

**SLA Profile fields:**
- `business_hours_start/end` — e.g., '08:00' / '17:00'
- `business_days` — array of weekday numbers [1-7]
- `timezone` — IANA timezone string
- `holiday_dates` — explicit holiday exclusions
- `grace_period_minutes` — before first escalation
- `escalation_cooldown_minutes` — between escalations

**Assessment:** This is a genuinely sophisticated SLA engine. Business-hours-aware computation with timezone support is not trivial. The pause/resume mechanism is correctly implemented. **Grade: A-**

---

## Notification System

**Implementation:** `api/routes/notifications.ts` + `api/services/notifications/` + migration 070

**Notification delivery (verified):**
```
notifications table → notificationWorker polling →
  email delivery (if email configured)
  WebSocket push to connected clients
  in-app notification badge
```

**Notification types:** action_assigned, action_overdue, sla_breach, system_alert, mention, approval_required

**Notification preferences:** `notification_preferences` table — per-user, per-type opt-in/out

**Assessment:** In-app notifications are real. Email delivery requires SMTP configuration. Push notifications (mobile) not found.

**Grade: B+**

---

## Automation Engine

**Implementation:** `api/routes/automation.ts` (352 lines)

**Features confirmed:**
- Rule creation: IF condition THEN action (trigger → action pairs)
- Conditions: field equals, threshold crossed, date passed, status changed
- Actions: create_action, send_notification, update_field, webhook_call
- Rule execution via `complianceWatcher.ts` poller

**Compliance Watcher:** `api/services/complianceWatcher.ts` — scans for compliance tasks past due date, fires automation rules, generates overdue actions.

**Grade: B**

---

## Runbooks

**Implementation:** `api/routes/runbooks.ts`

**Features:**
- Runbook creation with step-by-step instructions
- `runbook_executions` — instance of a runbook being executed
- `runbook_steps` + `runbook_step_results` — per-step tracking
- Linked to systems (PWTP/WWTP/HVAC/EPC)
- Version control on runbooks

**Use case:** Commissioning procedures, maintenance SOPs, emergency response.

**Grade: A-**

---

## Approval Delegations

**Implementation:** `approval_delegations` table + delegation resolution in `actionService.ts`

```typescript
// createAction() resolves effective assignee:
// 1. Check approval_delegations table for active delegation
// 2. If delegated, assign to delegate instead of original assignee
// 3. Record original_assignee for audit trail
```

**Grade: B+**

---

## Workflow State Machine Assessment

Denver Engineering does not have an explicit FSM framework. State transitions are enforced by:
1. SQL CHECK constraints on status columns (some tables)
2. Application-level validation in route handlers
3. Audit log entries on every state change

**Missing:** No formal state machine definition that prevents invalid transitions. A route handler bug could set a "closed" action back to "open" without validation.

**Recommendation:** Consider adding a `transition_map` check (current_state → allowed_next_states) in the action update endpoint.

---

## Workflow Engine Summary

| Component | Grade | Key Finding |
|-----------|-------|-------------|
| Action Center | A- | 702-line unified action API; comprehensive |
| SLA Engine | A- | Business-hours-aware, pause/resume, escalation |
| Notifications | B+ | In-app + email; no mobile push |
| Automation Rules | B | Condition/action rules; compliance watcher |
| Runbooks | A- | Step tracking, versioning, system linking |
| Delegation | B+ | Active delegation resolution |
| State machine | C+ | No formal FSM; application-level enforcement |

**Workflow Engine Score: 82/100**

**This is the platform's strongest technical area.** The SLA engine and action center are enterprise-grade.
