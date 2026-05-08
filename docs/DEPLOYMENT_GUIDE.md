# Deployment Guide — Denver Engineering v10.0.0

**Last Updated:** 2026-05-07

---

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Environment variables configured (see `.env.example`)
- Production gate run passing (≥ 90% checks)
- Operational readiness scan: `ready` level

---

## Deployment Checklist

### 1. Pre-Deployment

```bash
# Run operational readiness scan
POST /api/phase10/readiness/run-scan { "environment": "production" }
# Require: overallLevel === 'ready' && notReadyCount === 0

# Run production gates
POST /api/phase10/gates/run { "environment": "production" }
# Require: overallStatus === 'pass'

# Check migration safety
GET /api/phase10/deployments/migration-safety?environment=production
# Require: safe === true
```

### 2. Create Deployment Audit Record

```typescript
const audit = await createDeploymentAudit({
  deploymentId: 'dep-v10.0.0-20260507',
  environment: 'production',
  version: '10.0.0',
  previousVersion: '9.3.1',
  migrationsApplied: 12,
  rollbackAvailable: true,
})
await updateDeploymentStatus(audit.id, 'running')
```

### 3. Apply Migrations

```bash
npx db-migrate up --env production
```

Migrations are tracked in `schema_migrations`. Run `checkMigrationSafety()` after to verify.

### 4. Deploy Application

```bash
# Blue-green deployment
kubectl set image deployment/denver-api api=denver-engineering:10.0.0
kubectl rollout status deployment/denver-api
```

### 5. Verify Health

```typescript
await updateDeploymentStatus(audit.id, 'passed', healthyCount, degradedCount)

const health = isDeploymentHealthy(audit)
// Require: health === true
// Require: computeHealthScore(healthy, degraded) >= 80
```

### 6. Post-Deployment Verification

```bash
# Replay verification on critical streams
POST /api/phase10/replay/verify { "replayCount": 3 }
# Require: status === 'passed'

# Tenant isolation gate
POST /api/phase10/gates/tenant-isolation
# Require: status === 'pass'
```

---

## Rollback Procedure

If health score < 80% or gates fail post-deployment:

```typescript
// Verify rollback is safe
const audit = await getLatestDeployment('production')
if (isRollbackSafe(audit)) {
  await updateDeploymentStatus(audit.id, 'rolled_back')
  // kubernetes rollback
  // kubectl rollout undo deployment/denver-api
}
```

**Important:** Only rollback if `migrationsRolledBack === 0`. If migrations have been applied, consult the DBA team before rolling back.

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|---------|
| DATABASE_URL | PostgreSQL connection string | ✅ |
| JWT_SECRET | JWT signing secret (256-bit) | ✅ |
| OPENAI_API_KEY | OpenAI API key | ✅ |
| STRIPE_SECRET_KEY | Stripe billing key | ✅ |
| REPLAY_HASH_SALT | Salt for replay hash computation | ✅ |
| NODE_ENV | `production` | ✅ |
| LOG_LEVEL | `info` (production) | Optional |

---

## Monitoring

After deployment, verify via:
- `ReliabilityCommandCenter` — SLO status
- `DeploymentHealthGrid` — Deployment audit history
- `ProductionGateMatrix` — Gate check results
- `OperationalReadinessDashboard` — Dimension scores
