# Mobile & Field Execution Spec — Denver Engineering

> Phase 8. Goal: match or exceed Procore mobile. v1, grounded in `api/routes/fieldSync`, `api/services/fieldSync`,
> `api/services/mobile`, `dailyLogs`, `036_mobile_offline`, and the field/offline UI components.

## 1. Current state
- ✅ **Offline batch replay** — `/api/v1/field-sync` + `036_mobile_offline`; field service work orders with background sync, QR launchers.
- ✅ **Daily logs** — weather, crew, equipment, delay/safety flags.
- ✅ **Inspections / punch** capture with photos & signatures.
- 🟡 **PWA** present but native-feel/offline maturity unproven; media (video/voice) & barcode/GPS capture partial.
- ❌ **AI-generated daily reports**; **push notifications** end-to-end; conflict resolution UX for sync.

## 2. Requirements
- **Native-feeling PWA:** installable, offline-first (read + queue writes), background sync, push notifications.
- **Field capture:** photos, **videos, voice notes**, signatures, **QR codes, barcode scans, GPS**, with offline media queue + dedup.
- **Daily reports:** auto-generate from field updates + manpower + weather + production; editable; AI draft.
- **AI Field Assistant:** answer "what's behind schedule?", "what's blocking Area B?", "what inspections are due today?" — the **Project Copilot Focus engine scoped to a project/area** (already deterministic + explainable; reuse `buildProjectFocus`).

## 3. Sync & conflict model
Queue writes locally (IndexedDB), replay via `field-sync` batch endpoint, server is source of truth, last-writer-wins with explicit conflict surfacing for edited records; idempotent by client-generated id.

## 4. Acceptance criteria
Full workflow works airplane-mode then syncs cleanly; media uploads resume; daily report generated from the day's captures; field assistant answers area-scoped questions from live data with deep-links.
