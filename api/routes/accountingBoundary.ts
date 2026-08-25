/**
 * Denver Engineering — the accounting boundary, read surface
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/integrations/accounting/contract
 *   GET /api/v1/integrations/accounting/outbound/:type/:id
 *
 * Two read-only routes, no writes and no new tables. Their job is to make the
 * boundary inspectable BEFORE a provider is wired up: what Denver would send,
 * what it needs back, and which product decisions are still open.
 *
 * There is deliberately no route that emits a document to a provider. Emission
 * needs a controls decision about which lifecycle transition authorises money
 * moving (see ACCOUNTING_OPEN_DECISIONS.emission-trigger), and guessing it here
 * would be inventing an accounting rule. When that decision exists, emission
 * reuses `enqueueIntegrationJob` — the outbox in migration 044 already gives
 * idempotency, retry, backoff and dead-lettering.
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
import { authorizeRecordScope } from '../authz/recordScope'
import { resolveCurrentUser } from '../authz/currentUser'
import {
  ACCOUNTING_CONTRACT_VERSION, ACCOUNTING_PROVIDERS, ACCOUNTING_DOCUMENT_TYPES,
  ACCOUNTING_ACK_STATES, ACCOUNTING_OPEN_DECISIONS, DOCUMENT_SOURCE_RESOURCE,
  type AccountingDocumentType,
} from '../services/integration/accounting/accountingContract'
import { buildAccountingDocument } from '../services/integration/accounting/accountingProjection'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest

export const accountingBoundaryRouter = Router()
accountingBoundaryRouter.use(requireAuth as never)
accountingBoundaryRouter.use(requireTenant() as never)

const TYPES = new Set<string>(ACCOUNTING_DOCUMENT_TYPES)

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

export default accountingBoundaryRouter
