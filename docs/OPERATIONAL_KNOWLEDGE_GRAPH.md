# Operational Knowledge Graph

## Overview

The Knowledge Graph Service maintains a tenant-scoped graph of operational entities and their relationships. It enables Ava to understand service dependencies, team ownership, infrastructure topology, and cross-system impact analysis.

## Entity Model

An entity represents any named operational concept:

```typescript
{
  id: string,
  tenantId: string,
  entityType: KgEntityType,    // 'service' | 'team' | 'database' | 'endpoint' | ...
  entityRef: string,           // stable external identifier (e.g., 'auth-service')
  label: string,               // display name
  properties: Record<string, unknown>,
  embeddingId: string | null,  // optional vector embedding for semantic search
}
```

Entities are upserted via `ON CONFLICT (tenant_id, entity_type, entity_ref) DO UPDATE`, so they can be created idempotently from any source.

## Relationship Model

```typescript
{
  id: string,
  tenantId: string,
  fromEntityId: string,
  toEntityId: string,
  relationshipType: string,  // e.g., 'depends_on', 'owned_by', 'deployed_to'
  weight: number,            // edge weight for graph traversal priority
  confidence: number,        // 0.0–1.0 confidence in this relationship
  properties: Record<string, unknown>,
}
```

## Core Operations

| Function | Description |
|---|---|
| `upsertEntity(tenantId, input)` | Create or update an entity |
| `getEntity(tenantId, entityId)` | Retrieve by ID |
| `findEntitiesByRef(tenantId, entityType, entityRef)` | Lookup by stable ref |
| `searchEntities(tenantId, opts)` | Full-text search by label (ILIKE) |
| `addRelationship(tenantId, input)` | Create a directed edge |
| `getNeighborhood(tenantId, entityId)` | Retrieve entity + adjacent relationships |
| `deleteEntity(tenantId, entityId)` | Remove entity and its relationships |

## Neighborhood Traversal

`getNeighborhood(tenantId, entityId, depth?, limit?)` returns:

```typescript
{
  entity: KgEntity,
  relationships: KgRelationship[],  // both inbound and outbound edges
}
```

The query uses `WHERE from_entity_id = $2 OR to_entity_id = $2` to retrieve bidirectional relationships. Results are ordered by `weight DESC, confidence DESC` and limited to `limit` (default 50).

## Use Cases

- **Impact analysis** — given a failing service, traverse `depends_on` edges to find affected downstream services
- **Ownership routing** — given an incident, follow `owned_by` edges to find the responsible team
- **Deployment topology** — `deployed_to` edges model which services run on which infrastructure

## Tenant Isolation

All queries use `tenantQuery(tenantId, ...)` to enforce RLS. Cross-tenant relationship creation is impossible by construction — both entity IDs are validated to belong to the same tenant.

## Related Services

- `automationAdapterService` — adapter events can trigger entity upserts
- `workflowComposerService` — workflow steps can query the graph for routing decisions
- `edgeNodeService` — edge sites are modeled as KG entities
