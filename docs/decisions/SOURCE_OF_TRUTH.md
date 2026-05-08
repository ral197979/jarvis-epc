# Source-of-Truth Decision — Denver Engineering (v4.32.0)

**Decided: 2026-04-22**

All field-critical EPC data — systems, subsystems, tags, test packs, test results, and deficiencies — is persisted exclusively in PostgreSQL via the v4.32 API; the existing `commissioning_packs` and `generation_jobs` tables remain the backend source of truth for pack generation; `CxWorkflowView.tsx` currently operates as a pure client-side session buffer and must be wired to the `commissioning_packs` API before any field or pilot deployment; Zustand and localStorage are permitted only as transient UI cache (optimistic state, unsaved-draft indicators) and must never be the final write destination for data that has a corresponding DB table.
