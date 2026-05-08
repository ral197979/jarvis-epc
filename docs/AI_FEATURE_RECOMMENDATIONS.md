# Denver Engineering — AI Feature Recommendations

**Version:** v4.32.0  
**Date:** 2026-05-06  
**Classification:** Internal Product Strategy — AI Layer

---

## Overview

Denver Engineering already has a functional AI layer: Ask Jarvis provides grounded RAG Q&A backed by Claude, and the commissioning pack generator uses Claude for structured document production. These are strong foundations. This document identifies where AI can be applied systematically across the remaining 30+ lifecycle modules to deliver measurable time savings and risk reduction.

**Design Principle:** Every AI feature in this document follows a human-in-the-loop model. AI drafts, summarizes, flags, or recommends — a human reviews and approves before any state change occurs. No AI feature should autonomously close, approve, or submit a record.

**AI Provider:** Anthropic Claude (claude-sonnet-4-6 for complex analysis; claude-haiku-4-5 for high-volume, low-latency tasks).

---

## 1. Jarvis AI — Core Enhancements

### 1-01 · Contextual Ask Jarvis (Project-Scoped Sessions)

**Current State:** Ask Jarvis operates at the tenant level. Any question draws from the full knowledge base regardless of which project the user is working on.

**Recommended Enhancement:** When a user is working in a project context, Ask Jarvis automatically scopes retrieval to: that project's uploaded documents, that project's commissioning test packs, that project's systems and tags, and that project's RFIs and submittals. Cross-project retrieval is available as a fallback only if no project-scoped match exists.

**AI Workflow:**
1. User asks question from within a project view.
2. Jarvis injects `project_id` as a retrieval filter.
3. Retrieval runs: project-scoped FTS + vector → tenant-wide FTS + vector (fallback).
4. Response includes citation tier: `project-specific` vs `general`.

**Acceptance Criteria:**
- Project-scoped sessions return project-specific citations first.
- Citation source clearly labels scope: "[Project Document]" vs "[General KB]".
- Users can toggle project scope off to ask general questions.
- Project context is shown in the session header.

**Human-in-the-Loop:** None required — this is a retrieval improvement, not an action.

---

### 1-02 · Jarvis "Next Best Action" Engine

**Current State:** No AI-driven prioritization of user actions.

**Recommended Feature:** Based on project state, open items, and due dates, Jarvis proactively suggests the 3–5 most important actions the current user should take today. Suggestions are ranked by risk and urgency.

**AI Workflow:**
1. On user login or dashboard open, background job assembles user's action inventory: assigned items, approaching SLAs, items they created that are blocked.
2. Claude analyzes the inventory with context: project phase, user role, historical action patterns.
3. Returns ranked list of suggested actions with brief rationale.
4. User sees "Jarvis suggests:" card on dashboard. One click navigates to the item.

**Prompt Pattern (to Claude):**
```
You are a project management assistant. The user is a [role] on [project].
Today is [date]. Project phase: [phase]. Project health: [score].

Their open action items by urgency:
[structured JSON of items]

Suggest the 3-5 most important actions they should take today. For each, provide:
- The action (brief imperative)
- Why it is urgent (one sentence)
- Risk if not done today (one sentence)

Return as JSON array.
```

**Acceptance Criteria:**
- Suggestions appear within 3 seconds of dashboard load.
- Suggestions are specific (name the record: "RFI-042 from ABC Contractor is 4 days overdue").
- User can dismiss individual suggestions (dismissed_by, dismissed_at stored).
- Suggestions do not repeat the same item more than once per 24 hours.
- User can provide feedback: "Not helpful" (used to improve ranking).

**Human-in-the-Loop:** User decides whether to act on suggestions.

---

### 1-03 · Jarvis Ask — Structured Answer Improvements

**Current State:** Ask Jarvis returns `{answer, procedure, possible_causes, confidence, citations}`.

**Recommended Enhancements:**
- Add `related_records`: links to open RFIs, deficiencies, or punch items on the same tag or system.
- Add `relevant_tests`: links to test packs and results for the queried equipment.
- Add `safety_warnings`: extract and surface any safety-critical warnings from cited IOMs.
- Add `estimated_repair_time`: if the question is about a fault, extract typical repair time from IOM.

**AI Workflow:**
1. After generating the base answer, a second Claude call (haiku-4-5 for speed) extracts: safety warnings (ANSI safety alert symbols, DANGER/WARNING/CAUTION sections), and time estimates from IOM procedure steps.
2. A database lookup appends related open records for the same tag/system.

**Acceptance Criteria:**
- Safety warnings displayed with visual alert styling (red background, ⚠ icon).
- Related records shown as clickable chips below the answer.
- `estimated_repair_time` shown when available from IOM text (not fabricated).
- Confidence score updated to reflect whether IOM source was found (IOM = high; general = medium).

**Human-in-the-Loop:** None — informational enhancements only.

---

## 2. CRM & Sales AI

### 2-01 · Proposal Draft Generator

**Module:** CRM / Proposals  
**Business Value:** Writing a proposal from scratch takes 4–8 hours. A first draft in 20 minutes compresses the sales cycle.

**AI Workflow:**
1. PM fills in: client name, project type, estimated value, key scope bullets, project location.
2. AI generates a structured proposal outline: executive summary, scope of work, methodology, team, exclusions, assumptions, commercial terms.
3. PM reviews and edits before publishing.
4. Template sections are drawn from a project-type library (commissioning, FEED, EPC, etc.).

**Acceptance Criteria:**
- Proposal draft generated in < 60 seconds.
- Draft is clearly labeled "AI Draft — Requires Review."
- All AI-generated sections are editable.
- Final proposal is not auto-submitted — PM explicitly publishes.
- Proposal stored in CDE as a `WIP` document.

**Human-in-the-Loop:** PM reviews and edits draft. PM explicitly publishes — no auto-submit.

---

### 2-02 · Win/Loss Pattern Analysis

**Module:** CRM  
**Business Value:** Sales teams repeat the same mistakes without data. Knowing that you lose 80% of bids where a specific competitor is present — or win when a specific team leads — is commercially valuable.

**AI Workflow:**
1. Monthly scheduled job assembles all closed opportunities (won + lost + no_bid) for the past 12 months.
2. Claude analyzes patterns: win rate by client type, project type, bid value range, team composition, season, and time-to-bid.
3. Outputs a structured insight report surfaced in CRM dashboard.

**Acceptance Criteria:**
- Insight report generated monthly or on-demand.
- Minimum 10 closed opportunities required before analysis runs (prevents noise).
- Insights include: top win factors, top loss factors, recommended segments to target.
- Report labeled with sample size and date range.
- All insights are probabilistic — no guarantees stated.

**Human-in-the-Loop:** Review only. No automated action.

---

## 3. Procurement AI

### 3-01 · RFQ Scope Extraction from Specifications

**Module:** Procurement / Knowledge Base  
**Business Value:** Creating an RFQ scope manually from a 200-page specification takes a day. AI can extract the relevant material list and scope items in minutes.

**AI Workflow:**
1. User selects a specification document from the Knowledge Base and a scope category (e.g., "electrical cable tray").
2. Claude extracts: equipment list, material quantities, applicable standards, exclusions, and special requirements from the specification.
3. Extracted scope is presented as a pre-filled RFQ draft for PM review.

**Acceptance Criteria:**
- Extraction completes in < 90 seconds for a 100-page spec.
- Extracted items are editable before the RFQ is created.
- Source page references are shown for each extracted item.
- Items the AI is uncertain about are flagged with a confidence indicator.
- User can reject individual extracted items before saving.

**Human-in-the-Loop:** PM reviews all extracted items. Nothing is auto-saved until PM confirms.

---

### 3-02 · Bid Evaluation Narrative Generator

**Module:** Procurement / RFQs  
**Business Value:** After bid evaluation, a formal recommendation memo is required for most client and internal approval processes. Writing this memo is time-consuming and often inconsistently formatted.

**AI Workflow:**
1. After RFQ evaluation is complete (bids scored), PM triggers "Generate Evaluation Memo."
2. Claude produces: executive summary, bid comparison table narrative, technical evaluation summary, commercial summary, recommendation with rationale, and exclusions/clarifications.
3. PM reviews, edits, and signs.

**Acceptance Criteria:**
- Memo generated in < 30 seconds.
- Memo accurately reflects the actual bid scores and values (no fabrication).
- Recommendation section clearly states recommended vendor and key reasons.
- Memo stored as a CDE document in `Shared (S3 — Suitable for Review)` state.
- PM explicitly approves before memo advances to `Published`.

**Human-in-the-Loop:** PM reviews and signs. No auto-publish.

---

## 4. Construction & Field AI

### 4-01 · Daily Log Auto-Summary

**Module:** Daily Logs  
**Business Value:** See FEATURE_RECOMMENDATIONS.md §P1-07. Detailed here from an AI design perspective.

**AI Workflow:**
1. At configurable cutoff (e.g., 6 PM), a scheduled job collects all `submitted` or `approved` logs for the day.
2. Claude receives structured log data and produces:
   - Manpower summary (total heads, total hours by trade)
   - Equipment utilization summary
   - Work performed narrative (consolidated from individual log narratives)
   - Delay summary (all delays by cause category)
   - Safety summary (incidents, near-misses, safety observations)
   - Quality notes summary
3. Draft is presented to PM for review and approval.

**Prompt Pattern:**
```
You are summarizing daily construction logs for a project manager.
Project: [name]. Date: [date]. Phase: [phase].

Today's logs from [N] foremen:
[structured JSON of all logs]

Produce a concise project-level daily report with sections:
1. Manpower (table: trade | headcount | hours)
2. Equipment (table: equipment | count | hours)
3. Work Performed (2–4 sentence narrative)
4. Delays (if any — cause and duration)
5. Safety (incidents, near-misses, observations)
6. Quality (NCRs, hold points, observations)

Be factual. Do not add information not present in the logs.
Flag [DATA MISSING] if a section has no data.
```

**Acceptance Criteria:**
- Summary clearly labeled "AI Draft — Awaiting PM Approval."
- PM can edit any section before approving.
- Approved summary stored as a CDE document.
- If zero logs were submitted that day, no draft is generated and PM is notified.

**Human-in-the-Loop:** PM reviews and approves before publication.

---

### 4-02 · RFI Response Draft Generator

**Module:** RFIs / Knowledge Base  
**Business Value:** Engineers spend 30–60 minutes researching and writing each RFI response. For common RFIs (specification clarifications, material substitutions, dimension queries), Knowledge Base retrieval + AI can produce an accurate first draft in under a minute.

**AI Workflow:**
1. When an RFI enters `pending` state and is assigned to an engineer, Jarvis automatically drafts a response by searching the Knowledge Base for relevant content.
2. If Knowledge Base retrieval confidence > 0.75, a draft response is generated.
3. Engineer sees: "Jarvis has drafted a response — review and confirm."
4. Engineer edits, then submits the response.

**Acceptance Criteria:**
- Draft only generated when retrieval confidence > 0.75 (no low-confidence guesses).
- Draft clearly labeled "AI Draft — Requires Engineer Review."
- Engineer can reject draft and write manually.
- Final response is not submitted until engineer explicitly confirms.
- AI draft generation is logged (model, input tokens, output tokens, confidence).

**Human-in-the-Loop:** Engineer must review and submit. No auto-response.

---

### 4-03 · Punch Item Description Standardizer

**Module:** Punch List  
**Business Value:** Punch items written by different field staff have wildly inconsistent descriptions, making reporting and trend analysis unreliable. Standardization enables pattern detection.

**AI Workflow:**
1. When a punch item is created or submitted, AI (haiku-4-5) reviews the description and suggests a standardized format: `[Location] — [Defect Type] — [Element] — [Required Action]`.
2. Creator sees the suggestion and can accept or dismiss.
3. Accepted standardized descriptions feed the trend analysis engine.

**Acceptance Criteria:**
- Suggestion appears inline immediately after field description is entered.
- Suggestion is non-blocking — user can dismiss and keep original.
- Accepted suggestions are tagged `ai_standardized = true`.
- No data is auto-changed — user must accept explicitly.

**Human-in-the-Loop:** Creator accepts or rejects standardization.

---

## 5. Commissioning AI

### 5-01 · Test Pack Generation from IOM/Spec

**Current State:** The commissioning pack generator creates structured test packs from ingested source documents. This exists but requires the user to manually trigger generation per pack.

**Recommended Enhancement:** Batch generation. When a system is created with linked equipment tags, AI automatically proposes a full test pack set for that system: one pre-comm pack, one loop check pack (per instrument), one functional test pack, and one start-up pack. Each pack is generated in `draft` state for engineer review.

**AI Workflow:**
1. Engineer creates a system and links tags.
2. Jarvis retrieves IOMs and specs for those tags from the Knowledge Base.
3. Claude generates a proposed test pack set using the commissioning rules engine.
4. Packs are created in `draft` state with `generated_from = ai`.
5. Engineer reviews each pack step-by-step, marks approved or rejects sections.

**Acceptance Criteria:**
- Batch generation completes within 5 minutes for a system with ≤ 20 tags.
- Each generated pack is in `draft` state — no auto-finalization.
- Engineer must review and explicitly finalize each pack.
- Source citations shown for each test step (which IOM page was the source).
- Steps for which no IOM source was found are flagged `[REQUIRES MANUAL REVIEW]`.
- Credit consumption: 1 credit per pack generated (same as manual generation).

**Human-in-the-Loop:** Engineer reviews all steps and explicitly finalizes each pack.

---

### 5-02 · Commissioning Readiness Risk Briefing

**Module:** Commissioning / Jarvis AI  
**Business Value:** Before a client readiness meeting, the commissioning manager needs a 1-page briefing: what is ready, what is blocked, and what are the top 3 risks. This currently takes 2 hours to compile manually.

**AI Workflow:**
1. CM triggers "Generate Readiness Briefing" from the Commissioning Readiness Dashboard.
2. Claude receives: system completion percentages, open punch items (A/B priority), outstanding RFIs affecting commissioning, open compliance tasks, outstanding inspections.
3. Claude produces: executive summary (2 sentences), readiness table per system, top 3 blocking risks, recommended actions before client meeting.

**Acceptance Criteria:**
- Briefing generated in < 30 seconds.
- Briefing is factually grounded in actual platform data (no fabrication).
- Briefing clearly states it is AI-generated and reflects data as of generation timestamp.
- CM can export as PDF for client presentation.
- CM reviews before sharing — no auto-send.

**Human-in-the-Loop:** CM reviews and approves before sharing with client.

---

### 5-03 · Anomaly Detection in Test Results

**Module:** Commissioning / Test Results  
**Business Value:** During pre-commissioning, a technician may record a measurement that is outside the expected range but within the acceptance criteria (borderline pass). These borderline readings are early warning signs that the commissioning baseline engine should flag for human review.

**AI Workflow:**
1. When a test result is submitted, the commissioning baseline engine checks the measurement against the statistical model (`auto_pass`, `auto_fail`, `queued_novelty`).
2. If `queued_novelty`, AI generates a brief narrative: "This reading is [X]% above the historical mean. Previous similar readings occurred in [context]. Recommend: [check this / verify calibration / inspect]."
3. Narrative is attached to the queued_novelty flag for the reviewer.

**Acceptance Criteria:**
- Narrative generated only for `queued_novelty` results (not all results).
- Narrative is concise: 2–3 sentences maximum.
- Narrative is clearly AI-generated and advisory only.
- Human reviewer accepts or rejects the result — AI does not close the flag.

**Human-in-the-Loop:** Human reviewer accepts or rejects novelty flag.

---

## 6. Compliance & Safety AI

### 6-01 · Safety Incident Root Cause Classifier

**Module:** Safety / Incidents  
**Business Value:** Consistent root cause classification across incidents enables trend analysis and corrective action prioritization. Currently root cause is free text, making aggregation impossible.

**AI Workflow:**
1. When an incident is logged, AI classifies the root cause into a standard taxonomy (based on incident description):
   - Immediate Cause: `unsafe_act`, `unsafe_condition`, `equipment_failure`, `environmental`
   - Root Cause: `inadequate_procedure`, `inadequate_training`, `inadequate_supervision`, `inadequate_equipment`, `human_error`
2. Classification is presented as a suggestion. Safety officer can accept or override.
3. Accepted classifications feed the trend detection engine.

**Acceptance Criteria:**
- Classification suggested within 5 seconds of incident description entry.
- Confidence score shown (> 0.80 = high, 0.60–0.79 = medium, < 0.60 = low — low confidence shows no suggestion).
- Safety officer can override classification with required justification.
- Overrides are logged for model feedback.
- Classification is never auto-applied — always requires officer acceptance.

**Human-in-the-Loop:** Safety officer must accept or override classification.

---

### 6-02 · Compliance Task Risk Scoring

**Module:** Compliance  
**Business Value:** Not all compliance tasks are equal. An expired pressure vessel inspection permit is more critical than an overdue toolbox talk. AI-scored risk level helps compliance managers prioritize.

**AI Workflow:**
1. When a compliance task is created (or on weekly review), Claude assigns a risk score based on: category, regulatory authority, consequence of non-compliance (license suspension vs minor fine), and days until due.
2. Risk score: `critical`, `high`, `medium`, `low` — with a one-sentence rationale.
3. Risk score is shown alongside due date in the compliance task list.

**Acceptance Criteria:**
- Risk score assigned within 10 seconds of task creation.
- Rationale is factual and references the task category and potential consequence.
- Compliance manager can override the risk score with justification.
- High/critical tasks are automatically surfaced in the Action Center regardless of due date.

**Human-in-the-Loop:** Compliance manager can override.

---

### 6-03 · JHA Auto-Draft from Scope Description

**Module:** Safety / JHAs  
**Business Value:** Writing a JHA for a new activity takes 30–60 minutes. AI can draft task steps, hazards, and control measures from a brief scope description, which a safety officer then validates.

**AI Workflow:**
1. Safety officer describes the work activity in plain text: "Lifting and setting a 4-tonne heat exchanger using a 50-tonne mobile crane at elevation."
2. Claude generates a JHA draft: task steps, hazards per step (using standard hierarchy: elimination → substitution → engineering → administrative → PPE), risk rating (before/after controls), and control measures.
3. Safety officer reviews, edits, and approves.

**Acceptance Criteria:**
- Draft generated in < 20 seconds.
- Draft uses recognized control hierarchy (OSHA / Safe Work Australia / ISO 45001).
- All steps and hazards are editable.
- JHA is not published until safety officer explicitly approves.
- Draft is labeled "AI Draft — Requires Safety Officer Review."
- Approval records: `approved_by`, `approved_at`.

**Human-in-the-Loop:** Safety officer reviews every step, hazard, and control. Explicit approval required.

---

## 7. Documents & Knowledge Base AI

### 7-01 · Document Ingestion Quality Scoring

**Module:** Knowledge Base  
**Business Value:** The quality of AI answers depends entirely on the quality of ingested documents. A scan of a handwritten IOM produces poor chunks. Knowing ingestion quality prevents users from trusting answers built on bad source material.

**AI Workflow:**
1. After a document is ingested and indexed, a quality analysis job (haiku-4-5) evaluates a random sample of 20 chunks:
   - Readability score (is text coherent or garbled OCR?)
   - Completeness score (are chunks complete thoughts or truncated mid-sentence?)
   - Density score (useful technical content vs whitespace / headers only?)
2. Overall quality score: `excellent`, `good`, `fair`, `poor`.
3. Score and issues are shown on the source document record.

**Acceptance Criteria:**
- Quality score computed within 2 minutes of ingest completion.
- Score shown on Knowledge Base source list with color coding.
- Sources scored `poor` are flagged in the UI with a warning: "Low-quality source — answers may be unreliable."
- Users can re-ingest with better source quality and score updates.

**Human-in-the-Loop:** Informational only. No automated deletion or suppression.

---

### 7-02 · Transmittal Cover Sheet Auto-Draft

**Module:** Documents / CDE  
**Business Value:** Every CDE transmittal requires a formal cover sheet. These are formulaic and time-consuming to write.

**AI Workflow:**
1. When a user creates a transmittal and selects documents to attach, AI drafts the cover sheet: purpose statement, document list with revision and suitability code, instructions to recipient, and notes on superseded revisions.
2. User reviews and sends.

**Acceptance Criteria:**
- Draft generated in < 10 seconds.
- Cover sheet is editable before sending.
- Final transmittal is not sent until user explicitly clicks Send.
- Cover sheet PDF is attached to the transmittal record.

**Human-in-the-Loop:** User reviews and sends explicitly.

---

### 7-03 · AI Document Extraction — Equipment Data Sheets

**Module:** Knowledge Base / Systems / Tags  
**Business Value:** Equipment data sheets (EDS) contain the master data for every tag: manufacturer, model, serial number, design pressure, design temperature, rated capacity. Manually entering this into the tag register for a 500-tag project takes days.

**AI Workflow:**
1. User uploads a batch of EDS PDFs to the Knowledge Base.
2. AI extraction job (claude-sonnet-4-6) processes each EDS and extracts: tag number, equipment name/type, manufacturer, model, serial number, design parameters, and applicable standards.
3. Extracted data is presented as a review table — user can accept all, accept individual rows, or reject.
4. Accepted rows create or update tag records in the Systems / Tags module.

**Acceptance Criteria:**
- Extraction completes at ≥ 80% accuracy for well-formatted EDS PDFs.
- All extracted data presented for review before any tag records are created.
- Confidence score per extracted field (< 0.80 flagged for manual review).
- User must explicitly approve each batch — no auto-create.
- Extraction history logged (which EDS produced which tags, with confidence scores).

**Human-in-the-Loop:** User reviews extraction table and approves before tag creation.

---

## 8. Reporting & Analytics AI

### 8-01 · Weekly Project Status Report Generator

**Module:** Projects / Dashboard  
**Business Value:** Weekly status reports to clients and PMOs are mandatory on most projects. They take 2–3 hours to compile manually. AI can produce a first draft in < 2 minutes.

**AI Workflow:**
1. PM triggers "Generate Weekly Report" from the project view.
2. Claude receives: project name, phase, EVM metrics (CPI, SPI), milestone status (on track / delayed), open RFI count, submittal status, punch list summary, safety summary (TRIR, incidents), key achievements this week (from approved daily logs and activity feed), and next week's planned activities (from schedule milestones).
3. Outputs a structured weekly status report in: Executive Summary, Schedule Status, Cost Status, Quality (RFIs/Submittals), Safety, Key Achievements, Next Week Plan, Issues / Risks.
4. PM reviews, edits, and publishes to CDE.

**Acceptance Criteria:**
- Report generated in < 60 seconds.
- All metrics are accurate (pulled from live data, not stored snapshots).
- Report period defaults to the current week (Mon–Sun); user can adjust.
- Report stored as a CDE document upon PM approval.
- Report template is customizable per tenant.

**Human-in-the-Loop:** PM reviews all sections and explicitly publishes.

---

### 8-02 · Project Closeout Report Auto-Draft

**Module:** Projects / Commissioning / Documents  
**Business Value:** Project closeout reports are 30–50 page documents covering the entire project history. The data exists in the platform. AI can compile it in seconds.

**AI Workflow:**
1. PM triggers "Generate Closeout Report" from a project in `completed` or late `commissioning` phase.
2. Claude aggregates: project overview, final EVM metrics, procurement summary (total PO value, vendor performance), construction summary (total manpower, peak crew, key milestones), commissioning summary (systems completed, test pack counts, deficiency close-out), safety record (total hours, TRIR, LTI rate), document summary (total drawings issued, transmittals sent), and lessons learned.
3. Draft stored in CDE; PM reviews and publishes.

**Acceptance Criteria:**
- Report generated in < 3 minutes (all data from platform).
- Factually accurate — cross-checked against stored metrics.
- Lessons learned section draws from the commissioning module's lessons learned register.
- Draft clearly labeled "AI Draft — Requires PM Approval."
- PM can export as PDF.

**Human-in-the-Loop:** PM reviews and explicitly publishes.

---

## 9. Human-in-the-Loop Summary

Every AI feature in this document follows these non-negotiable rules:

| Rule | Implementation |
|---|---|
| **No auto-state transitions** | AI never changes a record status. Humans submit/approve/close. |
| **Draft labeling** | All AI-generated content is labeled "AI Draft" with generation timestamp and model. |
| **Confidence thresholds** | Low-confidence results are flagged or suppressed rather than shown with false certainty. |
| **Override always available** | Users can always reject, edit, or override any AI suggestion. |
| **Audit trail** | Every AI generation is logged: model, input tokens, output tokens, prompt version, confidence. |
| **No external data use** | AI responses are grounded in the tenant's own documents and platform data. No external internet search. |
| **No PII in prompts** | User names, emails, and other PII are not sent to the AI model. Record IDs and anonymized data only. |

---

## 10. AI Infrastructure Requirements

### Models

| Use Case | Model | Rationale |
|---|---|---|
| Complex analysis (proposals, reports, test packs) | claude-sonnet-4-6 | High quality, complex reasoning |
| High-volume, low-latency (standardization, classification) | claude-haiku-4-5 | Fast, cost-effective for simple tasks |
| Structured extraction (EDS, IOMs) | claude-sonnet-4-6 | Accuracy critical for tag data |

### Prompt Caching

All system prompts (module context, persona, output schema) must use Anthropic prompt caching (cache_control: `ephemeral`). Estimated 70–80% cache hit rate on repeated module prompts reduces cost and latency.

### Rate Limiting

AI-generated features should be rate-limited per tenant to prevent abuse: max 50 AI generations per day per tenant on base plan; configurable per plan tier.

### Observability

Every AI call must log:
- `model` used
- `input_tokens` / `output_tokens`
- `cache_hit` (boolean)
- `latency_ms`
- `prompt_version` (hash)
- `user_id` and `tenant_id`
- `feature` (which AI feature triggered this call)

This enables cost attribution, quality monitoring, and regression detection.

---

*Denver Engineering v4 — Proprietary. All rights reserved.*
