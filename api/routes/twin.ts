// Denver Engineering — Twin Routes (v6.0.0)
// CRUD, sync, snapshot, and graph endpoints for operational digital twins.

import { Router, Request, Response } from 'express'
import {
  registerTwin, getTwin, getTwinByEntity, listTwins,
  getTwinCount, updateTwinStatus,
} from '../services/twin/twinRegistry'
import { captureSnapshot, getSnapshot, getLatestSnapshot, listSnapshots, verifySnapshot } from '../services/twin/twinSnapshotService'
import { addRelationship, removeRelationship, getOutboundRelationships, getInboundRelationships } from '../services/twin/twinGraph'
import { syncTwin, registerAndSync } from '../services/twin/twinSync'
import { getCurrentState, applyEventLink } from '../services/twin/twinStateStore'
import { buildStateGraph, getDegradedNodes } from '../services/twin/stateGraphEngine'
import { bfsTraversal, getImpactedByFailure } from '../services/twin/graphTraversalService'
import { propagateRisk } from '../services/twin/graphRiskPropagation'

import { requireCapability } from '../authz/requireCapability'
const router = Router()

// ─── Twin CRUD ─────────────────────────────────────────────────────────────────

router.post('/', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const twin = await registerTwin({ tenantId, ...req.body })
    res.status(201).json(twin)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const { entityType, status, limit, offset } = req.query
    const twins = await listTwins(tenantId, {
      entityType: entityType as string | undefined,
      status: status as string | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    } as Parameters<typeof listTwins>[1])
    const count = await getTwinCount(tenantId)
    res.json({ twins, count })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:twinId', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const twin = await getTwin(req.params.twinId as string, tenantId)
    if (!twin) return res.status(404).json({ error: 'Twin not found' })
    res.json(twin)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/entity/:entityType/:entityId', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const twin = await getTwinByEntity(
      tenantId,
      req.params.entityType as Parameters<typeof getTwinByEntity>[1],
      req.params.entityId as string
    )
    if (!twin) return res.status(404).json({ error: 'Twin not found' })
    res.json(twin)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ADR-014 Phase 2C-5 §17 — this is a write. `updateTwinStatus` runs
// `UPDATE operational_twins SET status = $3`, so guarding it with
// `crossdomain.read` let a read-only holder change persisted twin state. It now
// carries the same `crossdomain.write` the sibling writes in this file already
// use (POST /:twinId/sync, POST /:twinId/events, …); no new capability was
// introduced and no role gained authority it did not already hold for twin writes.
router.patch('/:twinId/status', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    await updateTwinStatus(req.params.twinId as string, tenantId, req.body.status)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── State & sync ──────────────────────────────────────────────────────────────

router.get('/:twinId/state', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const state = await getCurrentState(req.params.twinId as string, tenantId)
    if (!state) return res.status(404).json({ error: 'Twin not found' })
    res.json(state)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/:twinId/sync', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const result = await syncTwin(tenantId, req.params.twinId as string, req.body.state, req.body.triggeringEventId)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/register-sync', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const { entityType, entityId, name, state, description, metadata, triggeringEventId } = req.body
    const result = await registerAndSync(tenantId, entityType, entityId, name, state, {
      description, metadata, triggeringEventId,
    })
    res.status(201).json(result)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/:twinId/events', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const { eventId, eventType, stateDelta, occurredAt } = req.body
    await applyEventLink(req.params.twinId as string, tenantId, eventId, eventType, stateDelta, new Date(occurredAt))
    res.status(201).json({ success: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Snapshots ─────────────────────────────────────────────────────────────────

router.get('/:twinId/snapshots', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const snapshots = await listSnapshots(
      req.params.twinId as string, tenantId,
      req.query.limit ? Number(req.query.limit) : 50,
      req.query.offset ? Number(req.query.offset) : 0
    )
    res.json(snapshots)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:twinId/snapshots/latest', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const snapshot = await getLatestSnapshot(req.params.twinId as string, tenantId)
    if (!snapshot) return res.status(404).json({ error: 'No snapshots found' })
    res.json(snapshot)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:twinId/snapshots/:snapshotId', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const snapshot = await getSnapshot(req.params.snapshotId as string, tenantId)
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' })
    res.json({ ...snapshot, verified: verifySnapshot(snapshot) })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/:twinId/snapshots', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const snapshot = await captureSnapshot(
      req.params.twinId as string, tenantId, req.body.state, req.body.triggeringEventId
    )
    res.status(201).json(snapshot)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Relationships ─────────────────────────────────────────────────────────────

router.post('/:twinId/relationships', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const rel = await addRelationship({ tenantId, fromTwinId: req.params.twinId as string, ...req.body })
    res.status(201).json(rel)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:twinId/relationships', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const direction = (req.query.direction as string) ?? 'both'
    const [outbound, inbound] = await Promise.all([
      direction !== 'inbound' ? getOutboundRelationships(req.params.twinId as string, tenantId, req.query.relType as import('../services/twin/twinTypes').TwinRelType | undefined) : Promise.resolve([]),
      direction !== 'outbound' ? getInboundRelationships(req.params.twinId as string, tenantId, req.query.relType as import('../services/twin/twinTypes').TwinRelType | undefined) : Promise.resolve([]),
    ])
    res.json({ outbound, inbound })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.delete('/:twinId/relationships', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const { toTwinId, relType } = req.body
    await removeRelationship(tenantId, req.params.twinId as string, toTwinId, relType)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Graph & traversal ────────────────────────────────────────────────────────

router.get('/graph/overview', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const graph = await buildStateGraph(tenantId)
    const degraded = getDegradedNodes(graph)
    res.json({
      nodeCount: graph.nodes.size,
      edgeCount: [...graph.adjacency.values()].reduce((s, e) => s + e.length, 0),
      degradedCount: degraded.length,
      degradedNodes: degraded,
      builtAt: graph.builtAt,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:twinId/traverse', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const graph = await buildStateGraph(tenantId)
    const maxDepth = req.query.maxDepth ? Number(req.query.maxDepth) : 10
    const result = bfsTraversal(graph, req.params.twinId as string, maxDepth)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:twinId/impact', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const graph = await buildStateGraph(tenantId)
    const impacted = getImpactedByFailure(graph, req.params.twinId as string)
    res.json({ rootTwinId: req.params.twinId as string, impactedTwinIds: impacted, count: impacted.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:twinId/risk-propagation', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const graph = await buildStateGraph(tenantId)
    const result = propagateRisk(graph, req.params.twinId as string)
    res.json({
      ...result,
      propagatedRisk: Object.fromEntries(result.propagatedRisk),
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
