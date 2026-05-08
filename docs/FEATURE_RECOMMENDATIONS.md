# Denver Engineering — Feature Recommendations

**Version:** v4.32.0  
**Date:** 2026-05-06  
**Classification:** Internal Product Strategy

---

## Executive Summary

Denver Engineering v4.32.0 is a substantively complete EPC lifecycle platform. The core workflows — CRM, projects, procurement, construction, commissioning, compliance, and safety — are implemented and functional. However, several categories of features are absent or shallow that would block enterprise adoption, particularly for owner operators, mid-size contractors, and portfolio managers.

**Three critical gaps prevent production readiness today:**

1. **No global action center** — users have no single view of what requires their attention across all modules. Approvals, overdue items, RFIs pending response, permits expiring, and punch items due are siloed per view.
2. **No SLA / escalation engine** — items age without automatic escalation. Managers only know about overdue work if they actively look for it.
3. **No client or subcontractor portal** — all external parties must communicate through informal channels. There is no secure, permission-scoped window into project data for clients, vendors, or subs.

**Top 10 Recommended Features (ranked):**

| Rank | Feature | Priority | Why Now |
|---|---|---|---|
| 1 | Global Action Center | P0 | Eliminates the #1 field complaint: "I didn't know it needed me" |
| 2 | SLA Escalation Engine | P0 | Prevents RFIs, submittals, and permits from dying silently |
| 3 | Project Health Score | P0 | Gives PMs and execs a single signal for project risk |
| 4 | Universal Activity Feed | P1 | Provides cross-module audit-quality context |
| 5 | Approval Delegation | P1 | Required for enterprise; approvals must survive vacations |
| 6 | Drawing → RFI/Punch Workflow | P1 | Closes the most common field-to-engineering feedback loop |
| 7 | Commissioning Readiness Dashboard | P1 | Required before any client handover conversation |
| 8 | Handover Package Generator | P1 | Final deliverable in every EPC contract |
| 9 | Client Portal | P2 | Reduces client email noise; adds perceived platform value |
| 10 | Vendor Risk Score | P2 | Enables data-driven procurement decisions |

---

## P0 — Must-Have Before Production

These features block real project delivery. Absence creates workarounds that undermine the platform.

---

### P0-01 · Global Action Center

**Module:** Cross-module  
**Business Value:** Eliminates the single biggest cause of missed deadlines — items sitting in a module nobody visited that day. A field engineer should open the app and immediately see every item that requires their attention across all 34 lifecycle modules.  
**Description:** A unified inbox-style view that aggregates all items requiring user action: pending approvals, overdue tasks, RFIs awaiting response, submittals past due date, permits expiring within 48 hours, compliance tasks in `notified` or `overdue` state, punch items assigned and not progressed, and daily logs not yet submitted.  
**Filters:** By module, by project, by due date, by assigned-to user.  
**Acceptance Criteria:**
- User sees all items requiring their action within one screen load, regardless of module.
- Items are sorted by urgency (overdue → due today → due this week).
- One-click navigation to the item's detail view.
- Badge count on nav sidebar shows total action items.
- Zero items in the center means zero pending obligations (no false positives).
- Refreshes in real time or within 60 seconds.

**Technical Complexity:** Medium. Requires a single aggregating query across ~12 tables joined on `assigned_to = current_user AND status IN (actionable_states)`.  
**Dependencies:** None — uses existing data.  
**Risk:** Query performance at scale across multiple tables. Mitigate with a materialized `user_action_items` view refreshed on mutation.

---

### P0-02 · SLA Escalation Engine

**Module:** Cross-module (RFIs, Submittals, Punch Items, Compliance, Inspections, Deficiencies)  
**Business Value:** Every construction contract carries response time SLAs. RFIs must be answered within 7–14 days. Submittals within 10–21 days. Without automated escalation, PMs only discover SLA breaches after the fact, at which point claims have already started.  
**Description:** Each module that has a `due_date` or `respond_by` field gets an SLA configuration: warn at N days before due, escalate to supervisor at M days overdue, and auto-notify client contact at K days overdue. Escalation levels are configurable per project and per module.  
**Escalation Chain:** Assignee → Supervisor → PM → Owner  
**Channels:** In-app notification, email (via integration), webhook.  
**Acceptance Criteria:**
- SLA rules are configurable per project per module (not hard-coded).
- Level-1 warning fires automatically at configured threshold.
- Level-2 escalation fires if no action is taken within configured window.
- Escalation history is recorded in the audit log.
- SLA breach rate is visible in the project health dashboard.
- No false escalations on items already in terminal state.

**Technical Complexity:** Medium. Extension of the existing `complianceWatcher` pattern — generalize to a universal `slaWatcher` service.  
**Dependencies:** P0-01 (Action Center displays escalated items), notification delivery integration.  
**Risk:** Alert fatigue if thresholds are misconfigured. Require per-project configuration with sane defaults.

---

### P0-03 · Project Health Score

**Module:** Projects / Dashboard  
**Business Value:** Owners and executives need a single number to assess project risk without reading 15 sub-reports. A composite score enables portfolio-level risk triage and board-level reporting.  
**Description:** A weighted composite score (0–100) computed per project across five dimensions:

| Dimension | Weight | Inputs |
|---|---|---|
| Schedule | 25% | SPI, milestone hit rate, open punch count |
| Cost | 25% | CPI, VAC, forecast vs budget |
| Quality | 20% | Open RFIs, deficiency count, failed inspections |
| Safety | 15% | TRIR, open incidents, expired permits |
| Compliance | 15% | Overdue compliance tasks, overdue WIRs |

Score ranges: 80–100 = Green, 60–79 = Amber, 0–59 = Red.  
**Acceptance Criteria:**
- Score computed daily (or on-demand) and stored as a time-series snapshot.
- Score visible on project list, project detail, and executive dashboard.
- Score delta (+/-) vs prior week shown alongside current score.
- Dimension breakdown available on drill-down.
- Score history chart available for trend analysis (30/60/90 days).
- Score methodology documented and accessible to users.

**Technical Complexity:** Medium. Uses existing EVM, safety, and compliance data. Requires a scheduled `kpiSnapshot` job extension.  
**Dependencies:** EVM data (existing), Safety module (existing), Compliance module (existing).  
**Risk:** Score gaming — teams closing items superficially to improve score. Mitigate by including trend data and requiring evidence on closures.

---

### P0-04 · CDE Transmittal Acknowledgment Workflow

**Module:** Documents (CDE)  
**Business Value:** ISO 19650 requires transmittal acknowledgment as part of the audit chain. Currently transmittals are sent but acknowledgment is not tracked, which means the platform cannot produce a compliant document handover record.  
**Description:** When a transmittal is sent, the recipient receives a notification with a secure link. They can acknowledge receipt (with timestamp and optional comment) or raise a query. Transmittal status tracks: `sent → acknowledged → queried → resolved`.  
**Acceptance Criteria:**
- Recipient can acknowledge without a platform account (tokenized link).
- Acknowledgment timestamp and comment are stored and immutable.
- Transmittal list shows acknowledgment status per recipient.
- Overdue acknowledgments (> N days) surface in the Action Center.
- Full transmittal chain (sent, acknowledged, queried, resolved) exportable as PDF for handover audit.

**Technical Complexity:** Low–Medium. New state on existing transmittal record + token-based external acknowledgment endpoint.  
**Dependencies:** Email integration for notification delivery.  
**Risk:** External recipients not responding. Add reminder escalation at 48h and 7d.

---

### P0-05 · Approval Delegation / Out-of-Office Routing

**Module:** Cross-module (all approval workflows)  
**Business Value:** On any real project, the approver is on site, traveling, or on leave. Without delegation, POs, submittals, change orders, and daily logs sit blocked until the approver returns. This is the #1 cause of schedule claims on construction projects.  
**Description:** Any user with an approval role can configure: delegation target user, delegation period (start/end date), and scope (all approvals, or specific modules). While delegation is active, approval requests are routed to the delegate. The original approver is still notified. All delegated approvals are logged with `approved_by` (delegate) and `delegated_from` (original approver).  
**Acceptance Criteria:**
- Delegation is configurable per user, per module, per date range.
- Approval requests auto-route to delegate during the active period.
- Both original approver and delegate receive notifications.
- Delegated approvals are clearly marked in audit log (`delegated_from` field).
- Delegation can be revoked instantly.
- Admin can override delegation for any user.

**Technical Complexity:** Medium. Requires a `delegation_rules` table and middleware that resolves effective approver at request time.  
**Dependencies:** All approval workflow routes (POs, submittals, COs, daily logs).  
**Risk:** Circular delegation (A delegates to B, B delegates to A). Validate at creation time; reject cycles.

---

## P1 — High-Value Growth Features

These features directly extend enterprise fitness and field usability. Should be shipped within 90 days of P0 completion.

---

### P1-01 · Drawing-to-RFI / Drawing-to-Punch Workflow

**Module:** Drawings → RFIs / Punch List  
**Business Value:** The most common field workflow is: engineer sees an issue on a drawing, raises an RFI or punch item against that specific sheet and revision. Currently these are disconnected — the RFI or punch item has no formal drawing reference with sheet/revision context attached.  
**Description:** From the Drawings view, a user can select a sheet, mark a location (coordinate or zone), and raise an RFI or punch item pre-populated with: sheet number, revision, discipline, and location reference. The RFI/punch item shows a "Drawing Reference" badge linking back to the exact sheet and revision.  
**Acceptance Criteria:**
- One-click "Raise RFI" and "Raise Punch" from drawing sheet detail view.
- Pre-populated fields: `drawing_ref`, `revision`, `discipline`, `sheet_number`.
- Raised item shows back-link to source drawing.
- Drawings view shows count of open RFIs and punch items per sheet.
- BIM Issues can also be converted to RFI or punch item via the same pattern (§P1-02).

**Technical Complexity:** Low. New FK columns on RFI and punch_item tables + pre-fill on create.  
**Dependencies:** Existing Drawings, RFI, and Punch List modules.

---

### P1-02 · BIM Clash → RFI / Submittal / Punch Conversion

**Module:** BIM → RFIs / Submittals / Punch List  
**Business Value:** BIM clash detection is only valuable if clashes become tracked action items. Currently BIM issues are a dead-end register — they do not flow into the RFI or submittal workflow that resolves them.  
**Description:** A BIM issue can be converted to an RFI (needs design decision), a submittal (needs approval of proposed resolution), or a punch item (physical rework required). Conversion carries forward: title, description, element_ids, severity, and a back-reference to the source BIM issue. The BIM issue tracks the linked child record and closes when the linked record closes.  
**Acceptance Criteria:**
- "Convert to RFI / Submittal / Punch" action available on any BIM issue.
- Converted record shows "Source: BIM Issue #N" badge.
- BIM issue shows "Linked: RFI #N" / "Submittal #N" / "Punch #N" badge.
- BIM issue auto-closes when linked record reaches terminal state.
- BIM dashboard shows count of issues converted vs open.

**Technical Complexity:** Low. FK relationships + conversion endpoint.  
**Dependencies:** BIM, RFI, Submittal, Punch List modules.

---

### P1-03 · Commissioning Readiness Dashboard

**Module:** Commissioning  
**Business Value:** Before any commissioning activity starts, the project team needs to know: are all pre-comm packs issued? Are outstanding punch items cleared to the required level? Are all required tags, subsystems, and systems in scope? This dashboard is the gate between construction complete and commissioning start.  
**Description:** A single-page readiness view per project showing:
- Pre-comm pack completion by system (% issued, % finalized)
- Punch item clearance by priority (all A-category cleared, B-category status)
- Outstanding RFIs affecting commissioning scope
- Compliance items required for commissioning (permits, training certifications)
- Outstanding inspections per system
- Tag/equipment commissioning status (planned / active)
- Go/No-Go recommendation per system with blocking items listed

**Acceptance Criteria:**
- Readiness view accessible from Commissioning module.
- Go/No-Go status per system calculated automatically from linked data.
- Blocking items listed with direct links to the blocking record.
- PDF export of readiness report for client gate review.
- Status refreshes on data change (not just daily).

**Technical Complexity:** Medium. Aggregation query across test packs, punch items, RFIs, compliance, and inspections scoped to a system.  
**Dependencies:** Test Packs, Punch List, RFI, Compliance, Inspections, Systems modules.

---

### P1-04 · Handover Package Generator

**Module:** Commissioning / Documents  
**Business Value:** The final deliverable in every EPC contract is the handover package: a dossier containing as-built drawings, O&M manuals, test records, commissioning certificates, punch list close-out, and inspection records. Currently this must be assembled manually.  
**Description:** A handover package generator that aggregates per system: finalized test packs, completed inspection records, closed punch items, as-built drawing transmittals, ingested O&M manuals (from Knowledge Base), compliance certificates, and a sign-off cover sheet. Outputs a structured PDF and a ZIP archive of all referenced documents.  
**Acceptance Criteria:**
- User selects project + scope (system or full project).
- Generator produces a structured PDF cover sheet + table of contents.
- All referenced documents are collected into a ZIP archive.
- Package includes: test pack summaries, inspection results, punch list closeout, transmittal register.
- Missing items (gaps) are listed in the cover sheet with status.
- Generated package is stored in CDE as a Published document.
- Generation history tracked with generated_by and generated_at.

**Technical Complexity:** High. Requires document assembly, PDF generation, and file bundling across multiple modules.  
**Dependencies:** Commissioning Packs, Inspections, Punch List, Documents, Knowledge Base.

---

### P1-05 · Universal Activity Feed

**Module:** Cross-module  
**Business Value:** Users need audit-quality context: "what happened on this project today, who did it, and across which modules." Currently each module has isolated change history with no cross-module timeline.  
**Description:** A project-scoped, reverse-chronological feed of all significant state changes and actions across every module: punch items closed, RFIs answered, submittals approved, daily logs submitted, COs executed, safety incidents logged, compliance tasks completed. Each entry shows: actor, action, module, record ID, and timestamp. Filterable by module, actor, and date range.  
**Acceptance Criteria:**
- Activity feed accessible at the project level and at the platform level.
- All terminal state transitions across all modules appear within 30 seconds.
- Feed is paginated (50 items per page).
- Filter by module, actor, date range.
- Each entry links to the source record.
- Feed is read-only — no actions from the feed.
- Exportable as CSV for client reporting.

**Technical Complexity:** Medium. Extend the existing audit log into a denormalized activity feed table with module/entity/action tagging.  
**Dependencies:** Existing audit log service.

---

### P1-06 · Schedule Impact Tracker

**Module:** Projects / RFIs / Change Orders / Daily Logs  
**Business Value:** Every delay event on a project — an unanswered RFI, an approved CO with schedule days, a delay logged in a daily log — affects the project schedule. Currently these are not linked to the project timeline. PMs cannot answer "why are we 3 weeks late?" without manually correlating records.  
**Description:** A schedule impact register that aggregates delay contributors: CO schedule_days (from approved change orders), delay causes (from daily logs), RFI response lag beyond SLA (days lost waiting), punch item resolution time beyond due date. Shows total approved delay, total at-risk delay, and EOT (Extension of Time) entitlement summary.  
**Acceptance Criteria:**
- Schedule impact register is visible at the project level.
- Approved CO schedule days are automatically added to the impact register.
- Delay entries from daily logs flow into the register.
- RFI response overruns are flagged and quantified.
- EOT entitlement total is shown (approved COs only vs total claimed).
- Report is exportable as PDF for contractual notices.

**Technical Complexity:** Medium. Aggregation from existing CO, daily log, and RFI data. New `schedule_impacts` summary table.  
**Dependencies:** Budget/COs, Daily Logs, RFIs.

---

### P1-07 · Daily Log Auto-Summary (AI)

**Module:** Daily Logs / Jarvis AI  
**Business Value:** PMs spend 20–40 minutes per day reading and summarizing daily logs from multiple foremen. An AI-generated summary of all logs for the day saves PM time and produces a consistent format for client reporting.  
**Description:** At end-of-day (configurable time), Jarvis automatically drafts a project-level summary from all submitted daily logs: total manpower by trade, total equipment hours, work performed narrative summary, delays consolidated, safety summary. The PM reviews and approves the AI draft before it is published.  
**Acceptance Criteria:**
- AI summary generated automatically after configurable cutoff time (e.g., 6 PM).
- Summary covers all logs in `submitted` or `approved` state for the day.
- PM receives notification that draft summary is ready for review.
- PM can edit before approving.
- Approved summary is stored as a project-level daily report in Documents (CDE).
- AI-generated sections are clearly labeled.

**Technical Complexity:** Medium. Scheduled job calls Claude API with structured log data. Requires new `daily_summary` table.  
**Dependencies:** Daily Logs module, Jarvis AI session infrastructure, Documents (CDE).

---

### P1-08 · QR Code Tag / Equipment Lookup

**Module:** Systems / Tags / Field Operations  
**Business Value:** Field technicians performing pre-commissioning or maintenance need to pull up equipment data (IOM, test pack, tag status) instantly from the field — without searching by tag number. QR code lookup eliminates search friction and errors.  
**Description:** Each tag/equipment record has a unique QR code generated and displayable from the tag detail view. Scanning the QR code (mobile browser) opens the tag detail: current status, linked test pack, linked subsystem, last inspection result, and a link to the relevant IOM in the Knowledge Base. No app install required — works via mobile web.  
**Acceptance Criteria:**
- QR code generated for every tag record automatically.
- QR code printable from tag detail view (A4 label format).
- Scanning QR opens tag detail in mobile browser without login (read-only, token-scoped).
- Tag detail shows: tag_no, equipment_name, status, linked test pack, last test result, IOM link.
- QR link is tenant-scoped and expires after configurable period (or never).

**Technical Complexity:** Low. QR code generation library + tokenized read-only endpoint.  
**Dependencies:** Systems / Tags module, Knowledge Base (IOM links).

---

### P1-09 · Vendor Risk Score

**Module:** Procurement / Vendor Directory  
**Business Value:** Procurement teams need to make award decisions based on vendor performance data, not just lowest price. A composite vendor risk score — built from past performance on this platform — supports defensible award decisions.  
**Description:** A composite risk score per vendor computed from: on-time delivery rate (POs), defect rate (inspections linked to vendor-supplied equipment), safety incidents attributed to vendor/subcontractor, RFI response time, submittal rejection rate, outstanding invoices/disputes. Score: 0–100 (lower = higher risk).  
**Acceptance Criteria:**
- Vendor risk score visible on vendor directory list and vendor detail.
- Score components are shown as a breakdown on drill-down.
- Score recomputed automatically on each relevant data change.
- Score history chart shows trend over time.
- Procurement view shows vendor risk score alongside bid comparison.
- Score methodology is documented and accessible.

**Technical Complexity:** Medium. Aggregation query across POs, inspections, safety, RFIs, and submittals filtered by vendor_id.  
**Dependencies:** POs, Inspections, Safety, RFIs, Submittals, Vendor Directory.

---

### P1-10 · Tenant-Level Feature Flags

**Module:** System / Admin  
**Business Value:** Different clients use different subsets of the platform. A contractor may not use commissioning. An owner operator may not use CRM. Enabling unused modules creates UI noise and user confusion. Feature flags allow per-tenant module enablement.  
**Description:** Admin-configurable flags per tenant that show/hide nav items and disable associated API routes for: CRM, Commissioning, BIM, Safety, Compliance, Knowledge Base, MCP Tools. Flags stored in tenant config and resolved on auth token issue.  
**Acceptance Criteria:**
- Feature flags configurable by Owner role in Settings.
- Disabled modules are hidden from navigation and return 403 on API access.
- Flag changes take effect within one session (no deploy required).
- Default flags can be set at the platform level (owner-org defaults).
- Audit log records flag changes.

**Technical Complexity:** Low. Tenant config JSONB field + nav/route middleware flag check.  
**Dependencies:** Tenant module, NavSidebar, all route modules.

---

## P2 — Strategic / Competitive Features

These features differentiate the platform against competitors and enable expansion into new segments. Target: 6–12 months.

---

### P2-01 · Client Portal

**Module:** Cross-module (read-only, scoped)  
**Business Value:** Clients currently receive PDFs and spreadsheets via email. A portal gives them live visibility into project status, RFI responses, submittal approvals, daily log summaries, and commissioning progress — without access to internal cost data or vendor pricing.  
**Description:** A scoped, read-only portal accessible to client users (separate from internal users). Client users see: project health score, milestone status, RFI register (their items only), submittal status, daily log summaries (approved only), transmittal register, commissioning readiness, and punch list (A-category items). No internal cost data, vendor pricing, or change order detail.  
**Acceptance Criteria:**
- Client users are invited by the Owner role; they cannot self-register.
- Client view is fully read-only (no create, update, or delete).
- Data visible to clients is configurable per project (owner controls).
- Client portal is accessible via separate URL or sub-domain.
- Session is isolated from internal users (separate JWT scope).
- Client comments on RFIs/submittals routed as new records, not direct edits.

**Technical Complexity:** High. Requires new role scope, view filtering, and portal UI shell.  
**Dependencies:** Projects, RFIs, Submittals, Daily Logs, Commissioning, Documents, Transmittals.

---

### P2-02 · Subcontractor / Vendor Portal

**Module:** Procurement / Punch List / Daily Logs  
**Business Value:** Subcontractors need to submit daily logs, view their assigned punch items, respond to RFIs, and submit progress claims — without being internal users. A portal reduces email overhead and creates a formal record.  
**Description:** A scoped portal for subcontractors: submit daily logs (their crew only), view and update assigned punch items, respond to RFIs directed to them, view their POs and delivery schedules, submit progress payment claims.  
**Acceptance Criteria:**
- Subcontractor users invited by PM; scoped to specific projects and contracts.
- Can submit daily logs for their own crew only.
- Can update punch items assigned to them (cannot close — only mark resolved for verification).
- Can respond to RFIs assigned to them.
- Cannot see other subcontractors' data.
- All subcontractor submissions are flagged as `submitted_by: subcontractor` in audit log.

**Technical Complexity:** High. New role scope + data isolation middleware.  
**Dependencies:** Procurement, Punch List, Daily Logs, RFIs.

---

### P2-03 · Procurement Anomaly Detection

**Module:** Procurement  
**Business Value:** Corruption and bid-rigging patterns are detectable at scale: same vendor winning repeatedly, bids clustering abnormally close in value, PO amounts just below approval thresholds, single-sourced awards without documented justification. Detecting these patterns protects the project owner.  
**Description:** A background analysis job that flags: single-source awards without documented exception, PO splits that appear to avoid approval thresholds, vendor winning rate anomalies (same vendor > N% of awards), bid clustering (all bids within 2% of each other), and PO modifications exceeding original value by > 20%.  
**Acceptance Criteria:**
- Anomaly flags visible to Owner and Admin roles only.
- Each flag includes the specific data pattern that triggered it.
- Flags are dismissible with a required justification (dismissed_by, dismissal_reason, dismissed_at).
- Dismissed flags are retained in audit log.
- Anomaly summary available in procurement dashboard for Owner role.
- False positive rate acceptable (< 15% on representative dataset).

**Technical Complexity:** Medium. Statistical analysis queries on procurement data. No ML required initially — rule-based detection.  
**Dependencies:** POs, RFQs, Vendor Directory.

---

### P2-04 · Contract Change Impact Simulator

**Module:** Budget / Projects / Schedule  
**Business Value:** Before approving a change order, a PM needs to understand: what is the EVM impact, how does it affect the project forecast, and what is the schedule slip? Currently this requires manual calculation outside the platform.  
**Description:** On any draft CO, a "Simulate Impact" action shows: revised project forecast cost, revised CPI, revised completion date (given schedule_days), impact on contingency remaining, and comparison of current vs projected project health score. Simulation is non-destructive — it shows what would happen if the CO is approved without changing any data.  
**Acceptance Criteria:**
- Simulate Impact available on any CO in `draft` or `submitted` state.
- Simulation shows: revised total cost, revised CPI, revised schedule, remaining contingency.
- Simulation is clearly labeled "Simulated — Not Approved" and not stored.
- PM can share simulation output as PDF before approval discussion.
- Simulation runs in < 3 seconds.

**Technical Complexity:** Medium. Read-only projection computation on existing EVM data.  
**Dependencies:** Budget, Projects (EVM data), Schedule module.

---

### P2-05 · Integration Health Dashboard

**Module:** Integrations / System  
**Business Value:** Integration failures are silent by default. A QuickBooks sync that stopped 3 days ago means the finance team is working off stale data. An integration health dashboard surfaces failures before they become problems.  
**Description:** A dashboard showing all configured integrations: connection status, last successful sync timestamp, last attempted sync timestamp, sync error rate (last 7 days), and most recent error message. Alerts when integration has been in `error` state for > 1 hour.  
**Acceptance Criteria:**
- Health dashboard accessible to Admin and Owner roles.
- Shows status, last success, error rate, and last error for each integration.
- Red / Amber / Green indicator per integration.
- Alert fires (in-app + email) when integration enters error state for > 1 hour.
- Manual "retry sync" button per integration.
- Historical sync log (last 30 days) viewable per integration.

**Technical Complexity:** Low. Aggregation from existing sync job records + notification trigger.  
**Dependencies:** Integrations module, background jobs, notification delivery.

---

### P2-06 · Safety Incident Trend Detection

**Module:** Safety  
**Business Value:** A single safety incident is a problem. Three incidents in the same location over two weeks is a systemic problem. Trend detection identifies systemic risks before they escalate to LTI or fatality.  
**Description:** Automated analysis of incident records that flags: location clusters (>2 incidents at same location in 14 days), body part patterns (>2 incidents involving same body part in 30 days), incident type spikes (e.g., near-miss rate doubling in any 7-day window), and time-of-day patterns (incidents clustering in early morning or post-break periods).  
**Acceptance Criteria:**
- Trend alerts visible in Safety module to Admin, Owner, and PM roles.
- Each alert shows the specific pattern (location, type, time window) and the contributing incidents.
- Alerts trigger a required action: open a corrective action item or dismiss with justification.
- Trend analysis runs daily (cron job).
- TRIR trend chart (30/60/90 day) always visible in Safety dashboard.

**Technical Complexity:** Medium. Statistical analysis queries on incident records.  
**Dependencies:** Safety (Incidents) module, Action Items module.

---

### P2-07 · Audit Chain Verification Dashboard

**Module:** System / Audit  
**Business Value:** For SOC 2 Type II and ISO 27001 compliance, auditors need to verify that audit log records are complete, untampered, and traceable. Currently the audit log is just a table — there is no verification that records haven't been deleted or altered.  
**Description:** An admin dashboard that verifies audit log integrity: record count per day vs expected (gaps indicate deletion), hash-chain verification if implemented, oldest record date vs retention policy, and export of audit log for external audit review.  
**Acceptance Criteria:**
- Dashboard visible to Owner role only.
- Shows total record count, date range, records per day chart (gaps highlighted).
- Flags any date gaps (days with zero records when system was active).
- One-click export of full audit log as CSV or JSON for external audit.
- Last verification timestamp shown.
- Verification runs on-demand and on nightly schedule.

**Technical Complexity:** Low. Aggregation on audit log + export endpoint.  
**Dependencies:** Audit log module.

---

## Feature Dependencies Map

```
P0-01 (Action Center)
  ← P0-02 (SLA Engine)    [feeds escalated items into center]
  ← P0-04 (CDE ACK)       [feeds overdue ACKs into center]
  ← P0-05 (Delegation)    [routes items to delegate]

P0-03 (Health Score)
  ← P1-06 (Schedule Impact)  [schedule dimension]
  ← P1-09 (Vendor Risk)      [procurement dimension]

P1-04 (Handover Generator)
  ← P1-03 (Readiness Dashboard)  [confirms go/no-go before generation]
  ← P0-04 (CDE ACK)             [transmittal acknowledgment required]

P2-01 (Client Portal)
  ← P0-04 (CDE ACK)         [clients acknowledge transmittals]
  ← P1-03 (Readiness Dashboard) [visible to clients]
  ← P1-05 (Activity Feed)   [filtered feed for clients]
```

---

## Suggested Implementation Order

```
Sprint 1–2:  P0-01 (Action Center), P0-02 (SLA Engine)
Sprint 3–4:  P0-03 (Health Score), P0-05 (Delegation)
Sprint 5:    P0-04 (CDE ACK), P1-05 (Activity Feed)
Sprint 6–7:  P1-01 (Drawing→RFI/Punch), P1-02 (BIM→RFI/Punch), P1-08 (QR Code)
Sprint 8–9:  P1-03 (Cx Readiness), P1-06 (Schedule Impact)
Sprint 10:   P1-07 (AI Daily Summary), P1-09 (Vendor Risk), P1-10 (Feature Flags)
Sprint 11–13: P1-04 (Handover Generator)
Sprint 14–16: P2-01 (Client Portal)
Sprint 17–18: P2-02 (Sub Portal), P2-03 (Anomaly Detection)
Sprint 19–20: P2-04 (CO Simulator), P2-05 (Integration Health), P2-06 (Safety Trends), P2-07 (Audit Chain)
```

---

*Denver Engineering v4 — Proprietary. All rights reserved.*
