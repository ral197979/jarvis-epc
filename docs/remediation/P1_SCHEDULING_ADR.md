# P1 — ADR: CPM Scheduling Engine for Denver Engineering

**Status:** DRAFT — awaiting owner approval
**Release slot:** v4.32.0
**Context:** competitive-gap remediation, parity → lead against Primavera P6 / InEight

---

## Context

Denver Engineering has basic gantt + WBS (from existing `src/components/Dashboard.tsx` primitives and biz reducer). It lacks:

- Critical Path Method (CPM) computation — early/late start, early/late finish, total float, free float
- Baseline snapshots vs. current schedule variance
- P6 import/export (.xer, .xml) for interoperability with owner/third-party schedulers

This ADR picks the engine and data model before any implementation begins.

---

## Decision drivers

| Driver | Weight |
|---|---|
| Correctness of CPM math vs P6 reference | High |
| Interop with P6 XER format | High |
| License compatibility (proprietary repo) | High |
| Self-host requirement (no external scheduling SaaS) | High |
| Maintenance burden | Medium |
| Performance on 5,000+ activity schedules | Medium |
| Support for resource leveling (deferred to v2) | Low |

---

## Options considered

### Option A — Build in-house (pure TypeScript CPM engine)

Algorithm: topological sort → forward pass (ES/EF) → backward pass (LS/LF) → float calculation.

**Pros:**
- Zero license risk
- Matches existing TypeScript / Zustand codebase style
- Full control over extension points (resource calendars, hammock activities, etc.)
- Testable with deterministic property-based tests

**Cons:**
- XER parsing is nontrivial; XML (P6 XML export) is simpler
- ~1,500 LOC including types + tests
- Re-deriving correctness against P6 takes careful validation

**Implementation pointer:** `api/services/scheduling/cpm.ts` + `api/services/scheduling/xer.ts`

### Option B — Integrate an open-source CPM library

Candidates reviewed (as of 2026 landscape):

| Library | License | Maintenance | Notes |
|---|---|---|---|
| `cpm-algorithm` (npm) | MIT | Low activity | Minimal API; no calendars |
| `project-scheduling-js` | MIT | Moderate | Has calendars but no XER |
| `anoxia/critical-path` | MIT | Archived | Educational, not production |
| Syncfusion Gantt (EJ2) | Commercial | Active | Comes with UI; license incompatible for our stance |

**Pros:** Less code; faster time-to-value for core math.
**Cons:** All candidates lack XER; all need wrapping for our types; license risk on commercial options.

### Option C — Call an external scheduling service (e.g., MS Project Online, Asta Teamplan SaaS)

Rejected immediately — violates the self-host / data sovereignty principle and introduces a third-party dependency for core EPC math.

### Option D — Adopt P6 as backend via API

Rejected — Primavera doesn't expose a realistic programmatic API at our scale, and forces customers into Oracle licensing.

---

## Decision

**Option A — build in-house CPM engine; start with XML import/export; XER as v1 stretch.**

Rationale:
- Correctness is too central to EPC to depend on lightly-maintained OSS
- XML is standardized and Primavera exports it cleanly
- XER support can follow once the core engine is validated
- Keeps the "self-host / data sovereignty" LEAD intact

---

## Data model

### New migration: `005_scheduling.sql`

```sql
CREATE TABLE schedule_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  code TEXT NOT NULL,                      -- user-visible activity code
  name TEXT NOT NULL,
  duration_days NUMERIC NOT NULL DEFAULT 0 CHECK (duration_days >= 0),
  is_milestone BOOLEAN NOT NULL DEFAULT FALSE,
  calendar_id UUID,                        -- nullable → project default
  wbs_path TEXT,                            -- e.g., "1.2.3"
  constraint_type TEXT CHECK (constraint_type IN
    ('SNET','SNLT','FNET','FNLT','SON','FON','MSO','MFO')),
  constraint_date DATE,
  UNIQUE(project_id, code)
);

CREATE TABLE schedule_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  predecessor_id UUID NOT NULL REFERENCES schedule_activities(id),
  successor_id UUID NOT NULL REFERENCES schedule_activities(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('FS','SS','FF','SF')),
  lag_days NUMERIC NOT NULL DEFAULT 0,
  UNIQUE(predecessor_id, successor_id, relation_type)
);

CREATE TABLE schedule_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID REFERENCES projects(id),  -- null = global
  name TEXT NOT NULL,
  workdays_mask SMALLINT NOT NULL DEFAULT 62,  -- Mon-Fri = 0b0111110 = 62
  hours_per_day NUMERIC NOT NULL DEFAULT 8,
  holidays JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE schedule_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  captured_by UUID NOT NULL REFERENCES users(id),
  snapshot JSONB NOT NULL                   -- frozen activities + dependencies
);

-- RLS
ALTER TABLE schedule_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_baselines ENABLE ROW LEVEL SECURITY;
-- policies identical pattern to existing tables
```

---

## CPM engine API

### `api/services/scheduling/cpm.ts`

```typescript
export interface CPMInput {
  activities: Activity[];
  dependencies: Dependency[];
  calendar: Calendar;
  dataDate: string;   // ISO date — "now" for schedule calculation
}

export interface CPMResult {
  activities: ActivityComputed[];  // adds es, ef, ls, lf, totalFloat, freeFloat, onCriticalPath
  criticalPath: string[];          // ordered list of activity IDs
  projectStart: string;
  projectFinish: string;
  errors: CPMError[];              // cycles, orphans, missing dependencies
}

export function calculate(input: CPMInput): CPMResult;
```

### HTTP surface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/schedule/calculate?project_id=...` | Run CPM for project |
| `POST` | `/api/v1/schedule/import-xml` | Accept P6 XML, upsert activities + deps |
| `POST` | `/api/v1/schedule/export-xml` | Emit P6-compatible XML |
| `POST` | `/api/v1/schedule/baseline` | Snapshot current schedule |
| `GET` | `/api/v1/schedule/variance?baseline_id=...` | Per-activity variance vs baseline |

---

## Import/export — P6 XML scope

Parser targets Oracle Primavera P6 Business XML Schema (PMXML) v19+.

| PMXML element | Maps to |
|---|---|
| `Project` | `projects` row |
| `Activity` | `schedule_activities` row |
| `Relationship` | `schedule_dependencies` row |
| `Calendar` | `schedule_calendars` row |
| `WBS` | `schedule_activities.wbs_path` |

**Stretch (v1.5):** XER binary/text format — widely used but not well-documented; recommend deferring.

---

## Validation plan

1. Build a 200-activity sample schedule in Primavera P6; export to XML.
2. Import into JARVIS.
3. Run `calculate()`.
4. Compare early/late dates + float + critical path element-by-element with P6's computation.
5. Expected: zero diff on deterministic cases; acceptable ±0.5 day on calendar-edge cases (known float convention difference).

Test fixtures live at `api/services/scheduling/__fixtures__/`.

---

## Frontend — gantt surface

Upgrade `src/components/Dashboard.tsx` or create dedicated `src/components/SchedulingView.tsx`:

- Interactive gantt with zoom (day / week / month)
- Critical path highlighted
- Baseline overlay toggle
- Activity detail drawer (constraints, relationships, float values)
- Import/export buttons (owner/pm roles)

Candidate library for rendering: `dhtmlx-gantt` (commercial) vs. custom SVG. Recommend custom SVG for zero-license surface.

---

## Acceptance criteria

- [ ] `calculate()` on a 200-activity reference matches P6 float within ±0.5 day on all activities
- [ ] Critical path identified identically to P6 on reference
- [ ] Import of sample PMXML succeeds; round-trip export + re-import idempotent
- [ ] 5,000-activity performance: calculation < 5s on developer laptop
- [ ] RLS: tenant A cannot see tenant B's schedules
- [ ] UI shows critical path highlight + baseline overlay
- [ ] E2E test `scheduling.spec.ts` covers import → calculate → baseline → variance
- [ ] `CHANGELOG.md` v4.32.0 entry

---

## Out of scope (v1)

- Resource leveling (requires a solver; v2 candidate)
- Probabilistic / Monte Carlo schedule risk analysis
- Multi-project schedule integration
- XER (binary-like) format — stretch, v1.5

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Calendar edge cases diverge from P6 | Medium | Match P6 convention exactly in calendar module; fixture-driven tests |
| Schedule data corruption on import | High | Dry-run mode; full transaction on commit; baseline before every import |
| Perf regression on large projects | Medium | Benchmark in CI; memoize dependency graph |
| XML format drift between P6 versions | Low | Version-tagged parser; reject unknown schema versions with clear error |

---

## Effort estimate

| Slice | Days |
|---|---|
| Migration 005 + types + CPM engine core | 3 |
| XML import/export | 2 |
| HTTP routes + variance computation | 1 |
| Frontend gantt upgrade | 2 |
| **Total** | **8 days** |

---

## Owner approval

- [ ] **Approved** — build in-house; XML-first; XER deferred
- [ ] **Approved** — build in-house; include XER in v1 (add ~4 days)
- [ ] **Approved with adjustments:** __________
- [ ] **Rejected** — reason: __________
- [ ] **Deferred** — re-review at date: ______________

Signed: _________________________  Date: _______________
