# QR/NFC Workflow Design
**Denver Engineering — Ava Phase 3 (v4.35.0)**

## Purpose

Field workers need instant access to an asset's operational state — active blockers, inspections, and pending actions — without navigating menus. Scanning a QR code or NFC tag on a piece of equipment opens the relevant workflow immediately.

## User Flow

```
1. Worker taps "Scan Asset" on mobile device
2. Camera opens (or NFC tap detected)
3. QR/NFC decoded → asset_id extracted
4. App calls:
     GET /api/v1/assets/:id/operations
     GET /api/v1/assets/:id/readiness
5. Asset header shows:
     - Asset ID (monospace)
     - Readiness score + state
6. If blocking factors exist → red warning banner
7. Operations list shows all active actions:
     - Blocked actions show 🔒 icon
     - Priority color + status label
8. Worker taps action → opens Action Detail
9. Scan event logged to asset_scan_events
```

## QR Code Architecture

Phase 3 uses a camera input fallback (`<input type=file capture=environment>`) for broad browser compatibility. In production, a dedicated QR decoding library (e.g., `jsQR`) should be integrated to decode the image before calling the API.

QR codes encode the asset ID as a plain UUID or a short URL:
```
https://app.denverengineering.com/assets/{asset_id}
```

The `QRWorkflowLauncher` component extracts the ID from either format before calling the API.

## NFC Architecture

NFC taps are handled by the Web NFC API (Chrome on Android):
```javascript
const ndef = new NDEFReader()
await ndef.scan()
ndef.onreading = ({ message }) => {
  const record = message.records[0]
  const assetId = new TextDecoder().decode(record.data)
  loadAsset(assetId)
}
```

Fallback for devices without NFC: manual ID entry field.

## Manual Entry Fallback

Desktop/desktop-browser users enter the asset ID directly:

```
[Asset ID or tag…] [→]
```

All three input methods (QR, NFC, manual) converge on the same `loadAsset(id)` function.

## Scan Event Logging

Every asset load — regardless of scan method — logs an audit event:

```
POST /api/v1/evidence/assets/:id/scan
{
  "asset_type": "equipment",
  "scan_method": "qr" | "nfc" | "manual",
  "geolocation": { "lat": 39.73, "lng": -104.98 },   // optional
  "device_id": "device-uuid"                           // optional
}
```

```sql
CREATE TABLE asset_scan_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  asset_id        text NOT NULL,
  asset_type      text NOT NULL DEFAULT 'equipment',
  scan_method     text NOT NULL CHECK (scan_method IN ('qr','nfc','manual')),
  scanned_by      uuid NOT NULL,
  device_id       uuid REFERENCES mobile_devices(id),
  geolocation     jsonb,
  scan_context    jsonb NOT NULL DEFAULT '{}',
  duration_seconds int,
  scanned_at      timestamptz NOT NULL DEFAULT now()
);
```

## Asset Readiness Integration

When an asset is loaded, the component simultaneously fetches:

1. **Operations** — all active actions linked to the asset (`is_blocked`, `due_at`, `priority`, `status`).
2. **Readiness** — the readiness engine score, state, and blocking factors for the `asset` domain.

The readiness score is displayed prominently at the top of the loaded view, color-coded by state:

| State | Color |
|-------|-------|
| `ready` | `#10b981` (green) |
| `conditionally_ready` | `#d97706` (amber) |
| `at_risk` | `#f97316` (orange) |
| `not_ready` | `#dc2626` (red) |

## Blocked Action Indicator

Actions with `is_blocked: true` are flagged with a 🔒 icon. Workers see at a glance that they cannot proceed with that action until its blockers are resolved. Tapping the action opens the full dependency view.

## Component API

```typescript
interface QRWorkflowLauncherProps {
  onActionSelect?: (actionId: string) => void
}
```

`onActionSelect` fires when the worker taps an action, allowing the parent to navigate to the Action Detail page.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/assets/:id/operations` | Active actions for asset |
| `GET` | `/assets/:id/readiness` | Readiness score + factors |
| `POST` | `/evidence/assets/:id/scan` | Log scan event |

## Security Considerations

- Asset IDs in QR codes are UUIDs, not guessable sequential integers.
- The `/assets/:id/readiness` and `/assets/:id/operations` endpoints require `requireAuth` middleware — unauthenticated scans return 401.
- Geolocation data is optional and never transmitted unless the worker grants browser location permission.
- Scan events are immutable audit records — they cannot be deleted via API.

## Phase 4 Roadmap

- Integrate `jsQR` or `ZXing` for in-browser QR decoding (eliminate demo mode).
- Add NFC write support for provisioning new asset tags.
- Add scan analytics: most-scanned assets, average time-on-site per asset.
- Integrate with equipment maintenance schedules.
