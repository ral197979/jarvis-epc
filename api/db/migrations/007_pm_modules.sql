-- ============================================================
-- JARVIS EPC — Migration 007: PM Modules (Procore/Autodesk Parity)
-- v4.31.0 | Daily Logs, Drawings + Markups, BIM Models, Budget, Change Orders
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- DAILY LOGS  (Procore-parity field reporting)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE daily_logs (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_date           DATE         NOT NULL,
  weather            VARCHAR(60),                 -- 'sunny', 'rain', 'overcast', etc.
  temp_f             NUMERIC(5,1),
  wind_mph           NUMERIC(5,1),
  humidity_pct       NUMERIC(5,1),
  manpower           JSONB        NOT NULL DEFAULT '[]',  -- [{trade, count, hours, contractor}]
  equipment          JSONB        NOT NULL DEFAULT '[]',  -- [{type, id, hours, operator}]
  visitors           JSONB        NOT NULL DEFAULT '[]',  -- [{name, company, purpose, arrive, depart}]
  deliveries         JSONB        NOT NULL DEFAULT '[]',  -- [{vendor, item, qty, po_number}]
  work_performed     TEXT,
  delays             TEXT,
  safety_notes       TEXT,
  incidents          JSONB        NOT NULL DEFAULT '[]',  -- [{time, severity, description, reported_to}]
  quality_notes      TEXT,
  photos             JSONB        NOT NULL DEFAULT '[]',  -- [{file_id, caption, geotag, taken_at}]
  status             VARCHAR(20)  NOT NULL DEFAULT 'draft',  -- draft | submitted | approved
  submitted_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
  submitted_at       TIMESTAMPTZ,
  approved_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  approved_at        TIMESTAMPTZ,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, log_date)
);
CREATE INDEX idx_daily_logs_tenant  ON daily_logs(tenant_id);
CREATE INDEX idx_daily_logs_project ON daily_logs(project_id, log_date DESC);
CREATE INDEX idx_daily_logs_status  ON daily_logs(tenant_id, status);
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_daily_logs ON daily_logs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_daily_logs_updated_at BEFORE UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ──────────────────────────────────────────────────────────────
-- DRAWINGS  (Autodesk/Procore-parity plans register)
-- ──────────────────────────────────────────────────────────────
-- Drawings reference a file stored in documents / file_versions.
-- Revision lifecycle: current_rev tracks the active sheet.
CREATE TABLE drawings (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_number       VARCHAR(50)  NOT NULL,         -- e.g. M-101, E-203
  title              VARCHAR(255) NOT NULL,
  discipline         VARCHAR(60),                   -- 'mechanical','electrical','plumbing','structural','civil','architectural','process'
  current_rev        VARCHAR(20)  NOT NULL DEFAULT 'A',
  set_name           VARCHAR(120),                  -- e.g. '90% CD Set', 'IFC Set'
  issue_date         DATE,
  document_id        UUID         REFERENCES documents(id) ON DELETE SET NULL,  -- active PDF
  scale              VARCHAR(40),
  page_count         INTEGER      NOT NULL DEFAULT 1,
  metadata           JSONB        NOT NULL DEFAULT '{}',
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, sheet_number, current_rev)
);
CREATE INDEX idx_drawings_tenant   ON drawings(tenant_id);
CREATE INDEX idx_drawings_project  ON drawings(project_id, discipline, sheet_number);
ALTER TABLE drawings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_drawings ON drawings
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_drawings_updated_at BEFORE UPDATE ON drawings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Revisions history (IFC, IFR, ASI, etc.)
CREATE TABLE drawing_revisions (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  drawing_id         UUID         NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  rev                VARCHAR(20)  NOT NULL,
  issued_date        DATE         NOT NULL,
  reason             TEXT,
  document_id        UUID         REFERENCES documents(id) ON DELETE SET NULL,
  issued_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (drawing_id, rev)
);
CREATE INDEX idx_drawing_revisions_drawing ON drawing_revisions(drawing_id, issued_date DESC);
ALTER TABLE drawing_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_drawing_revisions ON drawing_revisions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- Redline / markup annotations on a drawing page.
-- annotations is PDF.js-compatible JSON (or simple shape schema):
--   [{ type:'rect', page:1, x, y, w, h, color, note }, {type:'text', page:2, x, y, text }, ...]
CREATE TABLE drawing_markups (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  drawing_id         UUID         NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  rev                VARCHAR(20)  NOT NULL,         -- markups are bound to the rev they were drawn on
  page               INTEGER      NOT NULL DEFAULT 1,
  title              VARCHAR(200),
  annotations        JSONB        NOT NULL DEFAULT '[]',
  resolved           BOOLEAN      NOT NULL DEFAULT FALSE,
  resolved_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  resolved_at        TIMESTAMPTZ,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_drawing_markups_drawing ON drawing_markups(drawing_id, rev, page);
CREATE INDEX idx_drawing_markups_open    ON drawing_markups(tenant_id, resolved) WHERE resolved = FALSE;
ALTER TABLE drawing_markups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_drawing_markups ON drawing_markups
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_drawing_markups_updated_at BEFORE UPDATE ON drawing_markups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ──────────────────────────────────────────────────────────────
-- BIM MODELS  (Autodesk parity — IFC / glTF 3D coordination)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE bim_models (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name               VARCHAR(200) NOT NULL,
  discipline         VARCHAR(60),
  format             VARCHAR(20)  NOT NULL,       -- 'ifc' | 'glb' | 'gltf' | 'nwd' | 'rvt'
  document_id        UUID         REFERENCES documents(id) ON DELETE SET NULL,
  size_bytes         BIGINT       NOT NULL DEFAULT 0,
  element_count      INTEGER,                      -- populated by post-processing if available
  coord_system       VARCHAR(60),
  georef             JSONB        NOT NULL DEFAULT '{}',  -- {lat, lon, site_offset_ft}
  metadata           JSONB        NOT NULL DEFAULT '{}',
  status             VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bim_models_tenant  ON bim_models(tenant_id);
CREATE INDEX idx_bim_models_project ON bim_models(project_id);
ALTER TABLE bim_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bim_models ON bim_models
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_bim_models_updated_at BEFORE UPDATE ON bim_models
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Clash / issue tracking tied to BIM coordinates (coordination-model parity)
CREATE TABLE bim_issues (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_id           UUID         REFERENCES bim_models(id) ON DELETE SET NULL,
  title              VARCHAR(200) NOT NULL,
  description        TEXT,
  severity           VARCHAR(20)  NOT NULL DEFAULT 'minor',  -- minor | major | critical
  status             VARCHAR(20)  NOT NULL DEFAULT 'open',   -- open | in_review | resolved | closed
  element_ids        JSONB        NOT NULL DEFAULT '[]',     -- IFC GUIDs of clashing elements
  viewpoint          JSONB        NOT NULL DEFAULT '{}',     -- {camera, target, clipping_planes}
  assigned_to        UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bim_issues_project ON bim_issues(project_id, status);
ALTER TABLE bim_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bim_issues ON bim_issues
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_bim_issues_updated_at BEFORE UPDATE ON bim_issues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ──────────────────────────────────────────────────────────────
-- BUDGET & COST CONTROL  (Procore Financials parity)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE budgets (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name               VARCHAR(200) NOT NULL DEFAULT 'Project Budget',
  currency           VARCHAR(10)  NOT NULL DEFAULT 'USD',
  original_total     NUMERIC(18,2) NOT NULL DEFAULT 0,
  revised_total      NUMERIC(18,2) NOT NULL DEFAULT 0,
  committed_total    NUMERIC(18,2) NOT NULL DEFAULT 0,
  actual_total       NUMERIC(18,2) NOT NULL DEFAULT 0,
  forecast_total     NUMERIC(18,2) NOT NULL DEFAULT 0,
  baseline_date      DATE,
  status             VARCHAR(20)  NOT NULL DEFAULT 'draft',  -- draft | baselined | locked
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id)
);
CREATE INDEX idx_budgets_tenant  ON budgets(tenant_id);
CREATE INDEX idx_budgets_project ON budgets(project_id);
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_budgets ON budgets
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_budgets_updated_at BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE budget_items (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  budget_id          UUID         NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  cost_code          VARCHAR(40)  NOT NULL,         -- CSI / WBS / internal
  description        VARCHAR(500) NOT NULL,
  category           VARCHAR(60),                   -- labor | material | equipment | subcontract | other
  unit               VARCHAR(20),
  qty                NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit_cost          NUMERIC(14,4) NOT NULL DEFAULT 0,
  original_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
  revised_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
  committed_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
  actual_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,
  forecast_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes              TEXT,
  sort_order         INTEGER       NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_budget_items_budget ON budget_items(budget_id, sort_order);
CREATE INDEX idx_budget_items_cost_code ON budget_items(tenant_id, cost_code);
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_budget_items ON budget_items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_budget_items_updated_at BEFORE UPDATE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Change Orders (Owner COs and PCO / Prime COs)
CREATE TABLE ULT 0,
  forec    budget/r─� dapp.  NOT NULL REFE��
CREATE TABLE budgets (W(_id    hZW EXECUTE FUNCTION set_updatT NULL RON se 
CREATE TABLE budgommitted_total    NUMERptionCUTE _id | Oid | TE CASCADE,T N         NOT NULL REFERENCES tenants(id) ON DELEADE,
  project_id         ays, status,LL REFERENCES t     UUID         NOT NULLoUSIN_r{ requi|LEADign_t.rowi|LfftatndiN DELE| Tcope_addE| TcFailed
O')}-${S        NOT NMERIC(18,2) NOT NULL DEFAULT 0,
  reLUES ($1,$2,$333333T 0,
  committed_amount   NUMERIC(18    JSONB        NOT NULL DEFAULT '[]',  -- [{time, severity, description, reported_to}]
 ARCHA    
 ARCed_by='$
quality_notes      TEXT,
  photos             JSONB        NOT NULL DEFAULT '[]',  -- [{file_id, caption, geotag, taken_at}]
  status             VARCHAR(20)  NOT NULL DEFAULT 'draft',  -- draft | submitted | approved
  ed_by='${r.submitted | approved
        PRIMARY KEY DEFAULT uuidLT '[]',     -- IFC GUIDs of clashing elements
  viewpoint          JSONB        NOT NULL DEFAULT '{}',     -- {camera, target, clipping_planes}
  assigned_to        UUID         REFERENCES u      NOT NULL DEFAULT '{}',
  creaLL REFE�� NOT NULL DEFAULT 0,
 rent_tenant_i       TIMESrent_tenant_iD         REFERENCES users(id) ON rent_tenant_idESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_budgrent_tenant_idMESrent_tenant_iems(budget_id, sort_order);
CREATE INDEX idx_budget_items_cost_code ON budget_items(tenant_id, crent_tenant_i TER TABLE budget_items ENABLrent_tenant_iemsURITY;
CREATE POLICY tenant_isolation_budget_items ONHelpAND         }
})

   VA(inaompy=' tal  sd
 */
EVEL etting('aRITREPLACE VIEWem' })
  }
})

AS
: RequTE FId/bAS Number(b.uTE FI         RETE FILL DEFAULTTE FI', async TE COALESCE(SUM(bide || !b.descriptrit0: ResE,
  project_i TE COALESCE(SUM(bidcontract | oth   UU0: ResS projects(id TE COALESCE(SUM(bidy                  0: ResVARCHAR(200) NO TE COALESCE(SUM(bidit_cost         UUI0: Resncy          TE COALESCE(SUM(bidiginal_amount  trit0: Resiginal_total   TE CO, rebidpoinResEVEL     V
�────b
LEFT('/projects/ms_budgbisues Et/rollup',tenanid
GROUPconsanid;0]) return res.status(404).json({ error: 'Issue not found' })
    res.json({ issue: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to update issue' })
  }
})

export { router as bimRouter }
