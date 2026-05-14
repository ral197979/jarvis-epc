-- Denver Engineering — Migration 062: Proposals & Bid Pipeline (v10.12.0)
-- Tracks GC proposals/bids to owners through the full win/loss lifecycle.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'proposal_status') THEN
    CREATE TYPE proposal_status AS ENUM ('draft','submitted','won','lost','no_bid');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS proposals (
  id               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID            NOT NULL,
  proposal_number  INT             NOT NULL,
  title            TEXT            NOT NULL,
  client_name      TEXT            NOT NULL,
  client_contact   TEXT,
  bid_due_date     DATE,
  submitted_date   DATE,
  decided_date     DATE,
  status           proposal_status NOT NULL DEFAULT 'draft',
  estimated_value  NUMERIC(16,2)   NOT NULL DEFAULT 0,
  probability_pct  INT             NOT NULL DEFAULT 50 CHECK (probability_pct BETWEEN 0 AND 100),
  notes            TEXT,
  created_by       TEXT,
  created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, proposal_number)
);

CREATE TABLE IF NOT EXISTS proposal_items (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID          NOT NULL,
  proposal_id  UUID          NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  sort_order   INT           NOT NULL DEFAULT 0,
  description  TEXT          NOT NULL,
  quantity     NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit         TEXT,
  unit_cost    NUMERIC(14,4) NOT NULL DEFAULT 0,
  total        NUMERIC(16,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proposals_tenant_status
  ON proposals (tenant_id, status, bid_due_date DESC);

CREATE INDEX IF NOT EXISTS proposal_items_proposal
  ON proposal_items (proposal_id, sort_order);

ALTER TABLE proposals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_items  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'proposals_tenant_isolation') THEN
    CREATE POLICY proposals_tenant_isolation ON proposals
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'proposal_items_tenant_isolation') THEN
    CREATE POLICY proposal_items_tenant_isolation ON proposal_items
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;
