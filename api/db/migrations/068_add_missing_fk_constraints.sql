-- Denver Engineering — Migration 068: Add missing FK constraints
--
-- Migrations 058–060 declared project_id / vendor_id / schedule_task_id
-- as bare UUID NOT NULL without REFERENCES clauses. This migration adds
-- the foreign key constraints so the DB enforces referential integrity.

-- 058 change_orders
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'change_orders'
      AND constraint_name = 'change_orders_project_id_fkey'
  ) THEN
    ALTER TABLE change_orders
      ADD CONSTRAINT change_orders_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END$$;

-- 058 change_order_tasks → schedule_tasks
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'change_order_tasks'
      AND constraint_name = 'change_order_tasks_schedule_task_id_fkey'
  ) THEN
    ALTER TABLE change_order_tasks
      ADD CONSTRAINT change_order_tasks_schedule_task_id_fkey
      FOREIGN KEY (schedule_task_id) REFERENCES schedule_tasks(id) ON DELETE CASCADE;
  END IF;
END$$;

-- 059 bid_packages → projects
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'bid_packages'
      AND constraint_name = 'bid_packages_project_id_fkey'
  ) THEN
    ALTER TABLE bid_packages
      ADD CONSTRAINT bid_packages_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END$$;

-- 059 bid_submissions → vendors
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'bid_submissions'
      AND constraint_name = 'bid_submissions_vendor_id_fkey'
  ) THEN
    ALTER TABLE bid_submissions
      ADD CONSTRAINT bid_submissions_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE;
  END IF;
END$$;

-- 059 subcontracts → projects
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'subcontracts'
      AND constraint_name = 'subcontracts_project_id_fkey'
  ) THEN
    ALTER TABLE subcontracts
      ADD CONSTRAINT subcontracts_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END$$;

-- 059 subcontracts → vendors
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'subcontracts'
      AND constraint_name = 'subcontracts_vendor_id_fkey'
  ) THEN
    ALTER TABLE subcontracts
      ADD CONSTRAINT subcontracts_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;
  END IF;
END$$;

-- 060 meetings → projects
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'meetings'
      AND constraint_name = 'meetings_project_id_fkey'
  ) THEN
    ALTER TABLE meetings
      ADD CONSTRAINT meetings_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END$$;
