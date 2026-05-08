# Action Dependency Graph Engine

**Ava Phase 2 | Denver Engineering v4.34.0**

---

## Overview

The Dependency Graph Engine manages directed relationships between actions, resolves recursive blocker chains, identifies critical path nodes, and provides batch-efficient blocker status for inbox rendering. It is composed of two services: `actionRelationshipService.ts` (edge CRUD) and `actionDependencyGraph.ts` (graph analysis).

---

## Relation Types

Seven typed directed edges, from `source_action_id` → `target_action_id`:

| Type | Semantics | Dependency? |
|------|-----------|-------------|
| `blocks` | Source blocks progress on target | ✓ |
| `caused_by` | Source was caused by target | ✓ |
| `spawned_from` | Source was created from target | ✓ |
| `related_to` | Loose association | ✗ |
| `duplicates` | Source is a duplicate of target | ✗ |
| `escalated_from` | Source was escalated from target | ✗ |
| `references` | Source references target for context | ✗ |

Only `blocks`, `caused_by`, and `spawned_from` are treated as dependency types. These trigger:
- Cycle detection before insert
- Inclusion in `blocked_by_count` and downstream impact computations
- `is_blocked` flag on the action

---

## Database Schema: `action_relations`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Owning tenant |
| `source_action_id` | UUID | Origin of the directed edge |
| `target_action_id` | UUID | Destination of the directed edge |
| `relation_type` | VARCHAR | CHECK IN (7 types) |
| `created_by` | UUID | User who created the relation |
| `deleted_at` | TIMESTAMPTZ | Soft delete timestamp (null = active) |
| `created_at` | TIMESTAMPTZ | |

**Constraints:**
- `CHECK (source_action_id <> target_action_id)` — self-loops forbidden
- `UNIQUE(tenant_id, source_action_id, target_action_id, relation_type)` — one edge per type per direction

**Indexes (partial, WHERE deleted_at IS NULL):**
- `(tenant_id, source_action_id)` — outbound traversal
- `(tenant_id, target_action_id)` — inbound traversal (find what blocks an action)

---

## Relationship Service API

### `createRelation(tenantId, input)`

```typescript
const { relation, error } = await createRelation(tenantId, {
  sourceActionId: 'a1',
  targetActionId: 'a2',
  relationType:   'blocks',
  createdBy:      'user-uuid',
})
// error: 'cycle_detected' | 'self_reference' | 'not_found' | undefined
```

**Upsert behavior:** If a soft-deleted edge exists for the same `(source, target, type)`, `createRelation` reactivates it (`SET deleted_at = NULL`) rather than inserting a duplicate. This makes re-adding a relation idempotent.

### `listRelations(tenantId, actionId, direction)`

```typescript
const edges = await listRelations(tenantId, actionId, 'inbound')
// direction: 'inbound' | 'outbound' | 'both'
// Returns: ActionRelation[]
```

Only returns non-deleted relations. Joins the related action's title and status for display.

### `deleteRelation(tenantId, relationId, actorId)`

Soft-deletes the relation (sets `deleted_at = NOW()`). The edge remains in the table for audit purposes. Publishes a `relation_removed` event.

---

## Cycle Detection

Before inserting a dependency-typed relation (blocks, caused_by, spawned_from), the service runs a recursive CTE to check if `targetActionId` is already reachable from `sourceActionId` via existing dependency edges:

```sql
WITH RECURSIVE reachable AS (
  -- Base: direct outbound dependency edges from source
  SELECT target_action_id AS action_id
  FROM action_relations
  WHERE source_action_id = $source
    AND relation_type = ANY($dependency_types)
    AND tenant_id = $tenant
    AND deleted_at IS NULL

  UNION

  -- Recursive: follow outbound edges from reachable nodes
  SELECT r.target_action_id
  FROM action_relations r
  JOIN reachable rc ON r.source_action_id = rc.action_id
  WHERE r.relation_type = ANY($dependency_types)
    AND r.tenant_id = $tenant
    AND r.deleted_at IS NULL
)
SELECT 1 FROM reachable WHERE action_id = $target
LIMIT 1
```

If this query returns a row, adding `source → target` would create a cycle, and the operation returns `{ error: 'cycle_detected' }`.

**Non-dependency types** (`related_to`, `duplicates`, `escalated_from`, `references`) skip this check entirely — they are informational and cannot create blocking cycles.

---

## Dependency Graph Analysis

### `buildDependencyReport(tenantId, actionId)`

Returns the full dependency context for a single action:

```typescript
const report = await buildDependencyReport(tenantId, actionId)
// Returns:
{
  is_blocked:             boolean,    // any active blocker exists
  blocked_by_count:       number,     // immediate blockers
  blockers:               ActionNode[], // immediate blocker details
  root_blockers:          ActionNode[], // blockers not blocked by anything else in the set
  downstream_impact_count: number,    // actions blocked by this action (recursive)
  critical_path_flag:     boolean,    // is_blocked AND downstream_impact_count > 0
}
```

**Root blockers** are computed by filtering the blocker set: a blocker is a "root" if it does not appear as `target_action_id` in any relation where the source is another blocker in the set. Root blockers are the actions that must be resolved first to unblock the chain.

**Critical path flag** is true when the action has both incoming blockers AND outbound downstream impact — it sits in the middle of a chain and removing it unblocks multiple downstream actions.

Recursive traversal is capped at **depth 10** to prevent runaway queries on deep chains.

### `batchBlockerStatus(tenantId, actionIds[])`

Efficiently checks immediate blockers for multiple actions in a single query:

```typescript
const statusMap = await batchBlockerStatus(tenantId, ['a1', 'a2', 'a3'])
// Returns: Map<actionId, { is_blocked: boolean, blocked_by_count: number, blockers: ActionNode[] }>
```

This avoids N+1 queries when rendering the inbox. A single SQL query with `ANY($ids::uuid[])` fetches all relevant blocker edges and groups them client-side.

**Short-circuit:** if `actionIds` is empty, returns an empty `Map` without executing any SQL.

---

## Inbox Integration

The `/api/v1/actions/inbox` route uses `batchBlockerStatus` to enrich each page of results:

```
1. Query actions (with LEFT JOIN for sla_state + relation counts)
2. Collect action IDs from this page
3. batchBlockerStatus(tenantId, actionIds) → Map
4. Merge blocker data into each action row
5. Return enriched JSON
```

The `blocked_by_count` from the batch query overrides the JOIN-computed count, ensuring consistency.

---

## Frontend: DependencyGraphPlaceholder

The `DependencyGraphPlaceholder` component renders the dependency tab in `ActionDetailDrawer`:

- Fetches `GET /api/v1/actions/:id/dependencies` → `DependencyReport`
- Shows a **Critical Path** badge (orange) when `critical_path_flag` is true
- Shows a **Blocked** badge (red) when `is_blocked`
- Shows downstream impact count
- Lists immediate blockers as status-colored pills (open=blue, in_progress=purple, etc.)
- Contains a placeholder `<div>` marked for future D3.js / Cytoscape graph visualization

---

## Known Limitations

- Recursive traversal is capped at depth 10. Chains deeper than 10 levels will report incomplete downstream counts. This limit prevents query timeouts but should be configurable in Phase 3.
- `buildDependencyReport` makes multiple sequential queries (immediate blockers, recursive downstream). For very deep or wide graphs, a single recursive CTE spanning both directions would be more efficient — deferred to Phase 3.
- There is no visualization beyond the placeholder div. D3.js or Cytoscape integration is a Phase 3 deliverable.
- Cross-project relationships are permitted by the current schema (both actions must share `tenant_id` but can have different `project_id`). Phase 3 may need to add project-scoped relationship restrictions for tenants with strict project isolation requirements.
