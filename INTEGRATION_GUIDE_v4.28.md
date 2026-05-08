# Denver Engineering v4.28.0 — Denver Release Integration Guide

## What's In This Package

### Backend — drop into `api/routes/`

| File | Description |
|------|-------------|
| `api/routes/mcp.ts`   | MCP live bridge — 6 native tools + Ava proxy |
| `api/routes/risks.ts` | Risk Register CRUD — full risks table API |

**Wire both into `api/server.ts`:**
```ts
import { mcpRouter   } from './routes/mcp'
import { risksRouter } from './routes/risks'

app.use('/api/v1/mcp', mcpRouter)
app.use('/api/v1',     risksRouter)
```

Add `.env.v4.28.additions` vars to your `.env`.

No new migrations needed — `risks` table is in `002_epc_core.sql`,
`calc_sessions` (for agent sessions) is in `005_calc_sessions.sql`.

---

### Frontend — drop into `src/components/`

| File | Replaces | Description |
|------|----------|-------------|
| `RoView.tsx`       | Old stub | Risk Overview — 5×5 heatmap + register, DB-backed |
| `RtView.tsx`       | Old stub | Risk Tracking — aging, distribution, category breakdown |
| `InView.tsx`       | Old stub | Inspection Notes — full WIR CRUD with punch items |
| `IeView.tsx`       | Old stub | Inspection & Engineering — drawing register + WIR linking |
| `SoView.tsx`       | Old stub | Schedule Overview — SVG Gantt + milestones + phase bars |
| `StView.tsx`       | Old stub | Schedule Tracking — variance table, EVM panel, critical path |
| `MCPToolsPage.tsx` | v4.27.0  | MCP Tools — live Execute tab + Ava health badge + history |

---

### Config extractions — drop into `src/config/`

| File | Phase | Description |
|------|-------|-------------|
| `navigation.ts`   | 18b | `NAVIGATION_ITEMS` typed NavItem[] extracted from JarvisCore Ci array |
| `systemPrompt.ts` | 18c | `JARVIS_SYSTEM_PROMPT` + `buildContextPrompt()` extracted from JarvisCore `en` |
| `defaultState.ts` | 18d | `DEFAULT_BIZ_STATE` seed data extracted from JarvisCore `$i()` |

**JarvisCore replacements (safe, non-breaking):**
```js
// Phase 18b — replace var Ci = [...] with:
import { NAVIGATION_ITEMS } from '../config/navigation'
var Ci = NAVIGATION_ITEMS

// Phase 18c — replace var en = [...].join('\n') with:
import { JARVIS_SYSTEM_PROMPT } from '../config/systemPrompt'
var en = JARVIS_SYSTEM_PROMPT

// Phase 18d — replace function $i() { return {...} } with:
import { DEFAULT_BIZ_STATE } from '../config/defaultState'
function $i() { return DEFAULT_BIZ_STATE }
```

---

## Redis Token Store / CalcView — Already Implemented

Both were fully implemented in v4.26.0:
- `api/tokenStore.ts` — `CompositeTokenStore` with Redis + in-memory fallback ✅
- `api/auth.ts` — uses `getTokenStore()` ✅
- `api/routes/calculations.ts` — complete, wired in `server.ts` at line 218 ✅
- `src/components/CalcView.tsx` — `DENVER_RESULT` postMessage handler saves via fetch ✅

No changes needed for these.

---

## MCP Native Tools (live without Ava)

| Tool | Method | Notes |
|------|--------|-------|
| `http_fetch`       | GET/POST/PUT etc. | Domain allowlist via `MCP_FETCH_ALLOWLIST` |
| `audit_log`        | DB write          | Writes to `audit_log` table |
| `audit_query`      | DB read           | Query tenant audit trail |
| `model_call`       | Anthropic API     | Uses backend `ANTHROPIC_API_KEY` |
| `embedding_create` | Ava proxy         | Proxied to Ava (Nomic embeddings) |
| `session_create`   | DB persist        | Agent sessions stored in `calc_sessions` |
| `session_resume`   | Anthropic API     | Stateless single-turn resume |

All other tools (bash, file_read, AGI, vision, etc.) are Ava-only.
Set `AVA_MCP_URL` to enable them.

---

## Not Implemented in This Release

| Item | Reason | ETA |
|------|--------|-----|
| Phase 19 (JarvisApp decomp) | High dependency risk — 8 Zustand pre-conditions | Next sprint |
| 40 remaining stub views | Prioritised highest-value 6 above | Batch 2 |
| AGI features | Product-level ML engineering | Roadmap |
| Branch coverage 63% → 80% | Test writing session needed | Next |
| Full Gantt with dependencies | Needs library decision (dhtmlx vs custom) | Next |
