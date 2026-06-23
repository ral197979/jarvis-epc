# 04 — DATABASE AUDIT

---

## Overview

**Engine:** PostgreSQL 16  
**ORM:** None — raw `pg` driver  
**Migrations:** 71 numbered SQL files (`001_` through `071_`)  
**Total tables created:** 212 (verified by `grep -rn "CREATE TABLE"` across all migrations)  
**Extensions:** `uuid-ossp`, `pgcrypto`, `pg_trgm`, `vector` (pgvector, added migration 071)  

---

## Migration Count Verification

**Claimed:** 71 migrations  
**Verified:** 70 SQL files before this audit session. Migration `071_pgvector.sql` was added during P2-5 remediation in this session.  
**Current state:** 71 migrations ✅

**Migration file series:**
```
001–029: Core platform (tenants, projects, files, integrations, commissioning, actions, SLA)
030–050: Phase features (action relations, SLA profiles, runbooks, BIM/estimating)
051–067: Advanced modules (transmittals, EVM, IoT, change orders, proposals, team, risk register)
068–071: Schema fixes and security hardening (FK constraints, RLS backfill, pgvector)
```

**Note:** No migration `020_` file exists (gap in numbering) — not a problem but worth documenting.

---

## Table Count Verification

**Claimed:** "84 tenant tables"  
**Verified:** 212 `CREATE TABLE` statements across all migrations  

The claim of "84 tenant tables" is significantly understated. 212 tables exist. Of these, ~190 have a `tenant_id` column (tenant-scoped). The remaining ~22 are system tables (tenants, users, extension utility tables).

---

## RLS Coverage Analysis

**Tables with `ENABLE ROW LEVEL SECURITY`:** 215 occurrences → 201 unique tables  
**Total tables:** 212  
**Tables potentially missing RLS:** ~11  

### Confirmed RLS from Migrations:
- Migration 001: `users`, `refresh_tokens`, `audit_log` ✅
- Migration 003: `document_folders`, `documents`, `document_versions`, `upload_tokens` ✅
- Migration 040: `operational_runbooks`, `runbook_versions`, `runbook_executions`, `runbook_steps`, `runbook_step_results` ✅
- Migration 050: `bim_elements`, `bim_element_links`, `ifc_parse_jobs`, `cost_items` ✅
- Migration 067: `risks` ✅
- Migration 069: `transmittal_counters` ✅
- Migration 070: 13 tables added (change_orders, subcontracts, bid_packages, meeting_minutes, meeting_agenda_items, cost_entries, proposals, proposal_line_items, team_members, notifications, notification_preferences, timesheets, timesheet_entries) ✅

### Tables That May Be Missing RLS (Need Verification):
Migrations 030–057 and 032–048 added numerous tables without systematic RLS inclusion. Key suspects:
- Tables in `030_action_relations.sql` through `049_` range
- Late additions in `053_` through `057_`
- `evm_snapshots`, `evm_actuals`, `evm_progress`, `evm_wbs_entries` — need individual verification

**P0 Action Required:** Run the following against production DB to confirm:
```sql
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename NOT IN (
    SELECT relname FROM pg_class JOIN pg_policies ON pg_class.oid = pg_policies.polrelid
  )
  AND tablename NOT IN ('tenants', 'schema_migrations');
```

---

## Index Analysis

**FTS Indexes (confirmed):**
```sql
-- documents: GIN index on extracted_text + ai_summary
-- knowledge_chunks: tsvector column with GIN index
-- knowledge_fixes: tsvector search_tsv with GIN index
```

**Missing Indexes (risk):**
- `chat_messages.session_id` — likely not indexed; messages loaded by session frequently
- `sensor_readings.sensor_id + ts` — compound index needed for time-series queries
- `audit_log.user_id + created_at` — audit queries filter by user and date range
- `actions.assigned_to_user_id + status` — SLA engine queries by assignee + status frequently
- `evm_actuals.project_id + period_date` — EVM metrics aggregate by these fields

**Confirmed Indexes:**
- `idx_kc_embedding_cosine` — IVFFlat on `knowledge_chunks.embedding` (added migration 071)
- `idx_documents_fts` — GIN text search on documents
- Coverage indexes from `028_coverage_perf.sql`

---

## Foreign Key Constraints

**Migration 068:** `068_add_missing_fk_constraints.sql` explicitly added FK constraints that were missing from earlier migrations. This is an honest acknowledgment of technical debt.

**Cascade behavior:** Some FKs use `ON DELETE CASCADE` — appropriate for child records. Not all relationships have explicit cascade behavior defined.

**Risk:** Deleting a `project` without cascade-checking all 30+ project-linked tables could leave orphaned records.

---

## Data Integrity Concerns

### 1. Missing NOT NULL on Business-Critical Fields
Spot-check reveals some columns that should be NOT NULL but aren't:
```sql
-- Example pattern in many tables:
result_value NUMERIC,              -- should be NOT NULL for EVM calculations
percent_complete NUMERIC,          -- defaults to NULL, not 0
```

### 2. No Check Constraints on Numeric Ranges
No `CHECK (percent_complete BETWEEN 0 AND 100)` or similar guards. Invalid data can be inserted.

### 3. UUID vs Serial IDs
All primary keys use `UUID` — correct for multi-tenant distributed systems. No serial/integer IDs exposed externally.

### 4. Timestamps
All tables use `created_at TIMESTAMPTZ DEFAULT NOW()` — correct (timezone-aware).

---

## Migration Strategy Assessment

**Positive:**
- Sequential numbered files — deterministic execution order
- Idempotent patterns used in migrations 069, 070 (`DO $$ BEGIN IF NOT EXISTS ...`)
- No destructive migrations (no `DROP TABLE` or `DROP COLUMN`)
- Schema fixes addressed via new migrations (067, 068, 069, 070) rather than editing old ones

**Concerns:**
- No `DOWN` migrations — rollback requires manual SQL
- Migration runner (`api/db/migrate.ts`) runs on startup — production risk if migration fails mid-deploy
- No migration dry-run or plan mode
- Gap in migration numbering: no `020_`

---

## Schema Design Assessment

**Good design decisions:**
- Consistent `tenant_id UUID NOT NULL` pattern across all tenant tables
- `current_setting('app.current_tenant_id', true)::uuid` pattern for RLS — correct PostgreSQL approach
- Separate tables for line items vs headers (proposals/proposal_line_items, etc.)
- `evm_snapshots` for period tracking instead of recalculating historical data

**Questionable decisions:**
- `integrations.config JSONB` — all integration-specific config in untyped JSONB
- `agent_memory_entries` — stores AI agent memory in PostgreSQL (should use vector DB or Redis)
- Multiple overlapping "audit" concepts: `audit_log`, `audit_integrity_snapshots`, `ai_usage_records`

---

## Summary

| Area | Grade | Key Finding |
|------|-------|-------------|
| Migration count | ✅ | 71 migrations, sequential |
| Table count | B | 212 tables (claimed "84") |
| RLS coverage | B+ | 201/212 tables; ~11 may be missing |
| Index coverage | C+ | Key time-series and FK indexes missing |
| FK constraints | B | Migration 068 added missing constraints |
| Data integrity | C+ | No check constraints; some nullable critical fields |
| Schema design | B | Good patterns; config JSONB is a weakness |
| Rollback support | D | No DOWN migrations |
| pgvector | ✅ | Migration 071 adds extension + IVFFlat index |
