# 22 — IMPLEMENTATION ROADMAP
## Prioritized by ROI and Risk Reduction

---

## Roadmap Principles

1. **Security first** — P1 items block enterprise deals and represent real risk
2. **Revenue enablement second** — Features needed to charge for the product
3. **Competitive parity third** — Close the gap on Procore/ACC in specific segments
4. **AI differentiation fourth** — Strengthen what makes Denver Engineering unique

---

## Phase 1 — Security Hardening (Weeks 1–4)
**Goal: Remove all P1 blockers**

| Item | Effort | Priority | Impact |
|------|--------|----------|--------|
| Run RLS audit SQL; add missing policies to ~11 tables | 2 days | P1-A | Tenant isolation complete |
| Remove X-Tenant-ID header fallback in requireTenant() | 30 min | P1-B | Footgun removed |
| Add rate limit (5/hour/IP) on POST /api/v1/tenants | 1 hour | P1-C | Spam protection |
| Wrap multi-step operations in transactions (top 5) | 3 days | P1-D | Data integrity |
| Replace readFileSync with readFile in IFC worker | 2 hours | P1-E | HTTP availability |
| Per-IP login rate limiting via Redis | 4 hours | P2-A | Brute force protection |
| Redact AI gateway error messages in production | 1 hour | P2-B | Info disclosure |

**Phase 1 Deliverable:** Platform passes basic security review.

---

## Phase 2 — Revenue Enablement (Weeks 5–8)
**Goal: Ability to charge customers**

| Item | Effort | Priority | Rationale |
|------|--------|----------|-----------|
| Add Terms of Service + Privacy Policy pages | 3 days | Must | Legal requirement |
| Billing/subscription system (Stripe) | 2 weeks | Must | Need to charge customers |
| Email notification delivery (SendGrid) | 3 days | High | Complete TODO in notificationWorker |
| Customer support channel (Crisp/Intercom) | 2 days | High | Support enterprise trials |
| Status page (Betterstack/UptimeRobot) | 1 day | High | Trust signal |
| Upgrade Redis to 500MB plan | 30 min | Must | Render free plan insufficient |
| Add Sentry error tracking | 2 hours | High | Know about production errors |
| External uptime monitor | 1 hour | High | Before users report outages |

**Phase 2 Deliverable:** Platform can legally accept paying customers.

---

## Phase 3 — Performance & Reliability (Weeks 9–12)
**Goal: Support 100+ concurrent users reliably**

| Item | Effort | Priority | Rationale |
|------|--------|----------|-----------|
| Add missing indexes (sensor_readings, actions, evm_actuals, chat_messages) | 1 day | High | Query performance at scale |
| Redis caching for EVM metrics (5-min TTL) | 2 days | Medium | Reduce DB load |
| Move IFC parse to worker_threads | 3 days | High | Event loop protection |
| Distributed locking for background workers | 3 days | High | Prevents duplication on 2nd instance |
| Add DB ping to health check | 2 hours | Medium | Accurate health reporting |
| sensor_readings time-series retention policy | 1 day | Medium | Prevent unbounded table growth |
| Deepen health check (DB + Redis liveness) | 4 hours | Medium | Operational visibility |

**Phase 3 Deliverable:** Platform survives 100 concurrent users; no event loop blocking.

---

## Phase 4 — Enterprise Features (Months 3–4)
**Goal: Win first enterprise deal**

| Item | Effort | Priority | Customer Need |
|------|--------|----------|--------------|
| SSO / SAML 2.0 (OneLogin, Okta, Azure AD) | 3 weeks | Critical | Enterprise IT requirement |
| SCIM user provisioning | 2 weeks | High | IT wants automated onboarding |
| Custom RBAC (configurable permissions) | 2 weeks | Medium | Enterprise org structures |
| Data export / backup download | 1 week | High | Data ownership requirement |
| Staging environment | 1 day | High | Before enterprise trials |
| Penetration test | 2 weeks | High | Enterprise procurement asks |
| AI cost monitoring + monthly cap | 3 days | High | Cost control |

**Phase 4 Deliverable:** Platform passes enterprise procurement checklist.

---

## Phase 5 — Feature Gaps (Months 5–6)
**Goal: Close competitive gaps in target segments**

### EPC / Construction Segment

| Item | Effort | Competitive Impact |
|------|--------|-------------------|
| EVM formula tests (unit tests) | 2 days | Risk reduction on most critical service |
| Budget versioning (revisions) | 1 week | Procore parity |
| Subcontractor invoicing / pay apps | 3 weeks | Critical for GC workflows |
| RFI ball-in-court tracking | 1 week | Procore parity |
| Spec section mapping for submittals | 1 week | Procore parity |

### PWTP/WWTP Segment

| Item | Effort | Competitive Impact |
|------|--------|-------------------|
| Sensor calibration tracking | 1 week | Regulatory requirement |
| Automated report generation (daily/weekly ops) | 2 weeks | Replaces Excel reports |
| BACnet HTTP bridge configuration guide | 3 days | Enables field deployment |
| sensor_readings data retention UI | 3 days | Data management |

### AI Differentiation

| Item | Effort | Competitive Impact |
|------|--------|-------------------|
| Confidence threshold on RAG retrieval | 3 days | Reduces hallucination |
| "I don't know" instruction in system prompt | 1 day | AI honesty |
| AI governance UI (approval queue) | 1 week | Enterprise AI oversight |
| Replace Math.random() in CrossProjectHeatmap | 3 days | Real portfolio analytics |
| Upgrade Predict service with ML (scikit-learn via API) | 4 weeks | Honest AI marketing claim |

---

## Phase 6 — Integration Layer (Months 7–12)
**Goal: Real connectors, not framework stubs**

| Integration | Effort | Customer Demand |
|------------|--------|----------------|
| QuickBooks Online | 3 weeks | High (SMB finance) |
| Email (SendGrid/SES) | 1 week | Must-have |
| Slack | 2 weeks | High (notifications) |
| BACnet via Telegraf guide | 1 week | WWTP customers |
| Procore data import | 4 weeks | Customer migration |
| P6 schedule import | 2 weeks | EPC contractors |
| Microsoft Teams | 2 weeks | Enterprise customers |

---

## ROI Priority Matrix

```
HIGH IMPACT / LOW EFFORT:
  ✦ Remove X-Tenant-ID fallback (30 min)
  ✦ Add Redis upgrade ($10/month)
  ✦ Add Sentry (free tier, 2 hours)
  ✦ Add uptime monitor (free, 1 hour)
  ✦ Email delivery (3 days)
  ✦ EVM unit tests (2 days)
  ✦ Fix "I don't know" in AI system prompt (1 day)

HIGH IMPACT / HIGH EFFORT:
  ✦ SSO/SAML (3 weeks) — unlocks enterprise sales
  ✦ Billing (2 weeks) — generates revenue
  ✦ QuickBooks integration (3 weeks) — closes SMB deals
  ✦ Subcontractor invoicing (3 weeks) — GC prerequisite

LOW IMPACT / HIGH EFFORT:
  — Clash detection (8+ weeks) — needed only for BIM-heavy projects
  — SAP/Oracle integration — niche, high-complexity
```

---

## Timeline Summary

| Phase | Weeks | Focus | Milestone |
|-------|-------|-------|-----------|
| 1 | 1–4 | Security hardening | P1 items resolved |
| 2 | 5–8 | Revenue enablement | First paying customer possible |
| 3 | 9–12 | Performance | 100+ user stability |
| 4 | 13–16 | Enterprise features | SSO + first enterprise trial |
| 5 | 17–24 | Feature gaps | Segment-specific completeness |
| 6 | 25–52 | Integrations | QuickBooks, Slack, Procore import |

**Estimated engineering capacity needed:** 2-3 full-stack engineers for this roadmap.
