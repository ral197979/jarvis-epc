# JARVIS EPC v4

**AI-powered EPC project management platform** — Engineering, Procurement, and Construction workflow automation with an integrated AI operations layer.

[![CI](https://github.com/your-org/jarvis-epc/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/jarvis-epc/actions/workflows/ci.yml)
> **v4.23.0** — SEC-01 httpOnly cookie JWT, SEC-02 real auth gate, P1 stub UX remediation.

[![Tests](https://img.shields.io/badge/tests-1800%2B%20passing-brightgreen)](https://github.com/your-org/jarvis-epc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Coverage](https://img.shields.io/badge/coverage-79%25-green)](https://github.com/your-org/jarvis-epc)

---

## Overview

JARVIS EPC provides a unified interface for managing the complete EPC project lifecycle: CRM and tendering through procurement, field engineering, commissioning, and project closeout — with an integrated Claude AI layer for data analysis and workflow automation.

---

## Architecture

```
jarvis-epc/
├── api/                       Express backend proxy (TypeScript)
│   ├── server.ts              HTTP server, routes, security middleware
│   ├── auth.ts                JWT auth — issuance, rotation, revocation
│   ├── server.test.ts         API integration tests (Supertest)
│   └── auth.test.ts           Auth unit tests (36 tests)
│
├── src/modules/               Extracted TypeScript modules (fully typed, tested)
│   ├── auth/                  Client-side RBAC, session management
│   ├── biz/
│   │   ├── reducer.ts         Pure bizReducer — 37 action types, 26 collections
│   │   └── store.ts           Zustand biz store — undo/redo, snapshots, selectors
│   ├── eventBus/              JIP typed pub/sub event bus
│   ├── gateway/               AI gateway — rate limiting, direct/proxied modes
│   ├── observability/         Structured logging, perf budgets, heartbeat
│   ├── persistence/           CRUD, validation, undo stack, search
│   ├── store/
│   │   ├── index.ts           Module-level state singletons
│   │   └── zustand.ts         Zustand slices (session, log, gateway, auth, obs)
│   ├── theme/                 Design tokens, chart colors
│   └── utils/                 Formatters, currency, dates
│
├── src/styles/
│   ├── tokens.css             CSS custom properties (--jarvis-*)
│   └── utilities.css          Utility classes (.jarvis-card, .jarvis-btn, etc.)
│
├── src/__tests__/modules/     1,800+ unit tests across 42 test files
├── e2e/                       Playwright E2E smoke tests
├── .github/workflows/ci.yml   CI pipeline (6 parallel jobs)
├── tsconfig.json              Root TypeScript config
└── tsconfig.modules.json      Strict TypeScript gate (modules only)
```

---

## Quick Start

```bash
cp .env.example .env   # set ANTHROPIC_API_KEY and JWT_SECRET
npm install
npm run dev:full       # Vite :5173 + Express :3001
```

---

## Testing

```bash
npm test                         # 1,800+ tests (watch)
npm run test -- --coverage       # with coverage gate
npm run typecheck:all            # full + strict TypeScript
npm run e2e                      # Playwright (requires browser install)
npx playwright install chromium  # first-time browser install
```

Coverage thresholds (Phase 6): **77% statements / 63% branches / 75% functions / 79% lines**

---

## Authentication (JWT)

```
POST /api/v1/auth/login    { pin }          → accessToken (15min) + refreshToken (7d)
POST /api/v1/auth/refresh  { refreshToken } → rotated token pair
POST /api/v1/auth/logout   Bearer + body    → both tokens revoked
GET  /api/v1/auth/me       Bearer           → { sub, role, expiresAt }
```

Default PIN: `1234`. RBAC roles: `owner` → `exec` → `pm` → `engineer` → `viewer`.

---

## Domain Reducer

```typescript
import { bizReducer, JARVIS_ACTIONS, emptyBizState } from '@/modules/biz/reducer'

const result = bizReducer(emptyBizState(), {
  type: JARVIS_ACTIONS.ADD_LEAD,
  data: { id: 'L-001', name: 'Acme Corp', status: 'open', value: 50000 },
})
// result.ok === true, result.state.leads.length === 1
```

37 typed action types across CRM, Contracts, Finance, Procurement, Safety, Engineering, Commissioning, Documents, Actions, EVM, and Company domains.

---

## Zustand Biz Store (React)

```typescript
import { useBizStore, JARVIS_ACTIONS } from '@/modules/biz/store'

function MyComponent() {
  const leads   = useBizStore(s => s.biz.leads)
  const dispatch = useBizStore(s => s.dispatch)
  const undo    = useBizStore(s => s.undo)
  const canUndo = useBizStore(s => s.canUndo)
  // ...
}
```

Undo/redo (30 steps), snapshot/restore, `dispatchMany` for batch operations.

---

## CSS Utilities

```html
<div class="jarvis-card jarvis-p-4">
  <h2 class="jarvis-heading">Projects</h2>
  <span class="jarvis-badge jarvis-badge-green">On Track</span>
  <button class="jarvis-btn jarvis-btn-primary">Add Project</button>
</div>
```

All values use `var(--jarvis-*)` tokens. No hard-coded colors.

---

## CI Pipeline (GitHub Actions)

6 parallel jobs run on every push to `main`, `develop`, `phase/**`:

| Job | Checks |
|-----|--------|
| Unit Tests | 1,800+ Vitest tests across 42 files + coverage thresholds |
| TypeScript | Root tsconfig typecheck |
| TypeScript (strict) | `tsconfig.modules.json` — no unused locals |
| Production Build | Vite bundle, zero errors, bundle size check |
| API Tests | Auth + gateway + RBAC routes |
| E2E Tests | Playwright Chromium smoke tests |

---

## Phase Roadmap

| Phase | Status | Focus |
|-------|--------|-------|
| 1–3 | ✅ Complete | Scaffold, module extraction, TypeScript modules |
| 4 | ✅ Complete | Backend proxy, E2E scaffold, CSS tokens |
| 5 | ✅ Complete | Full JWT auth, Zustand stores, CSS utilities |
| **6** | ✅ **Complete** | Domain reducer, Zustand biz store, CI pipeline |
| 7 | 🔲 Planned | Migrate JarvisCore inline mutations → `_dispatch()` |
| 8 | 🔲 Planned | CSS Modules — replace inline styles with utilities |
| 9 | 🔲 Planned | Redis token store, multi-instance auth |
| 10 | 🔲 Planned | JarvisCore monolith component splitting |

---

## Scripts

```bash
npm run dev              # Vite dev server (:5173)
npm run build            # Production build → dist/
npm run api:dev          # Express API (:3001, tsx watch)
npm run dev:full         # Both servers together
npm test                 # Vitest
npm run typecheck        # Full TypeScript check
npm run typecheck:modules # Strict modules check
npm run typecheck:all    # Both TypeScript checks
npm run e2e              # Playwright tests
```

---

*JARVIS EPC v4 — Proprietary. All rights reserved.*
