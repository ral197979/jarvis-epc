#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Operations Certification — Operator Execution Kit
# ─────────────────────────────────────────────────────────────────────────────
# Run these on/against the LIVE Render production environment to produce the
# evidence the auditor cannot generate without production access. Each block
# prints what to capture. Paste outputs into audit/evidence/OPS_EVIDENCE.md.
#
# PREREQS: authenticated `render` CLI (or dashboard), psql 18.x, autocannon
#          (npx autocannon), production DATABASE_URL + DATABASE_URL_APP.
# SAFETY:  restore drills run into a THROWAWAY database; load tests should run
#          against STAGING (or a maintenance window) — never blind against prod.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

echo "================ WS1: BACKUP / PITR / RESTORE ================"

echo "--- [WS1.1] PITR + retention status (Render) ---"
echo "Dashboard: Render → <prod db> → Recovery. Capture: 'Point-in-Time Recovery'"
echo "enabled + retention window (days). CLI (if available):"
echo "  render services list"
echo "  render postgres info <db-id>     # note backup schedule + PITR window"
echo "EVIDENCE TO CAPTURE: screenshot of Recovery panel + retention value (target >= 7d)."

echo "--- [WS1.3] Production restore drill (into throwaway DB) ---"
cat <<'DRILL'
  # On a host with the prod DATABASE_URL (read) + admin to create a scratch DB:
  STAMP=$(date +%Y%m%dT%H%M%S)
  T0=$(python3 -c 'import time;print(int(time.time()))')
  pg_dump "$PROD_DATABASE_URL" -Fc -f /tmp/prod_$STAMP.dump          # logical baseline
  T1=$(python3 -c 'import time;print(int(time.time()))')
  createdb -O jarvis denver_restore_$STAMP
  psql -d denver_restore_$STAMP -c "CREATE EXTENSION IF NOT EXISTS vector;"   # AUD-032
  pg_restore --no-owner --role=jarvis -d denver_restore_$STAMP /tmp/prod_$STAMP.dump
  T2=$(python3 -c 'import time;print(int(time.time()))')
  echo "BACKUP_SECONDS=$((T1-T0))  RESTORE_SECONDS=$((T2-T1))"
  # Integrity + isolation (must pass):
  psql -d denver_restore_$STAMP -c "SELECT count(*) FROM tenants; SELECT count(*) FROM schema_migrations;"
  psql "postgresql://jarvis_app:***@localhost/denver_restore_$STAMP" \
    -c "BEGIN; SELECT set_config('app.current_tenant_id','<known-tenant>',true); SELECT count(*) FROM projects; COMMIT;"
  psql "postgresql://jarvis_app:***@localhost/denver_restore_$STAMP" -c "SELECT count(*) FROM projects;"  # expect 0
  dropdb denver_restore_$STAMP
DRILL
echo "--- [WS1.4/1.5] RPO / RTO ---"
echo "  RPO = backup interval / PITR granularity (from WS1.1). Target <= 1h with PITR."
echo "  RTO = RESTORE_SECONDS at PRODUCTION data volume + app redeploy time. Target <= 4h."
echo "  Also do one Render dashboard PITR restore to a fork and time it end-to-end."

echo "================ WS2: PRODUCTION LOAD VALIDATION ================"
cat <<'LOAD'
  # Against STAGING (Render plan-matched) with auth token TOKEN and base URL BASE:
  for C in 100 500 1000; do
    npx autocannon -c $C -d 60 -H "Authorization=Bearer $TOKEN" "$BASE/api/v1/projects" \
      2> audit/evidence/prod_load_c$C.txt
  done
  # Peak burst:
  npx autocannon -c 2000 -d 30 --connectionRate 200 -H "Authorization=Bearer $TOKEN" \
    "$BASE/api/v1/projects" 2> audit/evidence/prod_load_burst.txt
  # During each run capture from Render Metrics + DB dashboard:
  #   CPU %, Memory %, Network, DB CPU, active connections vs DB_POOL_MAX,
  #   Redis hit rate, scheduler/queue depth. Record P50/P95/P99 + error rate.
LOAD

echo "================ WS3: STORAGE GOVERNANCE (cloud-side) ================"
cat <<'STORE'
  aws s3api get-bucket-versioning      --bucket "$S3_BUCKET"   # expect Status=Enabled
  aws s3api get-bucket-lifecycle-configuration --bucket "$S3_BUCKET"
  aws s3api get-bucket-encryption      --bucket "$S3_BUCKET"   # expect SSE (AES256/aws:kms)
  aws s3api get-public-access-block     --bucket "$S3_BUCKET"   # expect all true
  # Object recovery test: delete a test object, restore prior version.
STORE

echo "================ WS4: OBSERVABILITY (cloud-side) ================"
echo "  Confirm Prometheus is scraping prod (/metrics with METRICS_TOKEN), Grafana"
echo "  dashboards load, Alertmanager routes to PagerDuty/Slack. Fire one synthetic"
echo "  alert per class (service down, DB down, queue fail, disk high, backup fail)"
echo "  and capture the delivered notification."

echo "Done. Paste all outputs into audit/evidence/OPS_EVIDENCE.md and re-run cert review."
