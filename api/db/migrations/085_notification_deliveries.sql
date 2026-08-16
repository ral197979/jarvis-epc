-- Denver Engineering — notification ownership model (ADR-014 Phase 2C-4B, D13)
-- ─────────────────────────────────────────────────────────────────────────────
-- Splits one tenant-shared row into a shared ALERT EVENT plus PER-USER DELIVERY.
--
-- The defect this closes
-- ──────────────────────
-- `notifications` had no recipient column, and `read_at`/`dismissed_at` were
-- single columns on a row every user in the tenant saw. One user marking a
-- notification read marked it read for everyone; `read-all` and `clear` wiped
-- the feed for the whole tenant. There was no personal scope to authorize
-- against, which is why ADR-014 Phase 2C-4A deferred these seven endpoints
-- rather than inventing an ownership model.
--
-- The event also carries the authority required to see it. Delivery membership
-- is NOT permanent authorization: a user who receives an alert and is then
-- demoted must stop seeing it, so the runtime re-checks
-- `required_capabilities` against the live principal on every access.
--
-- Legacy rows (D14): historical events have no trustworthy recipient identity,
-- so they are backfilled to active OWNERS ONLY, under `crossdomain.read`.
-- Inventing a wider historical audience would leak cost, CRM and procurement
-- content that the alert bodies demonstrably contain.

-- ─── 1. The shared event gains its source-authorization policy ───────────────

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS policy_key             TEXT,
  ADD COLUMN IF NOT EXISTS required_capabilities  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience_strategy      TEXT;

COMMENT ON COLUMN notifications.required_capabilities IS
  'Server-derived source-read authority for this event. Re-checked against the live principal on every read/mutation; never accepted from a client.';
COMMENT ON COLUMN notifications.read_at IS
  'LEGACY — tenant-shared read state. Dormant from ADR-014 Phase 2C-4B; personal state lives in notification_deliveries. Runtime code must not write this.';
COMMENT ON COLUMN notifications.dismissed_at IS
  'LEGACY — tenant-shared dismiss state. Dormant from ADR-014 Phase 2C-4B; see notification_deliveries.';

-- ─── 2. Per-user delivery ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  notification_id UUID        NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  read_at         TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One delivery per event per user. Enforced by the database so a concurrent
  -- or repeated scan cannot fan out twice; an application pre-check cannot.
  CONSTRAINT notification_deliveries_unique UNIQUE (notification_id, user_id)
);

-- Inbox listing: this tenant's undismissed deliveries for one user, newest first.
CREATE INDEX IF NOT EXISTS notification_deliveries_inbox
  ON notification_deliveries (tenant_id, user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

-- Unread badge count.
CREATE INDEX IF NOT EXISTS notification_deliveries_unread
  ON notification_deliveries (tenant_id, user_id)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

-- Event → its deliveries, for fan-out and cascade.
CREATE INDEX IF NOT EXISTS notification_deliveries_notification
  ON notification_deliveries (notification_id);

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'notification_deliveries_tenant_isolation') THEN
    CREATE POLICY notification_deliveries_tenant_isolation ON notification_deliveries
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;

-- ─── 3. Legacy backfill — D14, owner-only, fail closed ───────────────────────
-- Every pre-existing event is marked LEGACY_OWNER_ONLY and requires
-- `crossdomain.read`, because its body may mix budget, bid, change-order and
-- invoice content whose provenance the row does not record.

UPDATE notifications
   SET policy_key            = 'legacy.pre_2c4b',
       audience_strategy     = 'LEGACY_OWNER_ONLY',
       required_capabilities = ARRAY['crossdomain.read']
 WHERE policy_key IS NULL;

-- One delivery per legacy event per ACTIVE OWNER of that event's tenant.
-- The historical shared read/dismiss state transfers to the owner delivery and
-- to nobody else: it is not evidence about any other user.
-- A tenant with no active owner keeps its events and gets zero deliveries.
INSERT INTO notification_deliveries
       (tenant_id, notification_id, user_id, read_at, dismissed_at, created_at)
SELECT n.tenant_id, n.id, u.id, n.read_at, n.dismissed_at, n.created_at
  FROM notifications n
  JOIN users u
    ON u.tenant_id = n.tenant_id
   AND u.role      = 'owner'
   AND u.is_active = TRUE
 WHERE n.audience_strategy = 'LEGACY_OWNER_ONLY'
ON CONFLICT (notification_id, user_id) DO NOTHING;
