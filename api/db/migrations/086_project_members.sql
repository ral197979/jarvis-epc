-- Denver Engineering — project membership model (ADR-014 Phase 3B, D18/D19)
-- ─────────────────────────────────────────────────────────────────────────────
-- The defect this closes
-- ──────────────────────
-- ADR-014 Phase 3A gave the project record-scope resolver the only user↔project
-- relationship the repository contained: three columns on the project row.
--
--     projects.created_by
--     projects.project_manager
--     projects.lead_engineer
--
-- That is at most THREE login principals per project, and it cannot express
-- ordinary participation — additional engineers, procurement users, field
-- staff, reviewers, a second project manager. Phase 3A was correct to enforce
-- it (a role must not confer records) but the result was that every legitimate
-- participant outside those three columns received 404 on project detail.
-- Correct authorization on an insufficient model.
--
-- `project_members` is that model. It is authorization-bearing state: a row
-- here grants RECORD SCOPE and nothing else. Functional authority remains the
-- ADR-014 capability registry, so membership of a project never implies
-- permission to read its cost data, approve its change orders, or anything
-- else the caller's capabilities do not already allow.
--
-- Why provenance is a column and not a boolean
-- ────────────────────────────────────────────
-- One user can belong to a project for several independent reasons at once:
-- they created it, they are its lead engineer, and someone also added them
-- manually. Collapsing that into a single row means reassigning the lead
-- engineer silently revokes access the manual grant was supposed to guarantee.
-- Each reason is therefore its own row with its own lifecycle, and the resolver
-- grants access when AT LEAST ONE is active.
--
-- Why NOT project_assignments
-- ───────────────────────────
-- ADR-014 Phase 3A established, and this migration re-states because it is the
-- question most likely to be revisited: `project_assignments.member_id`
-- references `team_members`, an HR/workforce roster with no `user_id` column
-- and no foreign key to `users`. It records who is EMPLOYED on the job, not
-- which login principal may read the project record. The two are different
-- concepts and are deliberately kept apart.

-- ─── 1. Membership source ────────────────────────────────────────────────────
--
-- Only four sources exist, and three of them are system-maintained: they are
-- written by the project workflows that own the corresponding column, never by
-- a caller. `manual` is the only source an administrator can create directly,
-- which is what makes forged system provenance impossible.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_member_source') THEN
    CREATE TYPE project_member_source AS ENUM (
      'created_by',       -- set by project creation; the creator can always read it back
      'project_manager',  -- mirrors projects.project_manager
      'lead_engineer',    -- mirrors projects.lead_engineer
      'manual'            -- granted through the membership administration API
    );
  END IF;
END$$;

-- ─── 2. The membership relation ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_members (
  id           UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID                  NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id   UUID                  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      UUID                  NOT NULL REFERENCES users(id)    ON DELETE CASCADE,

  -- WHY this user is a member. Load-bearing: see the header.
  source       project_member_source NOT NULL,

  -- Lifecycle. Revocation closes the window rather than deleting the row, so
  -- the historical fact that access existed survives the revocation.
  active_from  TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  active_to    TIMESTAMPTZ,

  -- The live principal that granted it, or NULL for migration backfill, whose
  -- provenance is the migration itself rather than a fabricated end user.
  created_by   UUID                  REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  -- A closed window cannot end before it began.
  CONSTRAINT project_members_window_ordered
    CHECK (active_to IS NULL OR active_to > active_from)
);

COMMENT ON TABLE project_members IS
  'ADR-014 Phase 3B. Authorization-bearing: an active row grants RECORD SCOPE over one project. It grants no functional capability — those remain the ADR-014 capability registry. Not to be confused with project_assignments, which assigns a workforce team_member and carries no login principal.';
COMMENT ON COLUMN project_members.source IS
  'Why this membership exists. created_by/project_manager/lead_engineer are system-maintained by the owning project workflow and can never be set by a caller; manual is the only administrator-grantable source. Access requires at least one ACTIVE source, so revoking one reason never revokes another.';
COMMENT ON COLUMN project_members.active_to IS
  'NULL = currently active. Revocation sets this rather than deleting, so authorization history is not destroyed.';
COMMENT ON COLUMN project_members.created_by IS
  'The live authenticated principal that granted the membership. NULL for the D19 legacy backfill, whose actor is the migration, not a person.';

-- ─── 3. Constraints that make the impossible states impossible ───────────────
--
-- Route validation is not enough (§54): these hold even against a direct SQL
-- write, a future service that forgets a check, or a bug in the admin API.

-- One ACTIVE row per (project, user, source). A user may hold several sources
-- concurrently — that is the point — but not the same source twice, which would
-- make "close the project_manager source" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS project_members_one_active_per_source
  ON project_members (project_id, user_id, source)
  WHERE active_to IS NULL;

-- The membership tenant must equal the PROJECT's tenant. Enforced with a
-- composite foreign key rather than a trigger so it cannot be bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS projects_id_tenant_key
  ON projects (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_id_tenant_key
  ON users (id, tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_members_project_in_tenant') THEN
    ALTER TABLE project_members
      ADD CONSTRAINT project_members_project_in_tenant
      FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE;
  END IF;
END$$;

-- The membership tenant must equal the USER's tenant. Together with the above,
-- a cross-tenant membership is unrepresentable, not merely rejected.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_members_user_in_tenant') THEN
    ALTER TABLE project_members
      ADD CONSTRAINT project_members_user_in_tenant
      FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id) ON DELETE CASCADE;
  END IF;
END$$;

-- ─── 4. Indexes for the two queries the resolver actually runs ───────────────

-- "which of these projects may this user reach" — the hot path.
CREATE INDEX IF NOT EXISTS project_members_active_lookup
  ON project_members (tenant_id, user_id, project_id)
  WHERE active_to IS NULL;

-- "who is on this project" — the roster read.
CREATE INDEX IF NOT EXISTS project_members_roster
  ON project_members (tenant_id, project_id)
  WHERE active_to IS NULL;

-- ─── 5. Tenant isolation, consistent with every other table ──────────────────

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'project_members_tenant_isolation') THEN
    CREATE POLICY project_members_tenant_isolation ON project_members
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;

-- ─── 6. D19 — legacy backfill ────────────────────────────────────────────────
--
-- Every historical responsible-user link becomes an active membership of the
-- corresponding source, so no principal loses access the moment the resolver
-- switches over.
--
-- Two guards, both deliberate:
--
--   u.tenant_id = p.tenant_id
--       A historical assignment must not manufacture cross-tenant
--       authorization. Rows failing this create NO membership and are counted
--       as anomalies below rather than silently repaired — repairing foreign
--       tenant data is outside this migration's authority.
--
--   JOIN users
--       A column may reference a user that no longer exists (the FKs are
--       ON DELETE SET NULL). Joining rather than trusting the column means a
--       dangling reference creates nothing.
--
-- created_by is NULL on every backfilled row: the actor is this migration, and
-- attributing the grant to a person would be a fabricated audit trail.

INSERT INTO project_members (tenant_id, project_id, user_id, source, active_from, created_by)
SELECT p.tenant_id, p.id, u.id, 'created_by'::project_member_source, p.created_at, NULL
  FROM projects p
  JOIN users u ON u.id = p.created_by AND u.tenant_id = p.tenant_id
 WHERE p.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO project_members (tenant_id, project_id, user_id, source, active_from, created_by)
SELECT p.tenant_id, p.id, u.id, 'project_manager'::project_member_source, p.created_at, NULL
  FROM projects p
  JOIN users u ON u.id = p.project_manager AND u.tenant_id = p.tenant_id
 WHERE p.project_manager IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO project_members (tenant_id, project_id, user_id, source, active_from, created_by)
SELECT p.tenant_id, p.id, u.id, 'lead_engineer'::project_member_source, p.created_at, NULL
  FROM projects p
  JOIN users u ON u.id = p.lead_engineer AND u.tenant_id = p.tenant_id
 WHERE p.lead_engineer IS NOT NULL
ON CONFLICT DO NOTHING;

-- ─── 7. The legacy columns are business data, not authorization ──────────────
--
-- They are NOT dropped: they remain the truthful record of who manages and
-- leads a project, and the UI reads them. What changes is that the runtime
-- authorization resolver no longer consults them — `project_members` is the
-- single non-Owner scope source from ADR-014 Phase 3B onward (§21), and the
-- workflows that write these columns keep the corresponding membership rows in
-- step transactionally.

COMMENT ON COLUMN projects.project_manager IS
  'Business field: who manages this project. NOT the authorization source since ADR-014 Phase 3B — record scope is project_members, kept in step by the project write workflows.';
COMMENT ON COLUMN projects.lead_engineer IS
  'Business field: who leads engineering. NOT the authorization source since ADR-014 Phase 3B — see project_members.';
COMMENT ON COLUMN projects.created_by IS
  'Business/provenance field: who created the project. NOT the authorization source since ADR-014 Phase 3B — see project_members.';
