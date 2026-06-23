# 19 — COMMERCIAL READINESS AUDIT

---

## Executive Summary

Denver Engineering is a **functional product approaching SMB readiness** with targeted gaps preventing immediate enterprise sale. The honest assessment: it can be sold to project-focused engineering firms today with appropriate scope limitations, but needs 4-6 months of hardening before a Fortune 500 construction firm would sign a contract.

---

## SMB Readiness (< 50 users, < 10 projects)

**Current state: 85% ready**

| Requirement | Status | Finding |
|-------------|--------|---------|
| User authentication | ✅ | JWT + bcrypt + MFA-ready |
| Multi-project management | ✅ | Project register, RFIs, submittals |
| Document management | ✅ | Upload, versioning, transmittals |
| Financial tracking | ✅ | Budget, change orders, EVM |
| Task management | ✅ | Action center with SLA |
| AI assistant | ✅ | Ask Jarvis (RAG) — real |
| IoT monitoring | ✅ | Sensor ingest + alerts |
| Mobile support | ❓ | Service layer exists; mobile UI unverified |
| Onboarding flow | ❌ | No guided setup wizard |
| In-app help | 🟡 | Contextual help components found; depth unknown |
| Pricing / billing | ❌ | No subscription management |
| Support ticket system | ❌ | Not implemented |

---

## Enterprise Readiness (> 100 users, > $50M projects)

**Current state: 55% ready**

| Requirement | Status | Finding |
|-------------|--------|---------|
| SSO / SAML / OIDC | ❌ | JWT only; no enterprise IdP integration |
| SCIM user provisioning | ❌ | Manual user creation only |
| Advanced RBAC (custom roles) | 🟡 | 4 fixed roles; no custom permissions |
| Audit log export | ✅ | Audit log with retention (90 days verified) |
| SLA guarantees (uptime) | ❌ | Render SLA: 99.95% on paid plans |
| Data residency options | ❌ | Render US only |
| Custom domain support | ✅ | Render custom domain |
| Enterprise support SLA | ❌ | No support infrastructure |
| Disaster recovery plan | ❌ | No documented DR procedure |
| Penetration test report | ❌ | Not performed |
| SOC 2 compliance | ❌ | Not certified |
| GDPR / data processing agreement | ❌ | Not prepared |
| Contract / MSA template | ❌ | Not available |

---

## Industry-Specific Readiness

### EPC Contractors (Large Projects)

**Score: 62/100**

Suitable for: Medium-scale EPC (< $100M), engineering-heavy projects, WWTP/PWTP commissioning

Missing for large EPC:
- No clash detection in BIM
- No resource leveling in schedule
- No invoicing / billing management
- No Procore/ACC data migration tools

### Water Treatment Plants (PWTP/WWTP)

**Score: 71/100**

Strong: IoT sensor monitoring, commissioning packs, runbooks, process tracking
Weak: No BACnet direct connection, no calibration tracking, no EPA reporting

### General Construction

**Score: 64/100**

Strong: RFIs, submittals, punch lists, daily logs, EVM
Weak: No invoicing, no subcontractor billing, no Procore data import

---

## Pricing Strategy Assessment

**Current:** No pricing mechanism in the codebase. Free to deploy.

**Market benchmarks:**
- Procore: ~$375/user/month (enterprise)
- Autodesk ACC: ~$55/user/month
- Aconex: ~$50-200/user/month
- Emerging competitors: $15-50/user/month

**Recommended positioning for Denver Engineering:**
- Phase 1 (Now): $25-50/user/month for SMB (1-50 users) — undercutting Procore while delivering real EVM + AI
- Phase 2 (6 months): $75-150/user/month for mid-market with enterprise features added
- Special: IoT/WWTP vertical pricing at $500-1,000/site/month

**Commissioning pack credits:** Novel monetization — charge per AI-generated commissioning pack. Existing credit system supports this.

---

## Go-to-Market Gaps

### Critical Gaps for First Sale

1. **Terms of Service + Privacy Policy** — legally required, not found in codebase
2. **Data processing agreement (DPA)** — required for EU customers
3. **Invoice + billing** — no way to charge customers
4. **Customer support channel** — no ticketing, no help desk
5. **Status page** — no public incident communication
6. **Documentation site** — no user-facing help docs (APP_OVERVIEW.md is internal)

### Marketing Claim Accuracy

| Claimed Feature | Reality | Accuracy |
|-----------------|---------|---------|
| AI-powered platform | ✅ Real RAG + AI generation | Accurate |
| Predictive analytics | ⚠️ Linear regression, not ML | Overstated |
| BACnet integration | ❌ Framework only | False |
| QuickBooks integration | ❌ Framework only | False |
| Clash detection | ❌ Not implemented | False |

**Recommendation:** Audit all marketing materials against this list before publishing. Three features are listed that don't exist.

---

## Unique Value Propositions (Defensible)

1. **AI Commissioning Pack Generation** — No competitor offers AI-generated PWTP/WWTP commissioning packs. This is genuinely unique.

2. **Fix Library (AI pattern mining)** — Auto-extraction of fix patterns from deficiency history. Unique in the construction software space.

3. **IoT + EVM + BIM in one platform** — Most competitors require separate tools for each. Denver Engineering unifies them with a shared data model.

4. **Ask Jarvis** — Project-scoped RAG over engineering knowledge. Procore has no equivalent.

5. **Business-hours SLA engine** — More sophisticated than most competitors' task management.

---

## Commercial Readiness Score: 58/100

**SMB selling today:** ✅ Possible with appropriate scope scoping  
**Enterprise selling today:** ❌ SSO, SOC 2, DPA, and DR plan required first  
**Honest timeline to enterprise readiness:** 6-9 months  
**Honest timeline to first SMB revenue:** 2-3 months (with billing + TOS added)
