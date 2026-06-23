# 12 — IoT / SCADA AUDIT
## Industrial Sensor Platform, PWTP/WWTP Suitability

---

## Overview

Denver Engineering includes a complete IoT sensor ingest pipeline. This audit verifies its depth, industrial readiness, and suitability for water treatment plant (PWTP/WWTP) monitoring.

---

## IoT Architecture (Verified)

**Implementation:** `api/routes/iot.ts` + `api/services/iot/sensorIngestService.ts`

### Ingest Pipeline (Verified from Source)

```
External device (Telegraf agent / EMQX webhook)
    ↓
POST /api/v1/iot/ingest  (Bearer ingest token)
    ↓
resolveIngestToken() — 64-char hex token → tenantId
    ↓
ingestBatch([{ sensorUid, value, ts, quality, raw }])
    ↓
For each item:
  1. Lookup sensor_uid → sensor record
     (auto-register if unknown — configurable)
  2. INSERT INTO sensor_readings (sensor_id, ts, value, quality, raw)
  3. UPDATE sensors.last_value + last_reading_at
  4. evaluateThresholds() → open/close sensor_alerts
    ↓
Return { accepted, rejected, errors, alerts }
```

---

## Sensor Management

```
POST   /api/v1/projects/:projectId/sensors          — register sensor
GET    /api/v1/projects/:projectId/sensors          — list sensors
GET    /api/v1/sensors/:id                          — sensor detail + latest value
PATCH  /api/v1/sensors/:id/thresholds               — update alert thresholds
GET    /api/v1/sensors/:id/readings                 — time-series history
GET    /api/v1/projects/:projectId/sensors/alerts   — open alerts
POST   /api/v1/sensors/alerts/:alertId/acknowledge  — acknowledge alert
POST   /api/v1/sensors/tokens                       — create ingest token
```

---

## Sensor Data Model

**`sensors` table (verified):**
```
sensorUid    — unique hardware identifier
name         — human-readable label
sensorType   — temperature | pressure | flow | level | pH | conductivity | etc.
unit         — engineering unit (°C, psi, m³/h, m, pH, μS/cm)
protocol     — MQTT | BACnet | Modbus | HTTP | OPC-UA
topic        — MQTT topic path
warnLow/warnHigh   — warning thresholds
alertLow/alertHigh — critical alert thresholds
lastValue    — latest reading (denormalized for fast dashboard)
lastReadingAt
edgeNodeId   — optional link to edge device
bimElementId — link to IFC sensor element (IFCSENSOR)
```

**`sensor_readings` table:**
```
ts        — TIMESTAMPTZ (timezone-aware)
value     — NUMERIC
quality   — 'good' | 'uncertain' | 'bad'  (OPC-UA quality flag)
raw       — JSONB (full payload from device)
```

---

## Threshold Alert System

**Implementation:** `evaluateThresholds()` in `sensorIngestService.ts`

```
For each ingest:
  Compare value against warnLow, warnHigh, alertLow, alertHigh
  If threshold crossed → INSERT INTO sensor_alerts
  If back within range → CLOSE existing open alert
  
Alert severity: 'warn' | 'alert'
Alert status: 'open' | 'acknowledged' | 'closed'
```

**Action integration:** New alerts create workflow actions via `createAction()` — alerts become trackable items in the unified action center.

**Assessment:** This is real threshold alerting with auto-resolution. Not a mock. ✅

---

## Industrial Protocol Support

| Protocol | Status | Evidence |
|---------|--------|----------|
| HTTP/REST (webhooks) | ✅ Full | Direct POST to /api/v1/iot/ingest |
| MQTT (via EMQX) | ✅ Supported | `topic` field in sensor; EMQX webhook target |
| BACnet/IP | 🟡 Type only | `protocol = 'bacnet'` in schema; no BACnet/IP client |
| Modbus TCP | 🟡 Type only | `protocol = 'modbus'` in schema; no Modbus client |
| OPC-UA | 🟡 Type only | Quality codes (good/uncertain/bad) suggest OPC-UA awareness |
| Telegraf integration | ✅ Documented | `/api/v1/iot/ingest` designed for Telegraf HTTP output plugin |

**Critical observation:** BACnet, Modbus, and OPC-UA are listed as protocol types but there is **no protocol-level client code** in the services directory. These protocols require polling the field device — the system only accepts incoming HTTP pushes.

**For true BACnet/Modbus integration:** An edge gateway (Telegraf, Node-RED, or custom) must poll devices and forward to the HTTP ingest endpoint. The platform does not connect directly to field buses.

---

## PWTP/WWTP Suitability Assessment

**Water Treatment Plant use case requires:**

| Requirement | Status | Finding |
|------------|--------|---------|
| pH monitoring | ✅ | `sensorType = 'pH'` supported |
| Flow measurement | ✅ | `sensorType = 'flow'` |
| Level/turbidity | ✅ | `sensorType = 'level'`, 'turbidity' |
| Chlorine residual | 🟡 | `sensorType` is free-form; no enforced vocabulary |
| Multi-point trend charts | ✅ | Time-series history endpoint + frontend charts |
| Alarm management | ✅ | Threshold-based alerts with acknowledgment |
| Calibration tracking | ❌ | No calibration record table found |
| Regulatory reporting (EPA) | ❌ | No regulatory report generation |
| SCADA historian integration | 🟡 | Via Telegraf bridge only |
| 21 CFR Part 11 (if pharma) | ❌ | No audit trail for sensor data changes |
| Real-time dashboard | ✅ | Frontend IoT views with live values |
| Edge redundancy / offline buffering | ❌ | No offline-first edge capability |

---

## Ingest Token Security

**Implementation (verified):**

```typescript
// 64-char hex token generated via randomBytes(32)
// Stored hashed in DB (createHash('sha256').update(token).digest('hex'))
// Resolved on ingest: hash lookup → tenantId
```

**Assessment:** Ingest tokens are separate from user JWTs — correct for device authentication. SHA-256 hashing of stored tokens prevents rainbow table attacks. ✅

**Issue:** No token expiration or rotation mechanism — a leaked ingest token is valid indefinitely until manually revoked.

---

## IoT Data Volume Considerations

**Risk:** At 1-second intervals, a 100-sensor deployment generates:
- 100 rows/second = 6,000/minute = 8.6M/day
- PostgreSQL can handle this but `sensor_readings` needs a **time-series retention policy** or partitioning

**No retention policy found:** `sensor_readings` table has no `DELETE` job or PostgreSQL partitioning. Unconstrained growth will impact query performance after ~30 days of high-frequency data.

**Recommendation:** Add `pg_partman` time-series partitioning or a scheduled DELETE job for readings older than N days.

---

## IoT/SCADA Summary

| Feature | Grade | Finding |
|---------|-------|---------|
| HTTP ingest pipeline | A | Real, production-quality |
| Threshold alerting | A | Auto-open/close with action integration |
| MQTT support | B+ | Via topic field; EMQX webhook target |
| BACnet/Modbus | C | Type schema only; no client |
| BIM-IoT element links | A- | IFCSENSOR linked to BIM elements |
| Time-series retention | D | No partition/retention policy |
| Calibration tracking | F | Not implemented |
| Regulatory reporting | F | Not implemented |
| Edge redundancy | F | Not implemented |

**IoT/SCADA Score: 66/100**

**For PWTP/WWTP deployment:** The platform is viable for monitoring and alerting via HTTP/MQTT pushes from edge gateways. It is **not** a full SCADA replacement — no direct field bus connectivity, no historian, no regulatory reporting.
