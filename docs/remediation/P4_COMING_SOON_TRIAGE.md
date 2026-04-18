# P4 — Coming-Soon Stub Triage

**Gap class:** PARITY (internal)
**Release slot:** rolling across v4.31.0 → v4.33.0
**Source:** `COMPONENT_MAP.md` at v4.30.0 — 54 🚧 stubs
**Status:** DRAFT — awaiting owner approval per recommendation

---

## Inventory summary

- **22** ✅ Functional components
- **54** 🚧 Coming Soon stubs
- **7** 🔧 Utility components
- **83** total

---

## Triage framework

Each stub receives one of three dispositions:

| Disposition | When to apply |
|---|---|
| **PROMOTE** | Named, recognizable domain feature; real user value; implementable in ≤ 2 days |
| **DELETE** | Minified-leftover (single/double-letter name); no clear feature; removing reduces noise |
| **MERGE** | Sub-panel of another view; absorb into parent |

---

## PROMOTE (11 candidates — ship these over 3 releases)

| Component | Domain | Label | Rationale | Release |
|---|---|---|---|---|
| `SettingsView` | Admin | Settings | Core app expectation; currently unreachable | v4.31.0 |
| `ResourcesView` | Operations | Resources | Needed for crew + equipment tracking | v4.31.0 |
| `DashboardMainView` | Operations | Dashboard | Primary surface users land on; placeholder hurts first impression | v4.31.0 |
| `SafetyMainView` | Safety | Safety Main | Expands existing SafetyView with incidents/observations | v4.32.0 |
| `CRMView` | CRM | CRM & Leads | Parent of existing CRMLeads; unify UX | v4.32.0 |
| `DocsView` | Documents | Documents Overview | Entry point to existing DocumentsView | v4.32.0 |
| `ProcurementSubView` | Procurement | Procurement Sub-Panel | Absorb into ProcurementView as tabs | v4.32.0 (merge) |
| `HubView` | Hub | Project Hub | One-page project summary surface | v4.33.0 |
| `RoView` | Risk | Risk Overview | Connects to existing risks schema | v4.33.0 |
| `RtView` | Risk | Risk Tracking | Pairs with Risk Overview | v4.33.0 |
| `QiView` | Quality | QA Items | Parallel to ActionItems/Safety; quality-gate workflow | v4.33.0 |

---

## DELETE (36 candidates — minified leftovers)

These are single- or double-letter view names inherited from the v1 minified monolith. They expose no recognizable domain workflow, have no functional implementation, and inflate `COMPONENT_MAP.md`. Remove them from:

1. `src/components/*.tsx`
2. `src/config/navigation.ts`
3. `COMPONENT_MAP.md`
4. Any route tables

| Component | Domain | View ID | Reason for deletion |
|---|---|---|---|
| `AeView` | Engineering | ae | Unnamed domain |
| `AnView` | Engineering | an | Unnamed domain |
| `AoView` | Engineering | ao | Duplicates EngineeringView concept |
| `AtView` | Engineering | at | Unclear scope |
| `BiView` | Procurement | bi | Unclear — legacy letter code |
| `BnView` | Construction | bn | Legacy letter code |
| `CtView` | Construction | ct | Legacy letter code |
| `DnView` | Engineering | dn | Legacy letter code |
| `DtView` | Documents | dt | Legacy letter code |
| `EeView` | Engineering | ee | Legacy letter code |
| `EtView` | Construction | et | Legacy letter code |
| `FeView` | Engineering | fe | Legacy letter code — FieldOperationsView supersedes |
| `FedView`/`FeedView` | Finance | feed | Unclear function |
| `FnView` | Finance | fn | Legacy letter code |
| `HiView` | Safety | hi | Legacy letter code |
| `HnView` | Hub | hn | Legacy letter code |
| `HtView` | Safety | ht | Legacy letter code |
| `IeView` | Quality | ie | Legacy letter code |
| `InView` | Quality | in | Legacy letter code |
| `JiView` | Construction | ji | Legacy letter code |
| `JnView` | Construction | jn | Legacy letter code |
| `KtView` | Operations | kt | Legacy letter code |
| `LeView` | CRM | le | Legacy letter code — CRMLeads supersedes |
| `LiView` | Procurement | li | Legacy letter code |
| `LnView` | CRM | ln | Legacy letter code |
| `LoView` | Procurement | lo | Legacy letter code |
| `NeView` | Engineering | ne | Legacy letter code |
| `PnView` | Procurement | pn | Legacy letter code |
| `SnView` | Safety | sn | Legacy letter code |
| `SoView` | Planning | so | Legacy letter code — will be replaced by P1 scheduling |
| `StView` | Planning | st | Legacy letter code — will be replaced by P1 scheduling |
| `UnView` | Engineering | un | Legacy letter code |
| `WView` | Construction | w | Too-generic letter code |
| `WnView` | Construction | wn | Legacy letter code |
| `WtView` | Construction | wt | Legacy letter code |
| `XtView` | Operations | xt | Legacy letter code |
| `YiView` | Finance | yi | Legacy letter code |
| `ZeView` | Construction | ze | Legacy letter code |
| `ZnView` | Construction | zn | Legacy letter code |
| `ZtView` | Commissioning | zt | Legacy letter code |

**Note:** If any of the above names secretly maps to a real planned domain feature, owner should flag it during approval; delete list will be corrected before execution.

---

## MERGE (7 candidates — absorb into parents)

| Component | Merge into | Pattern |
|---|---|---|
| `DetailPanelView` | Host view (context-specific) | Render as right-side drawer on existing views |
| `DocumentsSubView` | `DocumentsView` | Tab inside parent |
| `JnSubView` | `JnView` (scheduled for deletion — skip) | n/a |
| `ModalShellView` | N/A (use `ActionModals.tsx` from G5 Sprint 7) | Delete after G5 Sprint 7 |
| `SubPanelGView` | Owner settings / subpanel system | Replace with generic `<OwnerSubPanel />` |
| `SubPanelQView` | Same pattern | Replace with generic |
| `SubPanelVView` | Same pattern | Replace with generic |

---

## Execution order

### v4.31.0 — "Clean the slate"

- Delete all 36 legacy letter-code stubs in a single PR
- Update `src/config/navigation.ts` (remove dead entries)
- Update `COMPONENT_MAP.md` totals
- Promote: `SettingsView`, `ResourcesView`, `DashboardMainView`

### v4.32.0 — "Expand the core"

- Promote: `SafetyMainView`, `CRMView`, `DocsView`
- Merge: `ProcurementSubView` into `ProcurementView`
- Merge: `DocumentsSubView` into `DocumentsView`
- Merge: `SubPanelGView/QView/VView` → generic `OwnerSubPanel`
- Delete: `ModalShellView` (superseded by G5 Sprint 7's `ActionModals.tsx`)

### v4.33.0 — "Finish the gaps"

- Promote: `HubView`, `RoView`, `RtView`, `QiView`
- Final sweep: any residual 🚧 → decide promote/delete

---

## After triage — projected `COMPONENT_MAP.md` state

| Status | Before (v4.30.0) | After (v4.33.0) | Δ |
|---|---|---|---|
| ✅ Functional | 22 | **33** (+11 promoted) | +11 |
| 🚧 Coming Soon | 54 | **0** | −54 |
| 🔧 Utility | 7 | 8 (+ `OwnerSubPanel`) | +1 |
| **Total components** | 83 | **41** | −42 |

Net code reduction: ~42 files fewer, roughly matching the 40 dead view imports already removed in v4.30.0's Phase 19 cleanup.

---

## Acceptance criteria

- [ ] `COMPONENT_MAP.md` updated per release; counts match table above
- [ ] No 🚧 entries remain in `COMPONENT_MAP.md` at v4.33.0 close
- [ ] Navigation has no dead entries — `npm run check:nav` script (may need to add this)
- [ ] Deleted components removed from `src/components/`, `src/config/navigation.ts`, and any test files
- [ ] Existing tests still pass; any tests referencing deleted stubs removed
- [ ] Each release's `CHANGELOG.md` entry lists stubs deleted / promoted / merged

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Deleting a stub that secretly held a planned feature name | Low | Owner reviews DELETE list before each release's PR; anything flagged stays |
| Route hash collisions after navigation cleanup | Low | Playwright smoke covers all remaining routes |
| Accidental deletion of a referenced import | Low | TypeScript compile fails fast; CI catches |

---

## Owner approval

- [ ] **Approved** — full triage as specified (36 deletions, 11 promotions, 7 merges across 3 releases)
- [ ] **Approved with corrections to DELETE list:** __________
- [ ] **Approved with corrections to PROMOTE list:** __________
- [ ] **Rejected** — reason: __________
- [ ] **Deferred** — re-review at date: ______________

Signed: _________________________  Date: _______________
