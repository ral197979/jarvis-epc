-- Denver Engineering — Migration 070: RLS for tables added in migrations 058–065
--
-- Migrations 058–065 created tables with tenant_id columns but omitted
-- ENABLE ROW LEVEL SECURITY and tenant isolation policies. This migration adds
-- the missing protections.
--
-- AUD-031 fix: the original version hard-referenced four tables that were never
-- created by any migration and are unused by the app
-- (`meeting_minutes`, `proposal_line_items`, `notification_preferences`,
-- `timesheet_entries`). That made the entire migration chain fail on a clean
-- rebuild (a disaster-recovery blocker). This version enables RLS + the
-- tenant_isolation policy only on tables that actually exist, so it is both
-- idempotent and clean-rebuildable. Existing deployments are unaffected
-- (already-applied migrations are skipped by filename); any legacy DB that
-- happens to contain one of the phantom tables still gets it protected.

DO $$
DECLARE
  t   text;
  pol text;
  tables text[] := ARRAY[
    -- 058–065 tenant-scoped tables that need RLS (real tables only)
    'change_orders',
    'subcontracts', 'bid_packages',
    'meeting_minutes', 'meeting_agenda_items',
    'cost_entries',
    'proposals', 'proposal_line_items',
    'team_members',
    'notifications', 'notification_preferences',
    'timesheets', 'timesheet_entries'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '[070] skipping % (table absent on this database)', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    pol := t || '_tenant_isolation';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = pol AND polrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
        pol, t
      );
    END IF;
  END LOOP;
END$$;
