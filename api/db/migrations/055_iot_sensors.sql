-- ============================================================
-- Denver Engineering — Migration 055: IoT Sensor Ingest
-- v10.5.0
--
-- Sensor registry + time-series readings + threshold alerts.
-- Integrates with edge_nodes (049) and bim_elements (050).
--
-- Ingest sources:
--   - HTTP bridge (Telegraf HTTP output, EMQX webhook, Node-RED)
--   - MQTT broker webhook (per-message or batch)
--   - OPC-UA → HTTP gateway
--   - Direct API (for testing / soft sensors)
-- ============================================================

-- ─── 1. Sensor types + protocols ─────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sensor_protocol') THEN
    CREATE TYPE sensor_protocol AS ENUM ('mqtt','opcua','modbus','http','bacnet');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sensor_status') THEN
    CREATE TYPE sensor_status AS ENUM ('active','inactive','fault','maintenance');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reading_quality') THEN
    CREATE TYPE reading_quality AS ENUM ('good','uncertain','bad');
  END IF;
END $$;

-- ─── 2. Sensor registry ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sensors (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL,
  project_id      UUID          NOT NULL,
  edge_node_id    UUID          REFERENCES edge_nodes(id) ON DELETE SET NULL,
  bim_element_id  UUID,         -- soft link to bim_elements(id)

  sensor_uid      TEXT          NOT NULL,   -- external unique ID: MQTT topic segment / OPC node ID
  name            TEXT          NOT NULL,
  description     TEXT,
  sensor_type     TEXT          NOT NULL,   -- temperature | pressure | flow | vibration | level | power | humidity | co2 | custom
  unit            TEXT          NOT NULL,   -- °C | bar | m³/h | mm/s | m | kW | % | ppm

  protocol        sensor_protocol NOT NULL DEFAULT 'http',
  topic           TEXT,                     -- MQTT topic or OPC-UA node ID

  -- Alert thresholds (NULL = not configured)
  warn_low        NUMERIC(18,6),
  warn_high       NUMERIC(18,6),
  alert_low       NUMERIC(18,6),
  alert_high      NUMERIC(18,6),

  -- Latest reading cache (updated on each ingest, avoids aggregation queries)
  last_value      NUMERIC(18,6),
  last_reading_at TIMESTAMPTZ,
  status          sensor_status NOT NULL DEFAULT 'active',

  metadata        JSONB         NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, sensor_uid)
);
ALTER TABLE sensors ENABLE ROW LEVEL SECURITY;
CREATE POLICY sensors_tenant ON sensors
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS sensors_project_idx    ON sensors(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS sensors_edge_node_idx  ON sensors(edge_node_id);
CREATE INDEX IF NOT EXISTS sensors_bim_elem_idx   ON sensors(bim_element_id);

-- ─── 3. Sensor readings (time-series) ────────────────────────────────────────
-- Append-only. Retention / downsampling is a future job-worker concern.

CREATE TABLE IF NOT EXISTS sensor_readings (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL,
  sensor_id   UUID          NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  ts          TIMESTAMPTZ   NOT NULL,       -- reading timestamp (device clock)
  value       NUMERIC(18,6) NOT NULL,
  quality     reading_quality NOT NULL DEFAULT 'good',
  raw         JSONB,                        -- original payload for replay
  ingested_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY sensor_readings_tenant ON sensor_readings
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Primary query: sensor history in time range
CREATE INDEX IF NOT EXISTS sensor_readings_sensor_ts_idx ON sensor_readings(sensor_id, ts DESC);
-- Cross-sensor dashboard queries
CREATE INDEX IF NOT EXISTS sensor_readings_tenant_ts_idx ON sensor_readings(tenant_id, ts DESC);

-- ─── 4. Sensor alerts ─────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_severity') THEN
    CREATE TYPE alert_severity AS ENUM ('warning','critical');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sensor_alerts (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL,
  sensor_id        UUID          NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  alert_type       TEXT          NOT NULL,   -- high | low | fault | no_data
  severity         alert_severity NOT NULL DEFAULT 'warning',
  triggered_value  NUMERIC(18,6),
  threshold        NUMERIC(18,6),
  triggered_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  acknowledged_by  UUID,
  acknowledged_at  TIMESTAMPTZ
);
ALTER TABLE sensor_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY sensor_alerts_tenant ON sensor_alerts
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS sensor_alerts_sensor_idx  ON sensor_alerts(sensor_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS sensor_alerts_open_idx    ON sensor_alerts(tenant_id, resolved_at) WHERE resolved_at IS NULL;

-- ─── 5. Ingest tokens (API key per edge node / gateway) ──────────────────────
-- Lightweight: just a hashed token that maps to tenant + edge_node.
-- Bearer token in HTTP ingest: Authorization: Bearer <token>

CREATE TABLE IF NOT EXISTS sensor_ingest_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  edge_node_id UUID        REFERENCES edge_nodes(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,   -- SHA-256 of the actual token
  label        TEXT,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sensor_ingest_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY sensor_ingest_tokens_tenant ON sensor_ingest_tokens
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
