-- Denver Engineering — external accounting party mapping
-- ─────────────────────────────────────────────────────────────────────────────
-- The decision this implements
-- ────────────────────────────
-- Denver does NOT get a customer master. An accounting system cannot post a
-- receivable without a customer record, but that record belongs to the
-- accounting system — Denver only needs to know WHICH one a project bills to.
--
-- So this is a mapping, not an entity. It holds an external identifier and
-- nothing else: no name, address, payment terms, credit limit, tax registration
-- or contact. The moment a column like that appears here, Denver has started
-- keeping a customer master and the boundary has moved.
--
-- `projects.client_name` stays exactly what it was: free text, descriptive,
-- never an identifier. It is not a fallback for a missing mapping — AR emission
-- REFUSES when no mapping exists rather than guessing from a string, because a
-- receivable posted against the wrong customer is worse than one not posted.
--
-- Provider-neutral by construction: the mapping is keyed by provider, so a
-- project can be linked to BillBox and QuickBooks simultaneously with different
-- external ids, and adding a provider is a row rather than a schema change.

CREATE TABLE IF NOT EXISTS accounting_party_links (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  -- The Denver relationship being mapped. A receivable is raised against a
  -- project, so the project is what carries the customer relationship.
  project_id          UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Which accounting system this identifier belongs to.
  provider            VARCHAR(40)  NOT NULL,
  -- The customer's id IN THAT SYSTEM. Opaque to Denver; never parsed.
  external_customer_id TEXT        NOT NULL,
  -- Human-readable echo so an operator can confirm what they mapped to.
  -- DESCRIPTIVE ONLY — never matched on, never sent as a party name.
  external_customer_label TEXT,

  linked_by           UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT accounting_party_provider_present CHECK (length(btrim(provider)) > 0),
  CONSTRAINT accounting_party_external_present CHECK (length(btrim(external_customer_id)) > 0),
  -- One customer per project per provider. A second mapping would make the
  -- emission target ambiguous, and an ambiguous receivable must not be posted.
  UNIQUE (tenant_id, project_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_accounting_party_lookup
  ON accounting_party_links (tenant_id, project_id, provider);

ALTER TABLE accounting_party_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_party_links FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'accounting_party_links' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON accounting_party_links
      USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);
  END IF;
END$$;

DROP TRIGGER IF EXISTS trg_accounting_party_updated_at ON accounting_party_links;
CREATE TRIGGER trg_accounting_party_updated_at
  BEFORE UPDATE ON accounting_party_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE accounting_party_links IS
  'Maps a Denver project to a customer id in an external accounting system. '
  'NOT a customer master: holds an external identifier only. AR emission '
  'refuses when the mapping for the target provider is absent.';
