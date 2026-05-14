-- Denver Engineering — Migration 064: Notifications (v10.14.0)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notif_priority') THEN
    CREATE TYPE notif_priority AS ENUM ('low','medium','high','critical');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notif_category') THEN
    CREATE TYPE notif_category AS ENUM (
      'budget','schedule','action_item','bid_deadline',
      'meeting','compliance','change_order','invoice','team','system'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS notifications (
  id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID            NOT NULL,
  category     notif_category  NOT NULL,
  priority     notif_priority  NOT NULL DEFAULT 'medium',
  title        TEXT            NOT NULL,
  body         TEXT,
  source_type  TEXT,           -- 'project', 'proposal', 'meeting', etc.
  source_id    UUID,
  link_tab     TEXT,           -- nav tab id to jump to
  read_at      TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_tenant_unread
  ON notifications (tenant_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'notifications_tenant_isolation') THEN
    CREATE POLICY notifications_tenant_isolation ON notifications
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;
