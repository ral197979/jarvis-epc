# Integration Marketplace Spec — Denver Engineering

> Phase 13. v1, grounded in `api/routes/{integrations,integrationHub}`, `api/services/integration*`,
> `webhookDispatch`, and the existing quickbooks/slack/teams connectors.

## 1. Current state
- ✅ Integration hub + webhook delivery (`/api/v1/integrations`, `/integrations/hub`, `webhookDispatch`).
- ✅ Connectors: **QuickBooks, Slack, Teams** (`api/services/integration/*` + tests).
- ✅ Data-warehouse exports (`/api/v1/exports`).
- ❌ The must-have construction connectors below.

## 2. Required connectors (priority)
| Connector | Direction | Why it wins evals |
|---|---|---|
| **Primavera P6** | import/2-way schedule | enterprise schedule source of truth |
| **Microsoft Project** | import/2-way | mid-market schedule |
| **Procore** | migrate/sync | rip-and-replace + coexistence |
| **Autodesk Construction Cloud** | docs/BIM | design↔construction |
| **Oracle Aconex** | document control | doc migration |
| **Oracle Unifier** | cost/PM | enterprise cost |
| **SharePoint** | documents | owner doc stores |
| **Bluebeam** | markups | drawing review |
| **SAP / Oracle ERP** | cost/PO | enterprise finance |
| **Maximo / ServiceNow** | assets/ITSM | handover/ops |
| **Power BI** | analytics export | exec reporting |

## 3. Architecture
- **Connector SDK:** typed contract (`auth`, `pull`, `push`, `mapSchema`, `webhook`) — generalize the existing connector pattern.
- **Sync engine:** scheduled + webhook-driven (`integrationSync`, `webhookDispatch`); idempotent, per-tenant credentials in a secrets store; field mapping + conflict policy per connector.
- **Object mapping:** external entities map into the Denver object graph (DOMAIN_MODEL), preserving provenance for audit.
- **Marketplace:** install/configure per tenant, scopes, health/last-sync status, partner-publishable via the Third-Party Agent SDK.

## 4. Acceptance criteria
P6/MSP round-trip a schedule without data loss; Procore/Aconex migration imports projects+docs with provenance; SAP/ERP commitments reconcile to cost; all syncs auditable with health + retry (dead-letter already exists for notifications).
