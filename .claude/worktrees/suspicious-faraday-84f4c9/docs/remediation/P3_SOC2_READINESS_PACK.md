# P3 — SOC 2 Type II Readiness Pack

**Gap class:** PARITY → LEAD
**Release slot:** v4.33.0
**Competitive reference:** Every top-5 competitor holds SOC 2; parity is now expected by procurement
**Status:** DRAFT — awaiting owner approval

---

## Scope

This readiness pack assembles the policy binder, control-evidence checklist, and gap register needed to engage a SOC 2 Type II auditor. It does **not** include auditor engagement itself, which is an external step requiring budget approval.

Secondary objective: ISO 27001 Annex A gap assessment (documentation only; formal certification out of scope for 90 days).

---

## Trust Service Criteria in scope

For SOC 2 Type II, JARVIS EPC will target the following TSCs:

| TSC | Status | Notes |
|---|---|---|
| Security (common criteria) | **In scope** | Table stakes |
| Availability | **In scope** | SaaS uptime commitment |
| Confidentiality | **In scope** | Customer project data is confidential |
| Processing Integrity | Deferred | Add in future audit |
| Privacy | Deferred | Add when handling PII beyond auth data |

---

## Policy binder (required)

Each policy is a standalone Markdown document under `docs/policies/`. All six policies follow the same template: Purpose · Scope · Policy Statements · Roles & Responsibilities · Exceptions · Review cadence · Owner approval.

| Policy | File (proposed) | Owner | Review cadence |
|---|---|---|---|
| Access Control Policy | `docs/policies/access-control.md` | Rommel | Annual |
| Change Management Policy | `docs/policies/change-management.md` | Rommel | Annual |
| Incident Response Policy | `docs/policies/incident-response.md` | Rommel | Annual |
| Business Continuity & Disaster Recovery Policy | `docs/policies/bcdr.md` | Rommel | Annual |
| Vendor Management Policy | `docs/policies/vendor-management.md` | Rommel | Annual |
| Data Classification Policy | `docs/policies/data-classification.md` | Rommel | Annual |

Templates for each will be produced on approval of this spec. Each policy is ~400–800 words; together they total ~4,000 words.

---

## Control-evidence checklist

Maps each relevant control to the artifact in the repo that proves it.

| Control | Where evidence lives today | Status | Remediation |
|---|---|---|---|
| CC1.1 — Board / owner oversight | `REMEDIATION_ROADMAP.md`, owner checkpoints | ✅ In place | — |
| CC1.4 — Hiring + background checks | N/A (solo owner) | N/A | Waive — document as such |
| CC2.1 — Security awareness training | Missing | 🔴 Gap | Add annual training record; one-page policy + self-attestation |
| CC3.1 — Risk assessment | Implicit in audits | 🟡 Partial | Annual formal risk register doc |
| CC4.1 — Monitoring | `api/modules/observability`, `pino` logs | ✅ In place | Document retention policy |
| CC5.1 — Change management | PR-based git workflow, CI gates | ✅ In place | Formalize change log review policy |
| CC6.1 — Logical access | bcrypt + JWT + RBAC + RLS | ✅ In place | Document key rotation cadence |
| CC6.6 — Access removal | Redis kill switch, JWT revocation | ✅ In place | Document off-boarding checklist |
| CC6.7 — Data encryption in transit | HTTPS everywhere via nginx | ✅ In place | Certificate auto-renewal procedure |
| CC6.8 — Data encryption at rest | Database disk encryption + S3 KMS | 🟡 Partial | Document encryption posture per storage backend |
| CC7.1 — Vulnerability monitoring | `npm audit` in CI | 🟡 Partial | Add Dependabot / Renovate config |
| CC7.2 — Security incident response | No formal runbook yet | 🔴 Gap | Runbook doc (part of Incident Response Policy) |
| CC7.3 — Backups | No formal policy | 🔴 Gap | Postgres backup schedule, retention, restore test |
| CC7.4 — BCDR | No formal policy | 🔴 Gap | BCDR policy + annual tabletop exercise record |
| CC8.1 — Change authorization | PR review required on protected branches | ✅ In place | Document branch-protection config |
| CC9.1 — Business continuity | No formal policy | 🔴 Gap | Absorbed into BCDR |
| A1.1 — Availability commitments | No published SLA | 🟡 Partial | Internal SLA + status page plan |
| A1.2 — Availability monitoring | Pino + health checks | ✅ In place | Document alerting rules |
| C1.1 — Data confidentiality classification | Missing | 🔴 Gap | Data Classification Policy |

---

## Gap register

| # | Gap | Severity | Owner | Remediation action |
|---|---|---|---|---|
| GAP-01 | No security awareness training record | Medium | Rommel | Draft 1-page AUP + annual self-attestation form |
| GAP-02 | No formal risk register | Medium | Rommel | Maintain `docs/policies/risk-register.md`; review quarterly |
| GAP-03 | No incident response runbook | High | Rommel | Use `engineering:incident-response` skill to author; reference in IR Policy |
| GAP-04 | No Postgres backup / restore policy | High | Rommel | Document pg_dump schedule, S3 retention, annual restore drill |
| GAP-05 | No BCDR tabletop exercise record | Medium | Rommel | Run annual tabletop; record transcript; remediate findings |
| GAP-06 | No Data Classification Policy | Medium | Rommel | 1-page policy (Public / Internal / Confidential / Restricted) |
| GAP-07 | `npm audit` alone insufficient for CVE tracking | Low | Rommel | Add Dependabot or Renovate to `.github/` |
| GAP-08 | Encryption-at-rest not documented | Low | Rommel | Add posture doc to policy binder |
| GAP-09 | No public SLA / status page | Low | Rommel | Draft SLA; evaluate hosted status page (e.g., Statuspage.io) |

---

## Auditor selection

Three options, decision required before engagement:

| Vendor | Strengths | Indicative cost (Type II, first year) | Notes |
|---|---|---|---|
| Vanta | Fastest time-to-audit; lots of pre-built integrations | $18k–$35k |  Comprehensive automation |
| Drata | Strong continuous monitoring; good UX | $15k–$30k | Similar scope to Vanta |
| Secureframe | Hands-on readiness support | $20k–$40k | White-glove service model |

Direct-to-auditor (no readiness tool) is cheaper but takes 2-3x longer and offers less continuous monitoring.

**Recommendation:** Vanta or Drata — owner decides on demo. Budget reserves should include **auditor fees separately** (~$10k–$20k for the Type II report itself in year one).

---

## Annual cadence

Post-certification, the following cadence sustains the attestation:

| Cadence | Activity |
|---|---|
| Quarterly | Risk register review |
| Quarterly | Access review (who has what role) |
| Annually | Policy binder review + re-approval |
| Annually | Tabletop exercise (IR + BCDR) |
| Annually | Penetration test |
| Continuously | Vulnerability scan (via readiness tool) |
| Continuously | Change management (every PR is evidence) |

---

## ISO 27001 gap assessment (scoping only)

JARVIS EPC's existing controls align well with ISO 27001 Annex A. A formal certification is out of 90-day scope, but the following docs overlap:

| ISO 27001 domain | SOC 2 evidence that satisfies |
|---|---|
| A.5 Information security policies | Policy binder |
| A.6 Organization | Owner-First governance model |
| A.7 HR security | GAP-01 once closed |
| A.8 Asset management | Data Classification Policy |
| A.9 Access control | CC6.x controls |
| A.10 Cryptography | CC6.7 + CC6.8 |
| A.11 Physical security | SaaS/cloud — cloud-provider attestation |
| A.12 Operations security | CC4.x + CC5.x |
| A.13 Communications | HTTPS + webhook HMAC |
| A.14 System development | CC8.1 + CI gates |
| A.15 Supplier relationships | Vendor Management Policy |
| A.16 Incident management | Incident Response Policy |
| A.17 BCP | BCDR Policy |
| A.18 Compliance | Annual review cadence |

Recommendation: pursue ISO 27001 after SOC 2 Type II report issued.

---

## Acceptance criteria

- [ ] All 6 policies drafted and owner-approved
- [ ] Control-evidence checklist complete; all ✅ and 🟡 items documented
- [ ] All 🔴 gaps closed (GAP-01 through GAP-06 required; GAP-07/08/09 advisory)
- [ ] Readiness tool selected (Vanta / Drata / Secureframe) and onboarded
- [ ] Internal pre-audit gap scan complete with 0 critical findings
- [ ] Auditor engagement letter signed
- [ ] Type II observation period begins (min 3 months, typical 6)

---

## Effort estimate

| Slice | Days |
|---|---|
| 6 policy drafts | 3 |
| Gap remediation (GAP-01 through GAP-06) | 6 |
| Readiness tool onboarding | 1 |
| Internal pre-audit gap scan | 1 |
| Evidence collection + documentation | 1 |
| **Total** | **12 days (documentation-heavy)** |

Plus elapsed time for the Type II observation window itself (3–6 months) — runs in background after observation period begins.

---

## Owner approval

- [ ] **Approved** — proceed with policy binder + gap closure
- [ ] **Approved** — also approve readiness tool selection: ______________
- [ ] **Approved** — also approve auditor budget ceiling: $______________
- [ ] **Approved with adjustments:** __________
- [ ] **Rejected** — reason: __________
- [ ] **Deferred** — re-review at date: ______________

Signed: _________________________  Date: _______________
