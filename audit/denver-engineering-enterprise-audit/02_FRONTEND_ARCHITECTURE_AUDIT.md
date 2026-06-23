# 02 — FRONTEND ARCHITECTURE AUDIT

---

## Architecture Overview

**Framework:** React 18 + TypeScript + Vite  
**State Management:** Zustand (`src/modules/store/appSlice.ts`)  
**Routing:** Custom `ContentRouter.tsx` (tab-based, not React Router)  
**Code Splitting:** React.lazy() on all 50+ view components  
**Build Tool:** Vite 5 — 450ms production build time  

---

## Routing Architecture

### Approach: Tab-Based Single Page
`ContentRouter.tsx` maintains a `TAB_MAP: Record<string, ViewEntry>` and reads `activeTab` from Zustand store. All views are lazily loaded.

```tsx
// ContentRouter.tsx
const TAB_MAP: Record<string, ViewEntry> = {
  dash: Dashboard,
  crm: CRMView,
  // 50+ more...
}
```

**Strengths:**
- No React Router dependency — simpler state model
- All views lazy-loaded with `React.lazy()`
- `ViewErrorBoundary` wraps every `<Suspense>` (added in P2-2)

**Weaknesses:**
- **No deep linking / URL routing** — cannot share a URL to a specific view with state
- **No browser Back/Forward button support** — navigation history is lost on refresh
- **No route guards** — any authenticated user can access any tab by calling `setActiveTab('system')`
- Tab IDs are magic strings — no TypeScript type safety on navigation calls
- `registerView()` export allows runtime tab injection (plugin API, but also attack surface)

**Evidence:**
```typescript
// src/modules/store/appSlice.ts - no access control on tab setting
setActiveTab: (tab: string) => set(state => { state.ui.activeTab = tab })
```

**Remediation:** Replace tab-based routing with React Router v6. Add role-based route guards. Enables deep linking, analytics, and browser history.

---

## State Management (Zustand)

**Store:** `src/modules/store/appSlice.ts`

**What's in global state:**
- `auth` — tenantId, userId, role, display name
- `ui.activeTab` — current view
- `ui.sidebarOpen` — sidebar state

**Assessment:** Appropriate scope. Global state is minimal (auth + UI). Module-specific state is local to each view component via `useState`/`useCallback`.

**Issue:** No state persistence across page reloads except what's in auth cookies. Users lose unsaved form data on reload.

---

## Code Splitting & Bundle Analysis

**Production build output (verified):**
```
vendor-react-*.js      359 KB (gzip: 109 KB)
vendor-recharts-*.js   355 KB (gzip:  95 KB)
index-*.js             117 KB (gzip:  35 KB)
CommissioningView-*.js 100 KB (gzip:  20 KB)
AutomationView-*.js     59 KB (gzip:   9 KB)
InspectionsView-*.js    50 KB (gzip:  10 KB)
```

**Total initial bundle (blocking):** ~835 KB uncompressed / ~239 KB gzip  
**Per-view chunks:** 23–100 KB each, loaded on demand

**Assessment:** Code splitting is effective. No view is loaded until navigated to. Initial bundle is reasonable for a full-featured SPA.

**Concerns:**
- `vendor-recharts` (355 KB) is as large as the entire React runtime — evaluate if all recharts features are used
- `CommissioningView` (100 KB) is 2× larger than any other view — worth splitting further
- No tree-shaking audit of `recharts` imports

---

## Component Architecture

**Count:** 317 `.tsx` files in `src/components/`

**Patterns used:**
- Inline styles throughout (consistent, but large JSX files)
- No CSS modules or styled-components
- No shared design system / component library (custom everything)
- Some views have deep component trees (`phase10/`, `phase11/`, `phase12/` subdirectories)

**Dead Components (no TAB_MAP entry):**
- `src/components/CrossProjectHeatmap.tsx` — has `Math.random()` risk scores, not wired to a nav tab
- `src/components/AdaptiveObservabilityDashboard.tsx` — Phase 7 stub
- `src/components/phase10/`, `phase11/`, `phase12/` — Phase-prefixed components not in ContentRouter
- `src/components/AnomalyRadar.tsx`, `ForecastDriftPanel.tsx`, `MitigationEffectivenessChart.tsx` — chart panels not directly navigable

**Duplicate UI Patterns:**
- Toast notifications reinvented in every view component (TransmittalsView, IntegrationsView, RFIsView all have identical toast logic — 20+ copies)
- Error states (red bordered div) duplicated in 30+ components
- KPI tile pattern duplicated in 15+ views

---

## Error Handling

**ErrorBoundary:** `ViewErrorBoundary` wraps every view (added P2-2)  
**API errors:** Each component catches fetch errors and shows inline error state  
**Loading states:** Skeleton loader in ContentRouter `ViewLoader` (added P2-7)

**Gap:** No global error handler for uncaught promise rejections. Browser console will log unhandled rejections silently in production.

**Remediation:**
```typescript
window.addEventListener('unhandledrejection', (e) => {
  Sentry.captureException(e.reason)
})
```

---

## Forms

**Assessment:** Forms are built with uncontrolled inputs and local state. No form library (React Hook Form, Formik).

**Issues:**
- No field-level validation UX — validation errors only shown after submit
- No form dirty-state tracking — users lose unsaved changes on tab switch
- No optimistic updates — all mutations wait for API response before updating UI

---

## Offline Support

**Claimed:** "Offline-capable data entry with background sync"  
**Reality:** `api/routes/fieldSync.ts` exists for batch replay, but no service worker or offline storage in frontend.

**Evidence of absence:** `grep -r "serviceWorker\|workbox\|offline" src/` — 0 results  
**No `vite-plugin-pwa` or similar in `package.json`**

**Verdict:** Offline support is backend-only replay. Frontend has no offline capability.

---

## Accessibility

**Positive findings:**
- Semantic `<main role="main" aria-label="...">` in ContentRouter
- `aria-live="polite"` on loading indicator
- `aria-busy="true"` on skeleton loader
- `aria-hidden` on decorative emoji

**Gaps:**
- Inline-style components have no focus management
- No keyboard navigation in sidebar (no `onKeyDown` handlers)
- Color-only status indicators (red = overdue) — fails WCAG 1.4.1
- No `aria-label` on most icon-only buttons
- No skip link implementation (added as text but no CSS to visually hide it)

---

## Responsive Design

**Gap:** The platform is desktop-first. No `@media` queries found in component files (all inline styles with fixed pixel values).

**Evidence:**
```tsx
// TransmittalsView.tsx - fixed max-width, no responsive breakpoints
<div style={{ padding: 24, maxWidth: 1100 }}>
```

**Impact:** Unusable on mobile devices and tablets. Field workers using tablets cannot use this application.

---

## Performance Concerns

1. **No React.memo anywhere** — all components re-render on any parent state change
2. **No `useMemo` for filtered lists** — expensive `.filter()` calls on every render
3. **No virtualization** for large lists — rendering 1,000+ rows would freeze the browser
4. **Socket reconnect logic** — not verified in frontend WebSocket implementation

---

## Summary

| Area | Grade | Critical Issue |
|------|-------|----------------|
| Code Splitting | A | Effective lazy loading |
| Bundle Size | B+ | recharts worth auditing |
| State Management | A- | Appropriate Zustand usage |
| Routing | C | No URL routing, no deep links |
| Forms | C | No validation library |
| Accessibility | C | Color-only indicators, no keyboard nav |
| Responsive Design | D | Desktop-only, no mobile support |
| Offline Support | F | Not implemented despite claims |
| Error Handling | B | ErrorBoundary present; no unhandled rejection handler |
| Component Reuse | C | Toast/error patterns duplicated 20+ times |
