/**
 * Denver Engineering — the accounting boundary, read surface
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET  /api/v1/integrations/accounting/contract
 *   GET  /api/v1/integrations/accounting/outbound/:type/:id
 *   GET  /api/v1/integrations/accounting/party/:projectId/:provider
 *   PUT  /api/v1/integrations/accounting/party/:projectId/:provider
 *   POST /api/v1/integrations/accounting/emit/:type/:id
 *   GET  /api/v1/integrations/accounting/status/:type/:id
 *
 * The emission path exists as of the owner decisions of 2026-08-25: only an
 * APPROVED document may emit, and a receivable additionally requires a mapped
 * external customer. Emission itself adds no persistence — it enqueues onto
 * `integration_jobs` (migration 044), which already provides idempotency,
 * retry, backoff and dead-lettering.
 *
 * Still absent, deliberately: any route that posts a journal, records a
 * receipt, or reads a ledger back. Denver has none of those and the boundary
 * exists to keep it that way.
 *
 * Authorization is two-dimensional on purpose. `cost.view` is the functional
 * capability, because these payloads carry commercial figures; record scope is
 * applied against the resource that actually backs the document, so a caller
 * cannot project a payable out of a project they cannot open. A platform
 * administrator with integration rights but no project reach gets 404 — the
 * boundary is not a way around ADR-014.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { authorizeRecordScope, requireProjectScope } from '../authz/recordScope'
import { resolveCurrentUser } from '../authz/currentUser'
import {
  ACCOUNTING_CONTRACT_VERSION, ACCOUNTING_PROVIDERS, ACCOUNTING_DOCUMENT_TYPES,
  ACCOUNTING_ACK_STATES, ACCOUNTING_OPEN_DECISIONS, DOCUMENT_SOURCE_RESOURCE,
  EMITTING_STATE, REQUIRES_CUSTOMER_MAPPING,
  type AccountingDocumentType, type AccountingProviderId,
} from '../services/integration/accounting/accountingContract'
import { buildAccountingDocument } from '../services/integration/accounting/accountingProjection'
import {
  emitAccountingDocument, documentIntegrationStatus,
  resolvePartyLink, upsertPartyLink,
} from '../services/integration/accounting/accountingEmission'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest

export const accountingBoundaryRouter = Router()
accountingBoundaryRouter.use(requireAuth as never)
accountingBoundaryRouter.use(requireTenant() as never)

const TYPES = new Set<string>(ACCOUNTING_DOCUMENT_TYPES)
const PROVIDERS = new Set<string>(ACCOUNTING_PROVIDERS)

/**
 * The contract itself, so an integrator can read the boundary without reading
 * the source. `notInScope` is part of the payload rather than a comment: it is
 * the half of the contract that says what Denver will never send or store.
 */
accountingBoundaryRouter.get('/contract', requireCapability('platform.integrations') as never, (_req: Request, res: Response) => {
  res.json({
    data: {
      contractVersion: ACCOUNTING_CONTRACT_VERSION,
      providers: ACCOUNTING_PROVIDERS,
      documentTypes: ACCOUNTING_DOCUMENT_TYPES,
      sourceResources: DOCUMENT_SOURCE_RESOURCE,
      acknowledgement: {
        states: ACCOUNTING_ACK_STATES,
        required: ['state', 'receivedAt', 'contractVersion'],
        optional: ['externalId', 'externalUrl', 'message', 'settlement'],
        note: 'Settlement is a STATUS on Denver\'s own document. Denver holds no receipt, allocation or ledger entry.',
      },
      notInScope: [
        'general ledger', 'chart of accounts', 'journal entries',
        'double-entry postings', 'AR/AP ledger or ageing',
        'payment ledger, remittance matching, bank reconciliation',
        'tax determination', 'currency revaluation', 'period close',
      ],
      emissionPolicy: {
        emittingState: EMITTING_STATE,
        requiresCustomerMapping: REQUIRES_CUSTOMER_MAPPING,
        note: 'Only an approved document emits. `submitted` is workflow, not accounting authorization, and `paid` is settlement rather than a second document — it arrives through the acknowledgement boundary.',
      },
      openDecisions: ACCOUNTING_OPEN_DECISIONS,
    },
  })
})

/**
 * The exact neutral payload Denver would send for one record.
 *
 * Read-only and side-effect free: nothing is enqueued, nothing is marked sent.
 * This is how a mapping is verified against real data before a provider is
 * enabled.
 */
accountingBoundaryRouter.get('/outbound/:type/:id', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const type = String(req.params.type)

  if (!TYPES.has(type)) {
    res.status(400).json({ error: 'unknown_document_type', allowed: [...TYPES] })
    return
  }
  const docType = type as AccountingDocumentType

  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }

    // Record scope against the resource that BACKS this document type, not
    // against the boundary. `vendors` has no project parent and no policy, so
    // it is not scope-resolvable — it is tenant master data reached through the
    // tenant predicate on the query alone, and the capability guard above.
    const resource = DOCUMENT_SOURCE_RESOURCE[docType]
    if (resource !== 'vendors') {
      if (await authorizeRecordScope(principal, resource, String(req.params.id)) === 'REFUSE') {
        res.status(404).json({ error: 'not_found' })
        return
      }
    }

    const doc = await buildAccountingDocument(docType, r.tenantId!, String(req.params.id))
    if (!doc) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ data: doc })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build accounting document', detail: (err as Error).message })
  }
})

// ─── External customer mapping ───────────────────────────────────────────────
//
// A mapping, not a customer master: an external identifier and a descriptive
// label, nothing else. `cost.approve` because choosing which customer a
// project's receivables post against is a commercial authorization, not
// integration plumbing — getting it wrong bills the wrong company.

accountingBoundaryRouter.get('/party/:projectId/:provider', requireCapability('cost.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const provider = String(req.params.provider)
  if (!PROVIDERS.has(provider)) { res.status(400).json({ error: 'unknown_provider', allowed: [...PROVIDERS] }); return }
  try {
    const link = await resolvePartyLink(r.tenantId!, String(req.params.projectId), provider as AccountingProviderId)
    res.json({ data: { projectId: req.params.projectId, provider, link } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to read party mapping', detail: (err as Error).message })
  }
})

accountingBoundaryRouter.put('/party/:projectId/:provider', requireCapability('cost.approve') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const provider = String(req.params.provider)
  const b = req.body as { external_customer_id?: unknown; external_customer_label?: unknown }
  if (!PROVIDERS.has(provider)) { res.status(400).json({ error: 'unknown_provider', allowed: [...PROVIDERS] }); return }
  if (typeof b.external_customer_id !== 'string' || !b.external_customer_id.trim()) {
    res.status(400).json({ error: 'external_customer_id_required' }); return
  }
  try {
    const link = await upsertPartyLink(r.tenantId!, String(req.params.projectId), provider as AccountingProviderId, {
      externalCustomerId: b.external_customer_id.trim(),
      externalCustomerLabel: typeof b.external_customer_label === 'string' ? b.external_customer_label : null,
    }, r.auth?.sub ?? null)
    res.json({ data: link })
  } catch (err) {
    res.status(500).json({ error: 'Failed to map party', detail: (err as Error).message })
  }
})

// ─── Emission ────────────────────────────────────────────────────────────────
//
// `cost.approve`: emitting is the act of putting a figure into the books, and
// the owner decision is that only approved documents may do it. The route
// proves capability and project reach; the service decides whether the FACT is
// emittable, which is the separate question the decisions govern.

accountingBoundaryRouter.post('/emit/:type/:id', requireCapability('cost.approve') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const type = String(req.params.type)
  const provider = String((req.body as { provider?: unknown }).provider ?? '')

  if (!TYPES.has(type)) { res.status(400).json({ error: 'unknown_document_type', allowed: [...TYPES] }); return }
  if (!PROVIDERS.has(provider)) { res.status(400).json({ error: 'unknown_provider', allowed: [...PROVIDERS] }); return }
  const docType = type as AccountingDocumentType

  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }

    const resource = DOCUMENT_SOURCE_RESOURCE[docType]
    if (resource !== 'vendors') {
      if (await authorizeRecordScope(principal, resource, String(req.params.id)) === 'REFUSE') {
        res.status(404).json({ error: 'not_found' }); return
      }
    }

    const outcome = await emitAccountingDocument(r.tenantId!, docType, String(req.params.id), provider as AccountingProviderId)
    if (outcome.emitted) { res.status(202).json({ data: outcome }); return }

    // A refusal is not an error: the document is real and the caller is
    // authorized, but the FACT is not emittable. 409 says "not in this state"
    // rather than 400, which would suggest a malformed request.
    const status = outcome.reason === 'not_found' ? 404 : 409
    res.status(status).json({ error: outcome.reason, detail: outcome.detail, sourceState: outcome.sourceState })
  } catch (err) {
    res.status(500).json({ error: 'Failed to emit document', detail: (err as Error).message })
  }
})

// ─── Visible integration status ──────────────────────────────────────────────

accountingBoundaryRouter.get('/status/:type/:id', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const type = String(req.params.type)
  if (!TYPES.has(type)) { res.status(400).json({ error: 'unknown_document_type', allowed: [...TYPES] }); return }
  const docType = type as AccountingDocumentType

  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }

    const resource = DOCUMENT_SOURCE_RESOURCE[docType]
    if (resource !== 'vendors') {
      if (await authorizeRecordScope(principal, resource, String(req.params.id)) === 'REFUSE') {
        res.status(404).json({ error: 'not_found' }); return
      }
    }
    res.json({ data: await documentIntegrationStatus(r.tenantId!, docType, String(req.params.id)) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to read integration status', detail: (err as Error).message })
  }
})

export default accountingBoundaryRouter
