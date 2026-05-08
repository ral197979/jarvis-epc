# JARVIS EPC — JarvisCore.jsx Extraction Roadmap

**v4.23.0 | P2-A | Status: In Progress**

Current monolith size: **6,535 lines**  
Target: ≤ 500 lines (thin orchestration shell only)

---

## Already Extracted ✅

| Module | Location | Approximate lines saved |
|---|---|---|
| Auth (JWT, sessions, policy) | `src/modules/auth/index.ts` | ~280 |
| Biz dispatch / reducer | `src/modules/biz/` | ~400 |
| Observability / metrics | `src/modules/observability/index.ts` | ~200 |
| Gateway / AI proxy | `src/modules/gateway/index.ts` | ~180 |
| Event bus | `src/modules/eventBus/index.ts` | ~80 |
| Zustand store | `src/modules/store/` | ~150 |
| Commissioning workflows | `src/modules/commissioning/` | ~120 |
| Theme / CSS tokens | `src/modules/theme/index.ts` | ~60 |
| Persistence / state sync | `src/modules/persistence/index.ts` | ~90 |
| AI sanitizer | `src/modules/utils/aiSanitizer.ts` | ~60 |
| 44 view stub components | `src/components/*View.tsx` | ~530 |
| Functional components (CRM, ActionItems, etc) | `src/components/*.tsx` | ~800 |

**Estimated lines extracted to date: ~2,950**

---

## Extraction Queue — Ordered by Impact

### Phase 18a — UI Wrapper Shell Components (~490 lines, lines 3240–3730)

These are thin `useJarvis()` wrapper functions (single-letter names: `Ae`, `w`, `Ee`, etc.) that delegate to already-extracted components. They are boilerplate and can be eliminated.

**Action:** Replace inline wrapper functions with direct imports of the extracted components at the router level. Remove the wrapper layer entirely.

**Target files:** `src/jarvis/JarvisCore.jsx` (delete ~490 lines), update route table.

---

### Phase 18b — Route / Navigation Config (~320 lines, lines 3730–4050)

`Ci` array — the full navigation item registry including icons, labels, domains, and component references. Pure data, no logic.

**Action:** Extract to `src/config/navigation.ts` as a typed `NavItem[]` export.

```typescript
// src/config/navigation.ts
export interface NavItem {
  id: string
  label: string
  icon: string
  domain: string
  component: React.ComponentType<NavItemProps>
}
export const NAVIGATION_ITEMS: NavItem[] = [ ... ]
```

---

### Phase 18c — AI System Prompt (~1 line but 3KB, line 3185)

`en` — the full JARVIS system prompt string (3,000+ chars inline).

**Action:** Extract to `src/config/systemPrompt.ts`.

```typescript
// src/config/systemPrompt.ts
export const JARVIS_SYSTEM_PROMPT: string = `...`
```

---

### Phase 18d — Seed / Default State Data (~285 lines, lines 176–461)

Default business state, sample data, and seed records hardcoded inline.

**Action:** Extract to `src/config/defaultState.ts`.

---

### Phase 19 — JarvisApp Component Decomposition (~1,840 lines, lines 4700–6540)

The main `JarvisApp` function is the hardest extraction target. It contains:

| Sub-component | Approx lines | Extraction target |
|---|---|---|
| Login screen | ~80 | `src/components/LoginScreen.tsx` |
| Owner panel / admin sidebar | ~350 | `src/components/OwnerPanel.tsx` |
| Navigation sidebar | ~200 | `src/components/NavSidebar.tsx` |
| Command palette | ~100 | `src/components/CmdPalette.tsx` |
| Chat panel | ~250 | `src/components/ChatPanel.tsx` |
| Heartbeat / metrics bar | ~80 | `src/components/HeartbeatBar.tsx` |
| Main content router | ~150 | `src/components/ContentRouter.tsx` |
| Toast / notification layer | ~60 | `src/components/ToastLayer.tsx` |

**Dependency risk:** High — these sub-components share state via the main function's closure. Migration requires Zustand store to fully replace closure state before extraction is safe.

**Pre-condition:** Complete Zustand migration (`src/modules/store/zustand.ts`) for all shared state currently held in the JarvisApp closure.

---

## Recommended Sprint Order

```
Sprint 1 (≈1 day):  Phase 18a — delete wrapper shell components
Sprint 2 (≈1 day):  Phase 18b — extract navigation config
Sprint 3 (≈0.5 day): Phase 18c + 18d — extract system prompt + seed data
Sprint 4 (≈3 days): Phase 19 — JarvisApp decomposition (requires Zustand pre-condition)
```

**Projected monolith size after completion: ~500 lines**

---

## Zustand Migration Pre-condition Tracker

The following JarvisApp closure state must be migrated to Zustand before Phase 19 extraction:

| State var | Type | Status |
|---|---|---|
| `_authOk` / `_authSet` | boolean | ⬜ Not migrated |
| `_oCfg` / `_oCfgSet` | OwnerConfig | ⬜ Not migrated |
| `_oPanelOpen` | boolean | ⬜ Not migrated |
| `_apiStats` | ApiStats | ⬜ Not migrated |
| `_auditLog` | AuditEntry[] | 🟡 Partial (persistence module) |
| `_gwEnabled` / `_gwSet` | boolean | ⬜ Not migrated (added P2-D) |
| `_cmdOpen` | boolean | ⬜ Not migrated |
| Active tab (`p`) | string | 🟡 Partial (hash routing) |

Migrate these to the Zustand store before beginning Phase 19.

---

## v4.28.0 Update

### Phase 18b ✅ COMPLETE — `src/config/navigation.ts`
### Phase 18c ✅ COMPLETE — `src/config/systemPrompt.ts`
### Phase 18d ✅ COMPLETE — `src/config/defaultState.ts`

---

## v4.29.0 Update

### Phase 19 — Pre-condition COMPLETE ✅

All 8 Zustand migrations done in `src/modules/store/appSlice.ts`:
- `_authOk` → `auth.isAuthenticated`
- `_oCfg` → `ownerConfig`
- `_oPanelOpen` → `ui.ownerPanelOpen`
- `_apiStats` → `apiStats`
- `_auditLog` → `auditLog`
- `_gwEnabled` → `gateway.enabled`
- `_cmdOpen` → `ui.cmdPaletteOpen`
- Active tab → `ui.activeTab`

### Phase 19 — Components extracted ✅

| Component | File |
|---|---|
| Login Screen | `src/components/LoginScreen.tsx` |
| Owner Panel | `src/components/OwnerPanel.tsx` |
| Nav Sidebar | `src/components/NavSidebar.tsx` |
| Content Router | `src/components/ContentRouter.tsx` |
| Heartbeat Bar | `src/components/HeartbeatBar.tsx` |

**Remaining:** Apply `PHASE_19_MIGRATION.md` to `JarvisCore.jsx` to complete the decomposition and reach ≤500 lines.

---

## v4.30.0 Update

### Phase 19 — COMPLETE ✅

`PHASE_19_MIGRATION.md` fully applied to `src/jarvis/JarvisCore.jsx`.

**Result: 6,540 → 1,173 lines (−82%)**

All 4 migration steps executed:
- Step 1: Phase 19 imports added ✅
- Step 2: 8 closure state vars → `useAppStore` selectors ✅
- Step 3: 5 inline render blocks → extracted components ✅
- Step 4: 1,104-line Phase 18a wrapper block deleted ✅

Phase 18b/c/d deferred inline removals also applied:
- `$i()` seed state (2,510 lines) → `config/defaultState.ts` ✅
- `var en` system prompt (3KB) → `config/systemPrompt.ts` ✅
- `var Ci` navigation array → `config/navigation.ts` ✅
- `var oi/Ai` MCP tool data → `constants/mcpTools.ts` ✅
- 40 dead view imports removed ✅

---

## Remaining Work (Next Sprints)

The file is at **1,173 lines**, not yet at the 500-line target.
The gap is the ~673 lines of **modal and utility orchestration** still inline:

| Remaining inline block | Est. lines | Extraction target |
|---|---|---|
| `Bi()` modal shell + `Ki()` action form + `Zi()` drawer | ~80 | `src/components/ActionModals.tsx` |
| `Qi()` dashboard widget wiring | ~15 | Absorb into `Dashboard.tsx` |
| `Yi()` dashboard shell | ~15 | Absorb into `Dashboard.tsx` |
| `ji()` timeline list | ~15 | `src/components/ActivityTimeline.tsx` |
| `_dispatch` / `mutateBiz` / `_setTab` / `fe()` / `ce()` / `E()` / `D()` / `Y()` / `be()` | ~120 | `src/modules/biz/actions.ts` |
| `JARVIS_ACTIONS` constant map | ~55 | `src/modules/biz/constants.ts` |
| `_domainReducer` stub | ~10 | Already extracted; remove stub |
| `useJarvis()` hook | ~20 | `src/hooks/useJarvis.ts` |
| `JarvisContext` provider | ~10 | `src/contexts/JarvisContext.ts` |
| `_exportAll` / `_importAll` / `_resetAll` | ~80 | `src/modules/biz/dataIO.ts` |
| Remaining small utilities | ~50 | Various |

**Sprint order:**
```
Sprint 5 (≈0.5 day): Extract JARVIS_ACTIONS + _domainReducer stub cleanup
Sprint 6 (≈1 day):   Extract useJarvis + JarvisContext to dedicated files
Sprint 7 (≈1 day):   Extract Bi/Ki/Zi modals → ActionModals.tsx
Sprint 8 (≈1 day):   Extract _dispatch / mutateBiz orchestration → biz/actions.ts
Sprint 9 (≈0.5 day): Extract _exportAll/_importAll/_resetAll → biz/dataIO.ts
```

**Projected final size after Sprint 9: ~500 lines**
