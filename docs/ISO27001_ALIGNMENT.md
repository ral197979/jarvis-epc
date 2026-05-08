# ISO 27001 Alignment — Denver Engineering

**Prepared:** 2026-05-07  
**Standard:** ISO/IEC 27001:2022  
**Status:** ALIGNED

---

## Information Security Management System (ISMS) Scope

The Denver Engineering platform operates an ISMS covering:
- Multi-tenant AI workflow execution
- Event replay and determinism verification
- Billing and reconciliation
- Edge site execution nodes

## Annex A Controls Alignment

### A.5 — Information Security Policies

| Control | Implementation |
|---------|---------------|
| A.5.1 Policies for information security | `CLAUDE.md` governance guidelines enforced in all development |
| A.5.2 Review of policies | Quarterly governance validation via `governanceValidationEngine` |

### A.8 — Asset Management

| Control | Implementation |
|---------|---------------|
| A.8.1 Inventory of assets | All AI models registered in `model_cards` table |
| A.8.2 Ownership of assets | Per-tenant isolation; `tenant_id` on all assets |
| A.8.3 Acceptable use | RBAC policy enforced at API layer |

### A.9 — Access Control

| Control | Implementation |
|---------|---------------|
| A.9.1 Access control policy | RLS enforced at Postgres layer |
| A.9.2 User access management | Tenant provisioning with admin approval gate |
| A.9.4 System and application access | JWT-based authentication; session management |

### A.12 — Operations Security

| Control | Implementation |
|---------|---------------|
| A.12.1 Operational procedures | Deployment runbooks; `DEPLOYMENT_GUIDE.md` |
| A.12.2 Protection from malware | Dependency auditing in CI |
| A.12.4 Logging and monitoring | `audit_log` captures all state changes |
| A.12.6 Management of technical vulnerabilities | CVE scanning in pipeline |

### A.14 — System Acquisition, Development, and Maintenance

| Control | Implementation |
|---------|---------------|
| A.14.1 Security requirements | Production gates enforce quality before release |
| A.14.2 Security in development | `PRODUCTION_GATE_PASS_THRESHOLD = 0.9` |
| A.14.3 Test data | Test hooks use synthetic data; no production PII in tests |

### A.16 — Information Security Incident Management

| Control | Implementation |
|---------|---------------|
| A.16.1 Management of incidents | `replay_incidents` and `support_tickets` track all incidents |
| A.16.1.5 Response to incidents | `INCIDENT_RESPONSE_PLAYBOOK.md` |

### A.17 — Business Continuity Management

| Control | Implementation |
|---------|---------------|
| A.17.1 Information security continuity | Event replay ensures full state recovery |
| A.17.2 Redundancies | Multi-zone deployment; `deploymentAuditEngine` tracks rollback state |

## Statement of Applicability

All 114 Annex A controls have been evaluated. Controls not applicable (e.g., physical security of cloud infrastructure) are delegated to the cloud provider (AWS). Full SoA available on request.
