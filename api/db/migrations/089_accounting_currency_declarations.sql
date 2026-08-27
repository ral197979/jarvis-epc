-- Denver Engineering — governed accounting currency declaration
-- ─────────────────────────────────────────────────────────────────────────────
-- OWNER DECISION, 2026-08-25 (currency): a document may only be emitted with an
-- EXPLICIT, GOVERNED ISO-4217 currency. There is no USD fallback, no provider
-- default, and no tenant default. A money-bearing document whose project has no
-- declaration is REFUSED, with a named reason.
--
-- Why a new table rather than an existing column
-- ──────────────────────────────────────────────
-- Denver already stores a currency in four places — `projects.currency`,
-- `contracts.currency`, `purchase_orders.currency` and the estimating tables —
-- and every one of them is `DEFAULT 'USD'`. That default is the problem this
-- decision exists to close: a row reading 'USD' is indistinguishable from a row
-- nobody ever set, so reading it and calling the result "the currency" would be
-- inferring a fallback while claiming to have been told. Denver cannot tell the
-- difference after the fact, and it must not pretend it can.
--
-- So the declaration is its own record with no default at all. A row here means
-- a named human, at a known time, said what currency this project's money is
-- denominated in. No row means nobody has said, and nothing may be emitted.
--
-- The existing `*.currency` columns are deliberately left alone. They are
-- Denver's own display and reporting values and are not this boundary's
-- business; this migration neither reads them, copies them, nor backfills from
-- them. Backfilling would manufacture exactly the governed declarations the
-- decision requires to be genuine.
--
-- Provider-neutral by construction
-- ────────────────────────────────
-- There is no `provider` column. The currency a project's money is denominated
-- in is a fact about the commercial relationship, not about which accounting
-- system happens to receive it. A per-provider currency would let the same
-- receivable be sent to BillBox as EUR and to QuickBooks as USD, which is not a
-- mapping decision but a misstatement.
--
-- Denver still holds no ledger. This records WHICH currency, never a rate, a
-- revaluation, a translation, or a reporting-currency equivalent — all of which
-- belong to the accounting system.

CREATE TABLE IF NOT EXISTS accounting_currency_declarations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  -- Every money-bearing document Denver can emit hangs off a project: a pay
  -- application is raised against one, a subcontract invoice reaches one
  -- through its subcontract, and a purchase order names one. A vendor master
  -- record carries no money and therefore needs no declaration.
  project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- ISO-4217 alphabetic code. NO DEFAULT — the absence of a value is the
  -- signal, and a default would destroy it.
  currency     CHAR(3)     NOT NULL,

  -- Who said so, and when. A declaration without an author is not governed.
  declared_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  declared_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Optional free text: why this currency. Descriptive, never parsed.
  note         TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Shape only. The authoritative ISO-4217 membership check lives in
  -- `accountingCurrency.ts`, because the code list is reference data that
  -- changes without a schema change. This constraint stops obvious garbage
  -- reaching the column; it is not the governance control.
  CONSTRAINT accounting_currency_iso_shape CHECK (currency ~ '^[A-Z]{3}$'),

  -- One declaration per project. A second row would make every amount on the
  -- project ambiguous, and an ambiguous amount must not be emitted.
  UNIQUE (tenant_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_currency_lookup
  ON accounting_currency_declarations (tenant_id, project_id);

ALTER TABLE accounting_currency_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_currency_declarations FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'accounting_currency_declarations' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON accounting_currency_declarations
      USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);
  END IF;
END$$;

DROP TRIGGER IF EXISTS trg_accounting_currency_updated_at ON accounting_currency_declarations;
CREATE TRIGGER trg_accounting_currency_updated_at
  BEFORE UPDATE ON accounting_currency_declarations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE accounting_currency_declarations IS
  'The explicit ISO-4217 currency a project''s emitted commercial documents are '
  'denominated in. No default and no backfill: absence means undeclared, and a '
  'money-bearing document for an undeclared project is refused rather than '
  'assumed to be USD.';
