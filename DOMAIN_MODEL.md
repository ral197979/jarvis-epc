# Denver Engineering — Domain Model

> **Status:** Build-ready v2 · Every entity below is a **real table** in `api/db/migrations/*` unless marked *(planned)*. Fields, types, enums, and constraints are quoted from the migrations.
> **Companion specs:** [Product Requirements](PRODUCT_REQUIREMENTS_DOCUMENT.md) · [System Architecture](SYSTEM_ARCHITECTURE.md)
> **Honesty legend:** ✅ exists · 🟡 partial · ⚠️ present-but-not-trustworthy. See [FEATURES.md](FEATURES.md).

## Conventions (apply to nearly every table)
- **PK:** `id UUID` (`uuid_generate_v4()` in early migrations, `gen_random_uuid()` later).
- **Tenancy:** `tenant_id UUID NOT NULL` + RLS `USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)` (see [System Architecture](SYSTEM_ARCHITECTURE.md) §4).
- **Audit:** `created_at`/`updated_at TIMESTAMPTZ DEFAULT NOW()`; actor columns (`created_by`, `submitted_by`, `approved_by`, `reviewed_by`) FK → `users(id)`.
- **Money:** `NUMERIC(18,2)`; **percent:** `NUMERIC(5,2)`; **flexible attrs:** `metadata JSONB DEFAULT '{}'`.
- Foreign keys to `tenants`/`users` cascade or set-null as noted; only non-obvious FKs are listed below.

---

## Phase 1 — Identity, tenancy & EPC core

### `tenants` ✅ (`001`)
`slug` VARCHAR(63) UNIQUE · `name` · `plan` **tenant_plan**(`trial|starter|professional|enterprise`) · `status` **tenant_status**(`active|suspended|cancelled|pending`) · `domain` · `settings` JSONB · `max_users` INT=5 · `max_storage_gb` NUMERIC(8,2)=10 · `used_storage_gb`.

### `users` ✅ (`001`)
`tenant_id` · `email` · `display_name` · `password_hash` · `role` **user_role**(`owner|admin|project_manager|engineer|procurement|field_ops|viewer`) · `is_active` · `mfa_secret` · `last_login` · `login_count` · `failed_attempts` · `locked_until` · `avatar_url` · `preferences` JSONB. **UNIQUE(tenant_id, email).**

### `refresh_tokens` ✅ (`001`, expiry `056`)
`user_id` · `jti` VARCHAR(64) UNIQUE · `token_hash` · `ip_address` INET · `user_agent` · `expires_at` · `revoked_at`.

### `audit_log` ✅ (`001`)
`user_id` · `action` **audit_action**(`create|read|update|delete|login|logout|export|approve|reject|upload|download|integrate_push|integrate_pull`) · `resource` · `resource_id` · `old_data`/`new_data` JSONB · `ip_address` · `user_agent` · `request_id`. *Written automatically by the audit middleware on every 2xx mutation (redacted body).*

### `projects` ✅ (`002`) — the spine of the graph
`code` (UNIQUE per tenant) · `name` · `client_name` · `location` · `country` CHAR(2) · `status` **project_status**(`planning|active|on_hold|completed|cancelled`) · `current_phase` **project_phase**(`feasibility|feed|detailed_design|procurement|construction|commissioning|closeout`) · `contract_type` **contract_type**(`lump_sum|reimbursable|unit_rate|gmp|ep|epc|epcm`) · `currency` · `budget` · `committed_cost` · `actual_cost` · `forecast_cost` · `contingency_pct` · `planned_start/finish` · `actual_start/finish` · `progress_pct` · `project_manager`/`lead_engineer` FK→users. *The Copilot reads budget/committed/actual/forecast + planned_finish + progress_pct directly off this row for its cost/schedule focus items.*

### `vendors` ✅ (`002`)
`code` · `name` · `type` · `status` **vendor_status**(`prospect|qualified|approved|preferred|suspended|blacklisted`) · `primary_contact` · `email` · `rating` NUMERIC(3,2) CHECK 0–5 · `categories` TEXT[].

### `contracts` ✅ (`002`)
`project_id` · `vendor_id` (RESTRICT) · `contract_number` · `type` contract_type · `status` **contract_status**(`draft|negotiation|active|variation|closed|disputed`) · `original_value` · `approved_value` · `invoiced_amount` · `paid_amount` · `retention_pct`.

### `purchase_orders` ✅ (`002`)
`project_id` · `vendor_id` · `contract_id` · `po_number` · `status` **po_status**(`draft|pending_approval|approved|issued|partial_delivery|delivered|invoiced|closed|cancelled`) · `subtotal`/`tax_amount`/`total_amount`/`received_amount` · `line_items` JSONB.

### `rfis` ✅ (`002`)
`project_id` · `rfi_number` · `title` · `description` · `status` **rfi_status**(`open|pending|answered|closed`) · `priority` **priority_level**(`low|medium|high|critical`) · `discipline` · `raised_by`/`assigned_to`/`response_by` FK→users · `response` · `due_date` · `responded_at` · `closed_at`. **UNIQUE(tenant, project, rfi_number).**

### `submittals` ✅ (`002`)
`project_id` · `submittal_number` · `type` · `status` **submittal_status**(`draft|submitted|under_review|approved|approved_as_noted|revise_resubmit|rejected`) · `spec_section` · `submitted_by`/`reviewed_by` · `due_date`. **UNIQUE(tenant, project, submittal_number).**

### `wirs` (Work Inspection Requests) ✅ (`002`)
`wir_number` · `status` **wir_status**(`open|in_progress|completed|failed|waived`) · `system_tag` · `inspector`/`witness` · `test_data` JSONB.

### `crm_leads` ✅ (`002`)
`company` · `contact_name` · `stage` · `value` · `probability` · `assigned_to` · `project_id`.

---

## Phase 2 — PM modules (daily logs, drawings, BIM, budgets, change orders)

### `daily_logs` ✅ (`007`)
`project_id` · `log_date` · `weather`/`temp_f`/`wind_mph`/`humidity_pct` · `manpower`/`equipment`/`visitors`/`deliveries`/`incidents`/`photos` JSONB[] · `work_performed` · `delays` · `safety_notes` · `status` · `submitted_by`/`approved_by`. **UNIQUE(tenant, project, log_date).**

### `drawings` ✅ (`007`)
`project_id` · `sheet_number` · `title` · `discipline` · `current_rev`='A' · `set_name` · `issue_date` · `document_id` FK→documents · `scale` · `page_count`. **UNIQUE(tenant, project, sheet_number, current_rev).**

### `drawing_revisions` ✅ (`007`)
`drawing_id` · `rev` · `issued_date` · `reason` · `document_id` · `issued_by`. **UNIQUE(drawing_id, rev).**

### `drawing_markups` ✅ (`007`)
`drawing_id` · `rev` · `page` · `annotations` JSONB[] · `resolved` · `resolved_by/at`.

### `bim_models` ✅ (`007`)
`project_id` · `name` · `discipline` · `format` · `document_id` · `size_bytes` · `element_count` · `coord_system` · `georef` JSONB · `status`.

### `bim_issues` ✅ (`007`; `primary_element_id`+`ifc_guid` added `051`)
`project_id` · `model_id` · `title` · `severity` · `status` · `element_ids` JSONB · `viewpoint` JSONB · `assigned_to` · **`primary_element_id`** · **`ifc_guid`** *(geo link)*.

### `budgets` ✅ (`007`)
`project_id` · `original_total` · `revised_total` · `committed_total` · `actual_total` · `forecast_total` · `baseline_date` · `status`. **UNIQUE(tenant, project).**

### `budget_items` ✅ (`007`)
`budget_id` · `cost_code` · `description` · `category` · `unit`/`qty`/`unit_cost` · `original_amount`/`revised_amount`/`committed_amount`/`actual_amount`/`forecast_amount`.

### `change_orders` ✅ (`007`, redefined `058`)
`project_id` · `co_number` INT (auto-seq/project) · `title` · `type` **co_type**(`scope|time|cost|scope_time_cost`) · `status` **co_status**(`draft|submitted|approved|rejected|void`) · `cost_impact` · `schedule_impact_days` · `reason` · **`rfi_id`** *(graph link)* · `submitted_by/at` · `reviewed_by/at`. **UNIQUE(tenant, project, co_number).**
- `change_order_tasks` ✅ — links a CO to affected `schedule_task_id` with `impact_notes`. **UNIQUE(change_order_id, schedule_task_id).**

---

## Phase 3 — Quality & closeout

### `punch_lists` ✅ (`008`)
`project_id` · `title` · `status`.

### `punch_items` ✅ (`008`; geo soft-links added `051`)
`punch_list_id` · `project_id` · `item_number` INT · `title` · `location` · `discipline` · `priority`(`low|medium|high|critical`) · `status`(`open|…|verified`) · `assigned_to` · `due_date` · **`drawing_id`** · `pin_x`/`pin_y` (markup pin) · `photos` JSONB · `verified_by/at` · `closed_by/at` · **`bim_element_id`**/**`bim_model_id`**/**`ifc_guid`** *(geo link)*. *Read directly by the Copilot punch focus builder.*

### `inspection_templates` ✅ (`008`)
`name` · `category` · `discipline` · `checklist` JSONB[] · `version` · `is_active`.

### `inspections` ✅ (`008`)
`project_id` · `template_id` · `inspection_number` · `type` · `location` · `status`(`scheduled|…`) · `scheduled_date`/`completed_date` · `inspector_id` · `results` JSONB[] · `pass_count`/`fail_count`/`na_count` · `overall_result` · `signatures` JSONB. **UNIQUE(tenant, project, inspection_number).** *Copilot surfaces `status='scheduled'` overdue or `overall_result='fail'`.*

---

## Phase 4 — Commissioning hierarchy & turnover

The EPC commissioning spine — purpose-built for data-center / mission-critical turnover.

### `systems` ✅ (`026`)
`project_id` · `code` · `name` · `status`. **UNIQUE(tenant, project, code).**
### `subsystems` ✅ (`026`)
`system_id` · `code` · `name`. **UNIQUE(tenant, project, system_id, code).**
### `tags` (equipment register) ✅ (`026`)
`system_id` · `subsystem_id` · `tag_no` · `equipment_name` · `equipment_type` · `manufacturer` · `model_no` · `serial_no` · `status`. **UNIQUE(tenant, project, tag_no).**
### `commissioning_items` ✅ (`026`)
`system_id`/`subsystem_id`/`tag_id` · `item_type` · `title` · `status` · `source_document_id` · `source_reference`.
### `test_packs` ✅ (`026`; `test_pack_id` bridge on packs `027`)
`system_id`/`subsystem_id`/`tag_id`/`commissioning_item_id` · `pack_no` · `revision`='A' · `pack_type` · `status` · `generated_from`. **UNIQUE(tenant, project, pack_no).**
### `test_results` ✅ (`026`)
`test_pack_id` · `step_no` · `step_title` · `expected_result`/`actual_result` · `result_status`(pending|…) · `evidence_uri` · `performed_by`/`witnessed_by` · `performed_at`. **UNIQUE(tenant, project, test_pack, step_no).**
### `deficiencies` ✅ (`026`; geo soft-links `051`)
`test_pack_id`/`test_result_id`/`tag_id` · `code` · `severity` · `status` · `assignee_user_id` · `due_date` · `closed_by/at` · **`bim_element_id`/`ifc_guid`** *(geo link)*. **UNIQUE(tenant, project, code).**

### Commissioning pack generation & auto-sign ✅ (`006`, `016`, `019`)
- `commissioning_packs` — `system_type` · `status` **pack_status**(`draft|ready_for_review|finalized|failed`) · `payload_json`/`final_payload_json` · `html_path`/`pdf_path` · `source_upload_id` · `test_pack_id`.
- `generation_jobs` — async queue: `type`(`generate_draft|finalize_pack`) · `status`(`queued|running|complete|failed`) · retry/lock columns.
- `commissioning_baselines` / `commissioning_observations` — statistical baselines (mean/std/p25/p75) + per-decision `z_score` and `decision`(`auto_pass|auto_fail|queued_novelty|…`) used by the auto-sign arbiter.

---

## Phase 5 — Documents & knowledge (RAG corpus)

### `documents` / `document_versions` / `document_folders` / `upload_tokens` ✅ (`003`)
- `documents` — `project_id` · `folder_id` · `doc_number` · `type` · `status` **file_status**(`uploading|active|archived|deleted`) · `current_version` · `tags` TEXT[].
- `document_versions` — `document_id` · `version` · `storage_backend`(`local|s3|gcs|azure`) · `storage_key` · `mime_type` · `size_bytes` · `checksum_sha256` · **`extracted_text`** · **`ai_summary`**. **UNIQUE(document_id, version).**
- `upload_tokens` — presigned-upload guard: `token` UNIQUE · `max_size_bytes`=104857600 · `mime_types` TEXT[] · `expires_at`.

### `knowledge_sources` ✅ (`022`)
`title` · `kind`(`pdf|docx|md|txt`) · `storage_path` · `sha256` (dedup) · `license_type`(`owned|purchased|public_domain|cc-by|cc-by-sa|gov`) · `status`(`pending|ingesting|ready|failed`) · `chunk_count` · `tags` TEXT[] · `asset_system` · `project_id`.

### `knowledge_chunks` ✅ (`022`, vector `025`/`071`)
`source_id` · `text` · `search_tsv` (FTS, auto-maintained) · `embedding_json` (fallback) · **`embedding vector(1536)`** with **`ivfflat (embedding vector_cosine_ops)`** index. *The retrieval substrate for Ask Jarvis (hybrid pgvector + FTS).*

### `chat_sessions` / `chat_messages` ✅ (`023`)
- `chat_sessions` — `user_id` · `title` · `project_id` · `resolved_flag`/`resolved_at`/`resolved_by` · `linked_work_order_id` *(reserved)* · `message_count`.
- `chat_messages` — `session_id` · `ordinal` · role/content + cited chunk references.

### `knowledge_fixes` ✅ (`021`, provenance `024`)
Reusable engineering fix patterns mined from `deficiencies`; searchable by system type / failure mode; used as an Ask Jarvis retrieval source.

---

## Phase 6 — Actions, SLA & relationships (the action graph)

### `actions` ✅ (`029`) — the unified cross-module action model
`project_id` · `title` · `description` · **`action_type`** (`RFI|SUBMITTAL|PUNCH_ITEM|WORK_ORDER|ALARM|COMPLIANCE_TASK|INSPECTION|BIM_ISSUE|DAILY_LOG|…`) · **`source_module`** (`rfis|submittals|punch_items|…`) · **`source_id`** UUID (back-link to the originating record — *not* FK-enforced, polymorphic) · `system_type`(`PWTP|WWTP|HVAC|EPC|…`) · `priority`(`low|medium|high|critical`) · `status`(`open|in_progress|…`) · `due_at` · geo soft-links **`bim_element_id`/`bim_model_id`** (`051`). *This is the hub that lets one "action" represent an RFI, a punch item, or an inspection uniformly — and what the Copilot's `actionItem` builder ranks (excluding modules already surfaced directly).*

### `action_relations` ✅ (`030`) — typed directed DAG between actions
`source_action_id` · `target_action_id` · **`relation_type`**(`blocks|related_to|caused_by|duplicates|escalated_from|spawned_from|references`) · `notes` · soft-delete. CHECK(no self-relation), **UNIQUE(tenant, source, target, relation_type).** *This is a real edge table — the basis for cause/blocker chain reasoning.*

### `sla_profiles` ✅ (`031`) + `action_events` (`034`) + `action_analytics` (`033`)
Named SLA profiles (business-hours/priority → due-date), an immutable per-action event log, and nightly analytics aggregation. `predictive_sla` (`039`) adds breach-risk forecasting.

---

## Phase 7 — Schedule, EVM & estimating

### `schedule_tasks` ✅ (`014`; EVM cols `053`)
`project_id` · `name` · `wbs_code` · `duration_days` · `is_milestone` · `actual_start/finish` · `status`(`not_started|in_progress|complete`) · (+`planned_start`/`planned_finish`/`planned_cost`/`percent_complete` from `053`).
### `schedule_dependencies` ✅ (`014`) — **Finish-to-Start only**
`predecessor_id` · `successor_id` · `lag_days`. CHECK(pred≠succ), UNIQUE(pred, succ). ⚠️ *No SS/FF/SF, calendars, or resource leveling.*
### `schedule_import_jobs` / `schedule_import_id_map` ✅ (`054`)
P6 **XER** / MS Project **MSPDI/MPX** import: `format` · `status` · counts; `id_map` keeps external P6/MSP ID → internal `task_id`.

### EVM ✅ (`053`, WBS unique `057`)
- `evm_baselines` — `bac` (Budget at Completion) · `start/finish_date` · `is_active`. UNIQUE(tenant, project, name).
- `evm_wbs_entries` — `baseline_id` · `wbs_code` · `bac` · `schedule_task_id` (inherits dates). UNIQUE(tenant, baseline, wbs_code).
- `evm_actuals` (ACWP) — `wbs_entry_id` · `period_date` · `amount` · `reference` (PO/invoice).
- `evm_progress` (→BCWP) — `wbs_entry_id` · `period_date` · `percent_complete`.
- `evm_snapshots` (S-curve) — `bac`/`bcws`/`bcwp`/`acwp` + derived `cpi`/`spi`/`cv`/`sv`/`eac`/`etc`/`vac`/`tcpi`. UNIQUE(tenant, project, snapshot_date).

### BIM elements & estimating 🟡 (`050`, cost seed `052`)
- `bim_elements` — `model_id` · **`ifc_guid`** (22-char) · `ifc_type`(`IfcWall|IfcBeam|…`) · `discipline` · `level`/`zone` · `status` · `bounding_box`/`centroid` JSONB · `properties`/`quantities` JSONB · soft links `asset_id`/`system_id`. UNIQUE(tenant, model, ifc_guid).
- `bim_element_links` — **polymorphic graph edge:** `element_id` → `entity_type`(`action|punch_item|deficiency|evidence|…`) + `entity_id`. UNIQUE(tenant, element, entity_type, entity_id).
- `ifc_parse_jobs` — queue feeding the 15-s IFC parse worker.
- `cost_items` (`050`, seeded `052`) — CSI MasterFormat: `csi_division/section/code` · `unit` · `material_cost`/`labor_cost`/`equipment_cost` (+ generated `total_cost`) · `region` · `source`(`rsmeans|custom|historical|vendor_quote|ai_estimated`). `tenant_id` NULL = platform-wide seed.
- `takeoff_items` → `estimates` → `estimate_lines` — BIM-driven takeoff to priced estimate; many generated columns for extended/line totals.

### Monte Carlo 🟡 (`051`)
`monte_carlo_runs` (`p10/p50/p80/p90_days`, `…_cost`, `criticality_index`/`cruciality_index` JSONB, `seed`) · `monte_carlo_inputs` (triangular/PERT/uniform/lognormal duration+cost distributions, `predecessors` UUID[]) · `monte_carlo_iterations` (sampled paths) · `monte_carlo_sensitivity` (tornado: Spearman ρ, criticality %). ⚠️ *Engine present; sampling fidelity not independently validated.*

---

## Phase 8 — Financial controls, workforce & business development

### `cost_entries` ✅ (`061`)
`project_id` · `entry_date` · `entry_type` **cost_entry_type**(`labor|material|equipment|subcontract|other`) · `wbs_code` · `amount` CHECK>0 · `quantity`/`unit`/`unit_cost` · `status`(`draft|posted|void`) · `evm_actual_id` *(link to EVM)*.
### `subcontracts` family ✅ (`059`)
- `bid_packages` — `pkg_number` · `csi_code` · `status` **bid_pkg_status**(`draft|issued|closed|awarded|cancelled`) · `budget_amount` · `bid_due_date`.
- `bid_submissions` — `bid_package_id` · `vendor_id` · `status`(`pending|accepted|declined|withdrawn`) · `bid_amount`. UNIQUE(pkg, vendor).
- `subcontracts` — `bid_package_id`/`bid_submission_id`/`vendor_id` · `sc_number` · `status`(`active|suspended|complete|terminated`) · `contract_value` · `retention_pct`.
- `subcontract_invoices` — `inv_number` · `period_start/end` · `gross_amount`/`retention_held`/`net_amount` · `status`.
### `proposals` / `proposal_items` ✅ (`062`)
`proposal_number` · `client_name` · `bid_due_date` · `status` **proposal_status**(`draft|submitted|won|lost|no_bid`) · `estimated_value` · `probability_pct` CHECK 0–100. Items carry generated `total = quantity*unit_cost`.
### `team_members` / `project_assignments` ✅ (`063`)
- `team_members` — `first/last_name` · `role` · `trade` · `hourly_rate` · `status`(`active|inactive|on_leave`).
- `project_assignments` — `member_id`+`project_id` · `assignment_role` **enum**(`project_manager|superintendent|engineer|foreman|inspector|safety_officer|estimator|coordinator|other`) · `allocation_pct` CHECK 1–100 · `start/end_date`.
### `timesheets` ✅ (`065`)
`member_id`+`project_id` · `week_start` · `status`(`draft|submitted|approved|rejected`) · per-day `mon_hrs…sun_hrs` · generated `total_hours` · `wbs_code` · `cost_entry_id` *(feeds cost)*. UNIQUE(tenant, member, project, week_start).
### `meetings` / `meeting_agenda_items` ✅ (`060`)
`mtg_number` · `meeting_type`(`oac|safety|coordination|progress|kickoff|other`) · `status`(`draft|published|archived`) · `attendees` JSONB · agenda items carry `decision` (→ auto-linked to actions).
### `risks` ✅ (`066`/`067` corrected; legacy `risks` in `002`)
`project_id` · `risk_number` INT · `category` **risk_category**(`schedule|cost|scope|safety|technical|regulatory|environmental|procurement|force_majeure|other`) · `status` **risk_status**(`open|mitigating|accepted|closed|occurred`) · `probability`/`impact` CHECK 1–5 · generated `risk_score = p×i` · `residual_probability/impact` + generated `residual_score` · `cost_exposure` · `owner` · `mitigation_plan`/`contingency_plan` · `target_date`. **UNIQUE(tenant, project, risk_number).** *Copilot surfaces `status IN (open,mitigating) AND risk_score≥12`.*
### `notifications` ✅ (`064`)
`category` **notif_category**(`budget|schedule|action_item|bid_deadline|meeting|compliance|change_order|invoice|team|system`) · `priority` · `title`/`body` · `source_type`/`source_id` · `link_tab` · `read_at`/`dismissed_at`. Partial index on unread.

---

## Phase 9 — Readiness, ops, mobile/offline & evidence

### Readiness engine ✅ (`035`)
- `readiness_thresholds` — per `domain` **readiness_domain**(`project|system|subsystem|commissioning|safety|compliance|turnover`): state cutoffs + component weights (open_actions .30, blockers .25, sla_health .20, inspections .15, escalations .10).
- `readiness_scores` — `domain`+`entity_id`/`entity_type` · `readiness_score` · `readiness_state`(`not_ready|at_risk|conditionally_ready|ready`) · `blocking_factors` JSONB · `component_scores` JSONB · `predicted_completion_risk`. UNIQUE(tenant, domain, entity).
- `readiness_snapshots` — nightly history.
### Mobile / offline ✅ schema (`036`) — native client ❌
`mobile_devices` · `sync_sessions` (mutations pushed/pulled, conflicts) · `offline_mutations` (`client_id` idempotency, `status`(`pending|applied|conflicted|rejected|skipped`)) · `offline_conflicts` (client/server JSONB, resolution).
### Evidence pipeline ✅ (`037`)
- `evidence_assets` — `evidence_type`(`photo|video|voice_note|pdf|markup|annotated_drawing|document`) · `status` · `storage_key` · `checksum_sha256` · `geolocation` JSONB · `ocr_text`/`ocr_confidence` · `ai_tags` JSONB. UNIQUE(tenant, checksum).
- `evidence_links` — **polymorphic edge:** `evidence_id` → `entity_type`(`action|inspection|punch_item|asset|…`)+`entity_id` + `context`(`defect_photo|before|after|completion_proof`). UNIQUE(tenant, evidence, entity_type, entity_id).
- `evidence_processing_jobs` — compress/thumbnail/OCR/AI-tag/transcode queue.
### `compliance_tasks` ✅ (`011`)
`category`(`jha|sds|permit|training|inspection|audit`) · `due_date` · `notify_days_before` · `status`(`pending|notified|overdue|completed|waived`). Watched by the compliance worker.
### `field_sync_operations` ✅ (`013`) — server-side idempotency log for offline replay.

---

## Phase 10 — Document control & IoT

### Transmittals ✅ (`051`)
- `transmittals` — `transmittal_number` (auto `TRN-####`) · `subject` · `purpose` **enum**(`for_approval|for_information|for_construction|for_record|for_comment|for_review|as_built`) · `status` **enum**(`draft|sent|received|under_review|actioned|closed|voided`) · `from_party`/`to_party` · `to_contacts`/`cc_contacts` JSONB · `response_required` · `response_due_date` · `response` **enum**(`approved|approved_with_comments|revise_and_resubmit|rejected|received|no_exception_taken|pending`). UNIQUE(tenant, project, number).
- `transmittal_items` — **polymorphic:** links to `evidence_id` OR `document_id` + `rev`/`copies`.
- `transmittal_events` — immutable status-change log (`from_status`→`to_status`, actor).
- `transmittal_counters` — per-(tenant, project) auto-numbering (RLS added `069`).
### IoT ✅ (`055`, token expiry `056`)
- `sensors` — `project_id` · `edge_node_id` · **`bim_element_id`** (geo) · `sensor_uid` · `sensor_type`(`temperature|pressure|flow|vibration|…`) · `unit` · `protocol`(`mqtt|opcua|modbus|http|bacnet`) · warn/alert thresholds · `last_value`/`last_reading_at` · `status`. UNIQUE(tenant, sensor_uid).
- `sensor_readings` — append-only time-series (`ts`, `value`, `quality`(`good|uncertain|bad`)).
- `sensor_alerts` — threshold breaches; `sensor_ingest_tokens` — per-edge-node API key (SHA-256, 90-day expiry).

---

## Phase 11 — Autonomous agents & AI governance 🟡

### `agent_tasks` ✅ (`045`)
`agent_type` · `task_type` · `priority` CHECK 1–10 · `status` **agent_task_status**(`queued|assigned|running|completed|failed|cancelled|pending_approval|blocked`) · `payload`/`context`/`result` JSONB · `parent_task_id` (task tree) · `execution_id` · `claimed_by`/`claimed_at` · retry columns · `idempotency_key` UNIQUE. *Driven by `agentOrchestrator.ts` objective→task-tree planner.*
### `agent_actions` ✅ (`017`) — the "why I did this" ledger
`agent_name` · `action_type` · `target_type`/`target_id` · `decision`(`auto_pass|auto_fail|queued|sent|suppressed`) · **`rationale`** · `rule_id` · `evidence` JSONB · `confidence` NUMERIC(4,3) · `human_reviewable` · `reviewed_by`.
### `ai_recommendation_queue` ✅ (`041`) — human-in-the-loop approval
`action_id` · `recommended_action` · `category` · `confidence_score`/`impact_score`/`urgency_score` CHECK 0–100 · `reason` · `data_signals` JSONB · `affected_entities` JSONB · **`rollback_plan` JSONB** · `approval_required` · `status`(`pending|approved|rejected|executed|expired|cancelled`). *Plus agent memory, runbook engine (`040`), policy engine (`043`), simulation engine (`042`).*
### `ai_usage_records` ✅ (`048`)
Per-call metering: `agent_type`/`model`/`provider` · token counts · `cost_usd` · `latency_ms` · idempotency.

---

## Phase 12 — Digital twin & scenarios 🟡

### `operational_twins` ✅ (`046`) — the digital-twin graph node
`entity_type` **twin_entity_type**(`project|system|subsystem|equipment|tag|workflow|action|inspection|deficiency|permit|vendor|workforce|site|region`) · `entity_id` (source ref) · `name` · `status` **twin_status**(`active|inactive|degraded|failed|maintenance|decommissioned`) · `readiness_score`/`risk_score`/`health_score` · `last_synced_at`/`sync_lag_ms`. UNIQUE(tenant, entity_type, entity_id). *Plus `twin_state_snapshots` (temporal) and scenario tables (`042`).*

---

## Phases 13–15 — Enterprise platform, ecosystem & SSO

### Enterprise / billing 🟡 (`044`, `048`)
`tenant_subscriptions` (tier/status/lifecycle, Stripe ids, seat/AI/storage/API quotas) · `tenant_usage` · `tenant_feature_flags` · `tenant_onboarding_tasks` · `support_tickets` · `compliance_exports` · `api_keys` (hashed, scoped, quota). Integration: `integration_connectors`/`integration_jobs` (health_score, idempotency, dead-letter), `export_jobs`, `audit_integrity_snapshots` (chain hash, gap detection), `worker_leases`.
### Ecosystem 🟡/❌ (`049`)
Federated: `federated_contributions`/`federated_patterns`/`federated_model_versions`/`federated_privacy_audits` (k-anonymity, DP). Benchmarking: `benchmark_cohorts` (p25/50/75/90, suppression). Marketplace: `marketplace_playbooks`/`playbook_versions`/`tenant_playbook_installs`/`playbook_reviews`/`playbook_outcomes`. Plugins: `plugins`/`plugin_versions`/`tenant_plugin_installs`/`plugin_permissions`. Edge: `edge_nodes`/`edge_sync_sessions`/`edge_command_queue`/`edge_audit_buffers`. Workflows: `workflows`/`workflow_versions`/`workflow_runs`. Air-gap: `air_gap_licenses`. **Knowledge graph: `kg_entities`/`kg_relationships`** (see object graph below). External agents: `external_agents`/`external_agent_executions`. Automation adapters: `automation_adapters`/`automation_events` (Zapier/Make/n8n/Power Automate).
### SSO & SCIM ✅ (`073`, `074`)
- `tenant_sso_configs` — `protocol`(`saml|oidc`) · `provider`(`azure_ad|okta|google|onelogin|custom`) · IdP `entity_id`/`sso_url`/`certificate`/`metadata_url` · SP `entity_id`/`sp_cert_id` · attribute-mapping + role-mapping JSONB · `default_role` · `jit_provisioning`. UNIQUE(tenant, protocol). FORCE RLS.
- `sp_certificates` — platform/per-tenant X.509 signing certs. · `saml_sessions` — relay-state + assertion-replay prevention (10-min expiry).
- `scim_tokens` — per-tenant bearer (SHA-256, prefix, expiry). · `scim_audit` — provisioning op log. · `data_deletion_requests` — GDPR erasure trail.

---

## The object graph — how everything connects

Denver's differentiation is connectedness. The edges below already exist in the schema and are what AI-impact analysis traverses (see [PRD §7](PRODUCT_REQUIREMENTS_DOCUMENT.md) and [Architecture §8](SYSTEM_ARCHITECTURE.md)).

```
                                  ┌──────────┐
                                  │ projects │  (budget/forecast/planned_finish/progress_pct)
                                  └────┬─────┘
        ┌───────────────┬─────────────┼───────────────┬─────────────────┐
        ▼               ▼             ▼               ▼                 ▼
     ┌─────┐        ┌─────────┐   ┌─────────┐    ┌─────────┐      ┌──────────────┐
     │ rfis│        │submittals│  │drawings │    │ systems │      │schedule_tasks│
     └──┬──┘        └────┬────┘   └────┬────┘    └────┬────┘      └──────┬───────┘
        │ rfi_id         │             │ drawing_id    │ FK             │ schedule_task_id
        │ (change_orders)│             ▼               ▼                ▼
        │           ┌────┴──────┐  ┌─────────────┐ ┌──────────┐   ┌──────────────┐
        │           │ punch_items│ │drawing_revs │ │subsystems│   │evm_wbs_entries│
        │           └────┬───────┘ └─────────────┘ └────┬─────┘   └──────┬───────┘
        │                │                              ▼                ▼
        │                │                         ┌──────┐         ┌─────────┐
        │                │                         │ tags │         │   EVM   │◀── cost_entries
        │                │                         └──┬───┘         └─────────┘    change_orders
        │                │                            ▼                            budget_items
        │                │                   ┌────────────────────┐
        │                │                   │ commissioning_items│
        │                │                   └─────────┬──────────┘
        │                │                             ▼
        │                │                       ┌──────────┐   ┌────────────┐   ┌─────────────┐
        │                │                       │test_packs│──▶│test_results│──▶│deficiencies │
        │                │                       └──────────┘   └────────────┘   └─────────────┘
        │                │                                                              │
        └────────────────┴───────────────┐                                            │
                                          ▼                                            │
                                    ┌──────────┐   action_relations (blocks/caused_by/  │
   source_module + source_id ─────▶│  actions │◀──  spawned_from/escalated_from) ◀──────┘
   (polymorphic back-link from      └────┬─────┘
    rfis/submittals/punch/insp/         │ bim_element_id (geo soft-link)
    bim_issue/daily_log)                ▼
                                  ┌─────────────┐  bim_element_links (polymorphic) ──▶ punch/defic/action/evidence
                                  │ bim_elements│◀── sensors.bim_element_id (IoT ↔ geometry)
                                  └─────────────┘
   evidence_assets ──evidence_links──▶ {action,inspection,punch_item,asset,…}
   transmittals ──transmittal_items──▶ {documents | evidence_assets}
   knowledge_chunks ◀── Ask Jarvis RAG (pgvector 1536 + FTS)

   ── Two purpose-built graph stores mirror & enrich the above ──
   kg_entities ──kg_relationships(weight,confidence,source=inferred|explicit|federated)──▶ kg_entities
   operational_twins ──twin edges (readiness/risk/health)──▶ operational_twins
```

### Why this matters (and the gap)
- **Today:** the Copilot reads each source (rfis, submittals, risks, inspections, punch_items, actions) **independently** and ranks them; `action_relations`, `bim_element_links`, `evidence_links`, and the Cx chain provide real edges, and `kg_entities`/`kg_relationships` + `operational_twins` are explicit graph stores.
- **The headline build (PRD §7 / Arch §8):** a **traversal service** that walks RFI → drawing → system → test pack → schedule activity → cost code so the Copilot and agents can answer *"what does this RFI put at risk?"* — turning a set of ranked rows into an explained impact chain. Every edge it needs already exists in the tables above; what's missing is the service that materializes and traverses them.

---

## Planned / not-yet-built entities *(planned)*
- **`spec_sections`** *(planned)* — first-class specification entity; today specs live as `submittals.spec_section` strings and documents. Needed for true RFI↔spec↔submittal linkage.
- **Schedule calendars / resource assignments** *(planned)* — `schedule_dependencies` is FS-only; no calendar or resource tables.
- **E-signature / seal ledger** *(planned)* — transmittals/drawings lack cryptographic sign-off records.
- **Materialized graph-traversal cache** *(planned)* — supporting the impact service above.

---

*Grounded in `api/db/migrations/001`–`075` as of the `audit/enterprise-remediation` branch. Field names, enums, and constraints are quoted from the SQL; ⚠️/🟡 marks where capability exists but should not be over-trusted.*
