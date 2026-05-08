# Denver Engineering — Implementation Roadmap

**Version:** v4.32.0  
**Date:** 2026-05-06  
**Classification:** Internal Product Strategy  
**Horizon:** 12 months (5 phases)

---

## Roadmap Philosophy

Each phase is designed to be independently shippable and immediately valuable. Phases do not need to complete fully before the next begins — each phase has a clear "minimum shippable" milestone that unlocks user value.

**Phase sequencing logic:**
- **Phase 1** closes the gaps that block real project use today.
- **Phase 2** adds AI leverage on top of a working data foundation.
- **Phase 3** extends the platform to the field (where most data originates).
- **Phase 4** enables portfolio-level visibility and external system integration.
- **Phase 5** hardens the platform for enterprise security and compliance audit.

**Effort unit:** Story points (SP). 1 SP ≈ 1 engineering day (full-stack including tests).

---

## Phase 1 — Critical Workflow Closure

**Target:** 8 weeks  
**Theme:** Make the platform usable for a real, live project from day one.  
**Minimum Shippable:** Global Action Center + SLA Engine + Approval Delegation

---

### Phase 1 Stories

#### 1.1 · Global Action Center

**Priority:** P0  
**Effort:** 13 SP  
**Owner:** Full-stack engineer

**Stories:**
- [ ] Design aggregation query: `user_action_items` view joining all 12 actionable entity tables on `assigned_to = current_user AND status IN (actionable states)` (3 SP)
- [ ] Implement `/api/actions/mine` endpoint returning paginated, sorted action items (2 SP)
- [ ] Build `ActionCenterView` component: list with module icon, record title, due date, priority badge, one-click navigation (4 SP)
- [ ] Add unread count badge to nav sidebar — updates on action item change (2 SP)
- [ ] Add "Action Center" as a fixed top nav item visible in all roles (1 SP)
- [ ] Add Action Center filter controls: by module, by project, by due date (1 SP)

**Acceptance Criteria:**
- All items assigned to current user across all 12 modules visible in one view.
- Sorted: overdue → due today → due this week → future.
- Badge count on sidebar reflects live total (no stale cache > 60 seconds).
- One-click navigation to each item's detail view.
- Zero false positives (no completed/closed items appear).

---

#### 1.2 · SLA Escalation Engine

**Priority:** P0  
**Effort:** 16 SP  
**Owner:** Backend engineer + full-stack (notifications)

**Stories:**
- [ ] Create `sla_rules` table: `(tenant_id, module, warn_days_before, escalate_days_after, notify_supervisor, notify_pm, notify_owner)` (2 SP)
- [ ] Create `sla_escalations` table: append-only log of escalation events per entity (2 SP)
- [ ] Generalize `complianceWatcher` into a universal `slaWatcher` service that reads `sla_rules` per module (4 SP)
- [ ] Apply slaWatcher to: RFIs, Submittals, Punch Items, Inspections, Deficiencies (3 SP)
- [ ] In-app notification delivery for SLA warnings and escalations (3 SP)
- [ ] Admin UI to configure SLA rules per project per module (2 SP)

**Acceptance Criteria:**
- Level-1 warning fires automatically N days before due (configurable).
- Level-2 escalation fires if no action taken within M days of overdue (configurable).
- Escalation history in audit log.
- No escalations on items in terminal state.
- SLA breach rate KPI visible in project health view.

---

#### 1.3 · Approval Delegation

**Priority:** P0  
**Effort:** 10 SP  
**Owner:** Backend engineer

**Stories:**
- [ ] Create `delegation_rules` table: `(delegator_user_id, delegate_user_id, module, start_date, end_date, created_by)` (2 SP)
- [ ] Implement `resolveEffectiveApprover(user_id, module, date)` utility — checks for active delegation (2 SP)
- [ ] Update all approval route handlers to use `resolveEffectiveApprover` (POs, submittals, COs, daily logs, compliance tasks) (3 SP)
- [ ] UI: Delegation management screen in user settings (2 SP)
- [ ] Delegated approvals tagged `delegated_from` in audit log (1 SP)

**Acceptance Criteria:**
- Delegation configurable per user, per module, per date range.
- Active delegation routes all approval requests to delegate.
- Both delegator and delegate notified.
- Circular delegation rejected at creation.
- `delegated_from` field in audit log on all delegated approvals.

---

#### 1.4 · CDE Transmittal Acknowledgment Workflow

**Priority:** P0  
**Effort:** 8 SP  
**Owner:** Full-stack engineer

**Stories:**
- [ ] Add `status`, `acknowledged_at`, `acknowledged_by`, `query_text` fields to `transmittals` table (migration) (1 SP)
- [ ] New transmittal status lifecycle: `sent → acknowledged → queried → resolved` (1 SP)
- [ ] Generate tokenized acknowledgment link on transmittal send (2 SP)
- [ ] Public acknowledgment endpoint (no auth required, token-scoped) (2 SP)
- [ ] Transmittal list shows acknowledgment status per recipient (1 SP)
- [ ] Overdue ACKs surface in Action Center (1 SP)

**Acceptance Criteria:**
- Recipient can acknowledge via tokenized link without platform account.
- Acknowledgment timestamp and comment stored, immutable.
- Overdue ACKs (> N days) in Action Center.
- Full transmittal chain exportable as PDF.

---

#### 1.5 · Project Health Score

**Priority:** P0  
**Effort:** 12 SP  
**Owner:** Backend engineer + full-stack

**Stories:**
- [ ] Define scoring formula: 5 dimensions (schedule, cost, quality, safety, compliance), weighted (2 SP)
- [ ] Implement `computeHealthScore(project_id)` service function using existing EVM, safety, compliance, RFI data (4 SP)
- [ ] Extend `kpiSnapshot` job to store daily health score per project (2 SP)
- [ ] Health score widget on project list and project detail (2 SP)
- [ ] Score dimension breakdown panel (drill-down) (1 SP)
- [ ] 30/60/90 day trend chart (1 SP)

**Acceptance Criteria:**
- Score 0–100, range-banded: Red (0–59), Amber (60–79), Green (80–100).
- Score delta vs prior week shown.
- Dimension breakdown on drill-down.
- Score history chart (30/60/90 days).
- Score computed daily via kpiSnapshot job.

---

#### 1.6 · Drawing → RFI / Punch Workflow

**Priority:** P1  
**Effort:** 6 SP  
**Owner:** Full-stack engineer

**Stories:**
- [ ] Add `drawing_id`, `drawing_revision`, `sheet_number` FK columns to `rfis` and `punch_items` tables (1 SP)
- [ ] "Raise RFI" and "Raise Punch" actions on Drawing sheet detail view — pre-fill drawing_ref fields (3 SP)
- [ ] Drawings list shows open RFI count and open punch count per sheet (1 SP)
- [ ] Back-link on RFI/punch detail: "Drawing Reference: Sheet [N] Rev [X]" (1 SP)

**Acceptance Criteria:**
- One-click raise from drawing to RFI or punch.
- Pre-populated drawing context on created record.
- Drawing shows count of linked open items.
- Back-link from RFI/punch to drawing.

---

#### 1.7 · BIM Issue → RFI / Submittal / Punch Conversion

**Priority:** P1  
**Effort:** 5 SP  
**Owner:** Full-stack engineer

**Stories:**
- [ ] Add `source_bim_issue_id` FK to `rfis`, `submittals`, `punch_items` tables (1 SP)
- [ ] "Convert" action on BIM issue: choose target type, pre-fill from BIM issue data (2 SP)
- [ ] BIM issue shows linked child record badge (1 SP)
- [ ] BIM issue auto-closes when linked record reaches terminal state (1 SP)

**Acceptance Criteria:**
- Convert action available on any open BIM issue.
- Source BIM issue ID shown on converted record.
- BIM issue auto-closes on linked record closure.

---

#### 1.8 · In-App Notifications

**Priority:** P1  
**Effort:** 10 SP  
**Owner:** Full-stack engineer

**Stories:**
- [ ] Create `notifications` table: `(user_id, tenant_id, title, body, module, record_id, read_at, created_at)` (2 SP)
- [ ] Notification bell in nav header with unread count (2 SP)
- [ ] Notification panel (dropdown list, most recent 20) (2 SP)
- [ ] Wire SLA escalations, approval requests, and delegation events to notification system (2 SP)
- [ ] Mark-all-read action (1 SP)
- [ ] Email digest fallback (daily summary email of unread notifications) — requires email integration (1 SP)

**Acceptance Criteria:**
- Notification bell shows unread count.
- All SLA escalations and approval requests generate in-app notification.
- Panel clears unread count on open.
- Email digest sent daily for users with unread notifications.

---

**Phase 1 Total Effort:** ~80 SP (~8 weeks, 1–2 engineers)

**Phase 1 Gate:** All P0 stories accepted. At least 1 live project actively using the platform with no workarounds for the above workflows.

---

## Phase 2 — AI Automation Layer

**Target:** 6 weeks (runs in parallel with Phase 1 tail)  
**Theme:** Make Jarvis AI useful on every module, not just Ask Jarvis.  
**Minimum Shippable:** Daily log auto-summary + RFI response drafting + document ingestion quality scoring

---

### Phase 2 Stories

#### 2.1 · Daily Log Auto-Summary

**Effort:** 8 SP

- [ ] Scheduled job: collect all submitted/approved logs for the day at configurable cutoff (2 SP)
- [ ] Claude API call with structured log data → produce project-level daily summary (2 SP)
- [ ] PM review and approval UI (inline editing + explicit approve) (2 SP)
- [ ] Approved summary stored as CDE document in WIP state (1 SP)
- [ ] PM notification when draft is ready for review (1 SP)

**Acceptance Criteria:** Summary generated nightly. PM reviews and approves. Stored in CDE. Zero auto-publish.

---

#### 2.2 · RFI Response Draft Generator

**Effort:** 8 SP

- [ ] On RFI entering `pending` state, trigger Knowledge Base retrieval for RFI subject + question text (2 SP)
- [ ] If confidence > 0.75, generate draft response via Claude (2 SP)
- [ ] Show draft inline in RFI detail: "Jarvis draft — review and confirm" (2 SP)
- [ ] Engineer edits and explicitly submits (1 SP)
- [ ] Log AI generation: model, tokens, confidence (1 SP)

**Acceptance Criteria:** Draft only when confidence > 0.75. Engineer must submit explicitly. Audit log records AI generation.

---

#### 2.3 · Document Ingestion Quality Scoring

**Effort:** 5 SP

- [ ] Post-ingest job: sample 20 chunks from each new source (1 SP)
- [ ] Claude haiku-4-5: evaluate readability, completeness, density → quality score (2 SP)
- [ ] Quality score stored on `knowledge_sources` record (1 SP)
- [ ] Quality score shown in Knowledge Base list with color coding; `poor` sources flagged with warning (1 SP)

**Acceptance Criteria:** Score computed within 2 minutes of ingest. Poor sources flagged. Score visible in KB source list.

---

#### 2.4 · Jarvis Contextual Project Scoping

**Effort:** 6 SP

- [ ] Detect current project context when user is in a project view (1 SP)
- [ ] Inject `project_id` as retrieval filter in Ask Jarvis sessions (2 SP)
- [ ] Citations labeled: "[Project Document]" vs "[General KB]" (1 SP)
- [ ] Toggle to disable project scoping (1 SP)
- [ ] Project context shown in session header (1 SP)

**Acceptance Criteria:** Project-scoped sessions return project-specific citations first. User can toggle off.

---

#### 2.5 · Commissioning Readiness Dashboard

**Effort:** 13 SP

- [ ] Design aggregation query: readiness per system (test pack %, punch A/B, open RFIs, compliance, inspections) (3 SP)
- [ ] CommissioningReadinessDashboard component: system list with Go/No-Go indicator and blocking items (5 SP)
- [ ] Go/No-Go logic: configurable rules per project (e.g., all A-punch cleared = required) (2 SP)
- [ ] PDF export of readiness report (2 SP)
- [ ] Direct links from blocking items to their source records (1 SP)

**Acceptance Criteria:** Go/No-Go per system computed automatically. PDF export. Blocking items linked. Real-time on data change.

---

#### 2.6 · AI Punch Item Standardizer

**Effort:** 4 SP

- [ ] On punch item description entry, call Claude haiku-4-5 to suggest standardized format (2 SP)
- [ ] Suggestion shown inline; user accepts or dismisses (1 SP)
- [ ] Accepted suggestions tagged `ai_standardized = true` (1 SP)

**Acceptance Criteria:** Suggestion non-blocking. User controls acceptance. No auto-change.

---

#### 2.7 · JHA Auto-Draft Generator

**Effort:** 8 SP

- [ ] "Generate JHA Draft" button in JHA creation view (1 SP)
- [ ] User inputs work description; Claude generates task steps, hazards, controls (3 SP)
- [ ] JHA draft displayed in editable table (2 SP)
- [ ] Safety officer reviews and explicitly approves (1 SP)
- [ ] Draft labeled "AI Draft — Requires Safety Officer Review" (1 SP)

**Acceptance Criteria:** Draft in < 20 seconds. Uses recognized control hierarchy. Explicit approval required. No auto-publish.

---

#### 2.8 · Weekly Project Status Report Generator

**Effort:** 8 SP

- [ ] "Generate Weekly Report" trigger in project view (1 SP)
- [ ] Assemble project data: EVM, milestones, RFIs, submittals, punch, safety, schedule (2 SP)
- [ ] Claude generates structured report (executive summary, 6 sections) (2 SP)
- [ ] Report displayed in editable rich text view (2 SP)
- [ ] PM publishes → stored in CDE as Shared S3 document (1 SP)

**Acceptance Criteria:** Generated in < 60 seconds. Accurate (no fabrication). Editable. PM explicitly publishes.

---

**Phase 2 Total Effort:** ~60 SP (~6 weeks, 1–2 engineers, partly parallel with Phase 1 tail)

**Phase 2 Gate:** AI features used by at least 3 active users on at least 1 live project. AI call audit log populated and cost-per-feature measurable.

---

## Phase 3 — Field, Mobile & Offline Readiness

**Target:** 8 weeks  
**Theme:** Make the platform usable by people on site, not just at a desk.  
**Minimum Shippable:** Mobile-responsive field UI + offline daily log + QR tag lookup

---

### Phase 3 Stories

#### 3.1 · Mobile-Responsive Field UI

**Effort:** 16 SP

- [ ] Audit all components for mobile breakpoints; identify top 5 field views (2 SP)
- [ ] Responsive layout for: Daily Logs, Punch Items, RFI viewing, Safety Incident reporting, QR tag lookup (10 SP — 2 SP each)
- [ ] Bottom navigation bar for mobile (field-centric: Logs, Punch, RFIs, Safety, Tags) (2 SP)
- [ ] Touch-optimized tap targets (48px minimum) and swipe gestures for list navigation (2 SP)

**Acceptance Criteria:** All 5 field views usable on a 375px wide phone screen. No horizontal scroll on primary views. All interactive elements meet 48px touch target minimum.

---

#### 3.2 · Offline Daily Log Entry

**Effort:** 12 SP

- [ ] Surface existing `offlineQueue` module in field UI (2 SP)
- [ ] Daily log create/edit stores to offline queue when no connection (3 SP)
- [ ] Sync UI: "N items pending sync" indicator when offline (2 SP)
- [ ] Auto-sync on reconnect with conflict detection (if record modified server-side) (3 SP)
- [ ] User notification on successful sync or conflict requiring resolution (2 SP)

**Acceptance Criteria:** Daily log entry works without network. Items sync automatically on reconnect. Conflicts presented to user for resolution. No silent data loss.

---

#### 3.3 · QR Code Tag / Equipment Lookup

**Effort:** 6 SP

- [ ] Generate QR code per tag record (link to tokenized public endpoint) (2 SP)
- [ ] Public mobile-optimized tag detail page (tag_no, status, linked test pack, last result, IOM link) — no login required (2 SP)
- [ ] "Print QR Label" action on tag detail (A4 label format) (1 SP)
- [ ] Token expiry configurable per tenant (default: never) (1 SP)

**Acceptance Criteria:** Scanning QR opens tag detail on mobile browser without login. Tag detail loads in < 2 seconds. Print label produces A4-sized printable label.

---

#### 3.4 · Offline Punch Item Create / Update

**Effort:** 8 SP

- [ ] Punch item create and status update stores to offline queue offline (3 SP)
- [ ] Photo attachment queued offline and uploaded on reconnect (3 SP)
- [ ] Sync conflict detection for punch status (if closed by another user while offline) (2 SP)

**Acceptance Criteria:** Punch items created and updated offline. Photos queued and synced. Conflicts surfaced to user.

---

#### 3.5 · Non-Conformance Reports (NCR)

**Effort:** 13 SP

- [ ] Design `ncrs` table: ncr_number, title, description, location, discipline, activity, severity, root_cause, corrective_action, status, created_by, assigned_to, closed_by (2 SP)
- [ ] NCR status lifecycle: `open → under_review → corrective_action → verification → closed | rejected` (1 SP)
- [ ] NCR routes: CRUD + `POST /:id/submit-corrective-action` + `POST /:id/verify` + `POST /:id/close` (4 SP)
- [ ] NCRView component (list with filters, detail panel) (4 SP)
- [ ] Link NCR to Inspection, Drawing, Submittal, or Punch item (2 SP)

**Acceptance Criteria:** NCR lifecycle fully implemented. NCRs linkable to source records. NCR log exportable per project. Closed NCRs searchable for trend analysis.

---

#### 3.6 · Global Search

**Effort:** 10 SP

- [ ] Search index: PostgreSQL FTS across projects, RFIs, punch items, drawings, vendors, tags, documents, knowledge sources (3 SP)
- [ ] `/api/search?q=` endpoint with module-grouped results (3 SP)
- [ ] Search bar in nav header (⌘K shortcut) (2 SP)
- [ ] Results grouped by module, showing most relevant 5 per module (2 SP)

**Acceptance Criteria:** Search returns results from all modules in < 500ms. Results grouped by module. ⌘K opens search from anywhere.

---

**Phase 3 Total Effort:** ~65 SP (~8 weeks, 2 engineers)

**Phase 3 Gate:** At least 5 field users using mobile UI on a live project. Offline queue used in at least 1 low-connectivity site scenario. QR codes printed and scanned on physical equipment.

---

## Phase 4 — Executive Analytics & Integrations

**Target:** 8 weeks  
**Theme:** Portfolio-level visibility and external system connectivity.  
**Minimum Shippable:** Client portal + integration health dashboard + schedule impact tracker

---

### Phase 4 Stories

#### 4.1 · Client Portal

**Effort:** 20 SP

- [ ] New `portal_users` table: client users scoped to specific projects (2 SP)
- [ ] JWT scope: `portal` — read-only, project-filtered middleware (3 SP)
- [ ] Portal-specific route layer: project summary, RFIs, submittals, transmittals, commissioning readiness, punch A-category (5 SP)
- [ ] Portal UI shell: separate from internal app (4 SP)
- [ ] PM configures what is visible to client per project (3 SP)
- [ ] Portal invitation flow: PM invites client user by email, client sets password (3 SP)

**Acceptance Criteria:** Client users fully isolated from internal data. Read-only. PM controls visibility scope. Invitation-only access. No internal cost data visible.

---

#### 4.2 · Schedule Impact Tracker

**Effort:** 10 SP

- [ ] `schedule_impacts` table: source_type (co/daily_log/rfi/inspection), source_id, days_impact, approved (bool) (2 SP)
- [ ] Auto-populate from: approved CO `schedule_days`, daily log delays, RFI SLA overruns (3 SP)
- [ ] Schedule impact register view: total approved delay, at-risk delay, EOT entitlement (3 SP)
- [ ] PDF export for contractual notices (2 SP)

**Acceptance Criteria:** All delay sources automatically populated. EOT entitlement calculation accurate. PDF export for contract notices.

---

#### 4.3 · Integration Health Dashboard

**Effort:** 6 SP

- [ ] Integration health aggregation from existing sync_jobs records (2 SP)
- [ ] Dashboard view: per-integration status, last success, error rate, last error (2 SP)
- [ ] Alert on integration error state > 1 hour (in-app + email) (1 SP)
- [ ] Manual "retry sync" button per integration (1 SP)

**Acceptance Criteria:** Dashboard shows all integrations with Red/Amber/Green status. Alert fires at 1 hour. Manual retry available.

---

#### 4.4 · Vendor Risk Score

**Effort:** 8 SP

- [ ] `vendor_risk_scores` table: vendor_id, score (0–100), dimension_scores (JSONB), computed_at (2 SP)
- [ ] Score computation: on-time delivery, defect rate, incident rate, RFI response time, submittal rejection rate (3 SP)
- [ ] Score shown on vendor directory list and detail (1 SP)
- [ ] Score history chart on vendor detail (1 SP)
- [ ] Score shown in RFQ bid comparison (1 SP)

**Acceptance Criteria:** Score 0–100, lower = higher risk. Dimension breakdown on drill-down. Score recomputed on each relevant data change.

---

#### 4.5 · Handover Package Generator

**Effort:** 18 SP

- [ ] Scope selection UI: project + system(s) (2 SP)
- [ ] Aggregation query: test packs (finalized), inspection results (completed), punch list closeout, transmittals (as-built), O&M manuals (KB sources), compliance certificates (3 SP)
- [ ] Cover sheet generator: structured PDF with table of contents and gap list (4 SP)
- [ ] Document bundler: ZIP archive of all referenced files (4 SP)
- [ ] Package stored in CDE as Published document (2 SP)
- [ ] Generation history: generated_by, generated_at, scope (3 SP)

**Acceptance Criteria:** Cover sheet + TOC + ZIP produced per system. Missing items listed in cover sheet. Stored in CDE. Generation history tracked.

---

#### 4.6 · Procurement Anomaly Detection

**Effort:** 8 SP

- [ ] Anomaly detection rules: single-source, threshold splitting, vendor concentration, bid clustering, PO modification > 20% (3 SP)
- [ ] `procurement_anomaly_flags` table: entity, rule_triggered, detected_at, dismissed_by, dismissal_reason (2 SP)
- [ ] Anomaly flag visible to Owner/Admin only in procurement dashboard (2 SP)
- [ ] Dismiss with required justification; dismissed flags retained in audit log (1 SP)

**Acceptance Criteria:** Flags visible to Owner/Admin only. Each flag shows specific triggering data. Dismissible with justification. Dismissed flags in audit log.

---

**Phase 4 Total Effort:** ~70 SP (~8 weeks, 2 engineers)

**Phase 4 Gate:** Client portal used by at least 1 external client. Integration health dashboard monitoring at least 1 live integration. Vendor risk scores computed for at least 10 vendors.

---

## Phase 5 — Enterprise Hardening

**Target:** 6 weeks  
**Theme:** Security, audit compliance, and multi-tenant governance.  
**Minimum Shippable:** MFA + tenant feature flags + audit chain verification

---

### Phase 5 Stories

#### 5.1 · Multi-Factor Authentication (MFA)

**Effort:** 12 SP

- [ ] TOTP-based MFA (Google Authenticator / Authy compatible) (5 SP)
- [ ] MFA enrollment UI in user settings (2 SP)
- [ ] MFA challenge on login (2 SP)
- [ ] Admin can require MFA for all users in tenant (1 SP)
- [ ] Recovery codes (backup) (2 SP)

**Acceptance Criteria:** TOTP MFA works with standard authenticator apps. Admin can enforce MFA tenant-wide. Recovery codes generated at enrollment. MFA events in audit log.

---

#### 5.2 · Tenant Feature Flags

**Effort:** 6 SP

- [ ] `tenant_features` table: `(tenant_id, feature_key, enabled)` (1 SP)
- [ ] Feature flag check in nav (hide disabled module from sidebar) (2 SP)
- [ ] Feature flag check in API middleware (403 on disabled module routes) (2 SP)
- [ ] Feature flag management UI in Settings for Owner role (1 SP)

**Acceptance Criteria:** Disabled modules hidden from nav and return 403 on API access. Changes take effect within one session. Audit log records flag changes.

---

#### 5.3 · Audit Chain Verification Dashboard

**Effort:** 6 SP

- [ ] Audit log record count per day chart (gaps highlighted) (2 SP)
- [ ] Verification: flag days with zero records when system was active (2 SP)
- [ ] Full audit log CSV/JSON export (1 SP)
- [ ] Dashboard accessible to Owner role only (1 SP)

**Acceptance Criteria:** Date gaps flagged. Full export available. Owner-only access.

---

#### 5.4 · Session Timeout

**Effort:** 3 SP

- [ ] Idle session timeout: configurable per tenant (default 30 min) (2 SP)
- [ ] Session expiry warning modal at 2 min before timeout (1 SP)

**Acceptance Criteria:** Idle sessions expire at configured threshold. Warning shown before expiry. Configurable per tenant.

---

#### 5.5 · Safety Incident Trend Detection

**Effort:** 8 SP

- [ ] Daily cron: scan incidents for location clusters, body part patterns, incident type spikes (3 SP)
- [ ] `safety_trend_alerts` table: pattern_type, incident_ids, detected_at, dismissed_by (2 SP)
- [ ] Trend alert view in Safety dashboard (2 SP)
- [ ] Dismiss with required corrective action item (1 SP)

**Acceptance Criteria:** Trend alerts generated daily. Each alert shows contributing incidents. Alert requires corrective action item or dismissal with justification.

---

#### 5.6 · Contract Change Impact Simulator

**Effort:** 8 SP

- [ ] `simulateCOImpact(co_id)` service: compute revised forecast, CPI, schedule, contingency (3 SP)
- [ ] "Simulate Impact" button on CO in draft/submitted state (2 SP)
- [ ] Simulation result panel: side-by-side current vs simulated (2 SP)
- [ ] PDF export of simulation (1 SP)

**Acceptance Criteria:** Simulation runs in < 3 seconds. Results clearly labeled "Simulated — Not Approved." Non-destructive. PDF export available.

---

#### 5.7 · Document Expiry / Re-Issue Alerts

**Effort:** 5 SP

- [ ] `document_expiry` field on compliance tasks and CDE documents (1 SP)
- [ ] Scheduled job: alert N days before expiry (1 SP)
- [ ] Expired documents flagged in document list (1 SP)
- [ ] Expired compliance certs surface in Action Center (1 SP)
- [ ] Admin configures N days per tenant (1 SP)

**Acceptance Criteria:** Alerts fire N days before expiry. Expired items flagged in list view. Surface in Action Center. Admin-configurable threshold.

---

**Phase 5 Total Effort:** ~48 SP (~6 weeks, 1–2 engineers)

**Phase 5 Gate:** MFA enabled for all production users. Security audit passes with no critical findings. SOC 2 Type II readiness assessment score ≥ 80%.

---

## Roadmap Summary

| Phase | Theme | Duration | Effort | Gate |
|---|---|---|---|---|
| **Phase 1** | Critical Workflow Closure | 8 weeks | ~80 SP | Live project, no workarounds |
| **Phase 2** | AI Automation Layer | 6 weeks | ~60 SP | AI features used by 3+ users |
| **Phase 3** | Field, Mobile & Offline | 8 weeks | ~65 SP | 5+ field users on mobile |
| **Phase 4** | Analytics & Integrations | 8 weeks | ~70 SP | Client portal live |
| **Phase 5** | Enterprise Hardening | 6 weeks | ~48 SP | SOC 2 readiness ≥ 80% |
| **Total** | | **~36 weeks** | **~323 SP** | |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SLA engine alert fatigue | High | Medium | Require per-project config with conservative defaults; provide override |
| Client portal data isolation bug | Medium | Critical | Dedicated penetration test before portal launch |
| AI response fabrication | Medium | High | Strict confidence thresholds; human review on all drafts |
| CPM schedule gap blocks enterprise deals | High | High | Prioritize P6 import/export integration over native CPM build |
| Mobile offline sync conflicts | Medium | Medium | Optimistic locking + explicit conflict resolution UI |
| Phase 2 AI costs exceed budget | Low | Medium | Per-tenant rate limiting; cost attribution per feature from day one |
| NCR module delayed by ITP dependency | Low | Medium | NCR can ship without ITP; add ITP link when ITP module is built |

---

*Denver Engineering v4 — Proprietary. All rights reserved.*
