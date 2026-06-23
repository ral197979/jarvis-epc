# Document Control Spec — Denver Engineering

> Phase 2. Goal: surpass Aconex. v1, grounded in `api/routes/{drawings,transmittals,bim,files,documents}`,
> migrations `050` (BIM/estimating), `051/069` (transmittals).

## 1. Current state
- ✅ **Drawings** register by discipline, revisions, red-line **markups**, IFC tracking.
- ✅ **BIM** model upload (IFC) + clash/coordination issues; `ifcParseWorker`.
- ✅ **Transmittals** — formal issue/response with counters under RLS.
- ✅ **Document library** — upload PDFs/Office/CSV/images/3D; full-text + AI-summarized search (pgvector).
- ✅ **P&ID/PFD generation** — genuine ISA-5.1 SVG/DXF (`public/tools/denver/*PID*`).
- ❌ **Superseded-set management**, **distribution lists**, **controlled copies**, version **compare/overlay** UI.
- ❌ **AI drawing intelligence** (auto-identify equipment/tags/rooms/systems and link to objects).
- ❌ **Spec intelligence** (extract equipment, testing/submittal/closeout requirements).

## 2. Target data model (additions)
`document` (with superseded chain + status), `revision`, `distribution_list`, `controlled_copy` (issued-to, acknowledgment), `markup`/`overlay`, `extracted_entity` (equipment/tag/room/system → object-graph links), `spec_section` → `requirement` (testing/submittal/closeout).

## 3. AI Drawing & Spec Intelligence (Phase 2 + 11)
- **Drawing:** vision/OCR over sheets → detect equipment tags, rooms, systems → create links in the object graph (DOMAIN_MODEL §10). Enables RFI/submittal impact analysis ("what drawings reference this?").
- **Spec:** parse spec sections → extract testing/submittal/closeout requirements → auto-generate submittal register & inspection/closeout checklists.

## 4. Workflows
Controlled issue → distribution → acknowledgment → supersede; version compare/overlay for review; transmittal with response tracking; AI-extracted links keep documents connected to RFIs, submittals, systems, schedule, and closeout.

## 5. Acceptance criteria
No "latest version" ambiguity (superseded chains enforced); distribution acknowledgments auditable; AI-extracted equipment/tags link to objects with review/confirm; spec-derived requirements traceable to submittals/inspections.
