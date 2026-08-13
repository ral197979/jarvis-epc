# ADR-013 — Crania Closes Four of Denver's Nine Calculation Disciplines

- **Status:** Proposed (2026-08-13)
- **Decider:** Repository owner (pending)
- **Depends on:** ADR-011 (Crania Absorbs Ava-Engineering-Core)
- **Related:** `FEATURES.md` §"Engineering tools — honest status", `ECOSYSTEM_INTEGRATION_CONTRACT.md` §1, §3, `.env.example` L153–157

## Context

`FEATURES.md` rates nine engineering disciplines in Denver's "Engineering Tools" / "Process Design"
panels. Eight are ⚠️ or ❌: their in-browser math is placeholder (synthetic output, or a formula
with a random-noise multiplier). Only P&ID/PFD generation is real, and it draws rather than
calculates.

ADR-011 made Crania the absorbing engineering engine and cut two config slots —
`CRANIA_MCP_URL` and `CRANIA_BASE_URL` (`.env.example` L155–157). **Both are empty, and no source
file in this repository references Crania.** ADR-011's own description of the prior state still
describes today: *"flag-gated OFF, with no configured endpoints and no running service."*

This ADR records what Crania can actually close, verified against the engine rather than its
claims, so the decision to wire it is made on evidence.

### Verification performed (2026-08-13)

Against Crania @ `feat/phase-8-crania-fuel`:

- `npm run typecheck` — passes, all five apps (water, fire, fuel, hvac, electrical).
- `npm run test` — **0 failures**; 276 tests in `crania-water`, ~409 across all workspaces.
- `npm run docs:capability-matrix` — regenerated **byte-identical** to the committed
  `docs/pilot/capability-matrix.md`, confirming the registry below is current, not aspirational.
- Surface inventory: **21 MCP tools** (`packages/mcp/src/tools.ts`), **72 HTTP endpoints**
  (`apps/crania-water/src/*.routes.ts`).
- Registry: **49 capabilities** — 17 Supported, 10 Supported (screening only), 5 Partial,
  5 Partial (screening only), 12 Unsupported.

## Decision

Wire Denver to Crania **for the four disciplines Crania demonstrably closes, and only those.**
The remaining five rows keep their existing `FEATURES.md` ⚠️/❌ rating until the underlying
capability exists.

### Disciplines to wire

| `FEATURES.md` row | Crania capability | Level | Evidence |
|---|---|---|---|
| **PWTP** | RO flow & recovery, RO membrane area | L2 | `water-ro-recovery-001` PASS_EXACT |
| | Conventional train (coag/floc/sed/filtration), NaOCl dosing | L1 | `water-conventional-pwtp-001`, `water-chemical-dosing-001` PASS_EXACT |
| **Process: pump** | `designPump`, wet-well & cycle sizing, `hydraulic_pipe_loss` | L2 | `water-pump-station-001`; hydraulic power 0.2% vs independent calc |
| **Fire protection** | NFPA 13/20/22 sprinkler demand, storage, fire-pump; network hydraulic evaluation | L1 | Required storage 0.002% vs independent calc |
| **HVAC** | Psychrometric states, supply airflow, coil duties (ASHRAE Ch. 1) | L1 | Coil total duty 0.086% vs independent calc |

Additionally, two of the six process-equipment items close: **heat-exchanger sizing**
(LMTD + Bowman F, 0.189% diff) and **pressure-vessel sizing** (ASME VIII Div 1 UG-27, 0.008% diff).

### Disciplines that do NOT close, and must keep their current rating

| `FEATURES.md` row | Why |
|---|---|
| **WWTP** | MBBR and MBR size at L2, but **ASM1/2d/3 and BNR — the methods the row names — are UNSUPPORTED.** Total-nitrogen removal and IFAS are also UNSUPPORTED. Crania excludes Wastewater from pilot scope because the workflow *"has not had qualified-engineer review."* |
| **Electrical / NEC** | Crania **withdrew** its NEC Article 430 declaration. The breaker output is UNSUPPORTED — sized with an overload multiplier, *"wrong under both NEC and IEC"* (finding F9). Fault level, voltage drop, conduit fill/derating and coordination are all UNSUPPORTED. The method is IEC-style screening on a computed FLC. |
| **Stormwater** | No stormwater vertical exists in Crania. Zero coverage. |
| **Oil & Gas** | Crania's fuel vertical is diesel/genset storage, not O&G separation. No separator, no flash. |
| **Process equipment** (remaining 4) | Souders-Brown (separator), Rachford-Rice (flash-VLE), reactor, and general mass balance: not implemented anywhere. |

### Presentation constraint (binding)

**No capability may be presented as a certified calculator.** Crania's registry caps at
**L2 (Published example)** — 5 capabilities at L0, 64 at L1, 20 at L2. There is no L3, L4 or L5,
and the matrix states that *every* supported or partial capability requires qualified-engineer
review before use.

Wiring Crania therefore does not remove Denver's `FEATURES.md` disclaimer. It changes the claim
from *"synthetic placeholder, do not trust"* to *"screening-grade, benchmarked against a published
example, requires engineer review"* — a material upgrade, and a narrower one than the UI's
labelling currently implies. Denver's UI must surface each result's **support level** and
**known limitations** from the registry, not just its number.

Only **Potable Water** and **Pump Stations** are inside Crania's declared pilot scope. Wastewater,
Fuel, Fire, Mechanical, HVAC and Electrical each carry an explicit *"Not in pilot scope"* banner.
Wiring a not-in-pilot-scope discipline is permitted for internal design-assist use; it must not be
presented to a customer as pilot-grade.

## Consequences

- **Positive:** four ❌/⚠️ rows become usable at screening grade, with citations and benchmark
  evidence behind each number — replacing math the repository itself documents as random-noise.
- **Positive:** `src/config/systemPrompt.ts` can name real, bounded tools, further reducing the
  Ask Jarvis hallucination surface that `FEATURES.md` L86 flagged (already partly remediated).
- **Negative / deployment constraint:** **Crania reaches ava-math-engine by relative filesystem
  path** — `packages/engine-client/src/index.ts` resolves `../../../../ava-math-engine` and loads
  prebuilt `dist/` bundles. This is not an HTTP dependency. Any image serving Crania must contain
  ava-math-engine **co-located and built**. Those `dist/` artifacts are **gitignored and
  uncommitted**, so a fresh clone has no WWTP math until it is built.
- **Negative:** ava-math-engine's last commit is 2026-04-23, and the local checkout Crania builds
  against is 2 commits behind `origin/main`. The engine version behind any WWTP result should be
  pinned and recorded, not assumed.
- **Risk retired:** Crania previously had **no git remote** — the engine closing Denver's largest
  documented gap existed only on one workstation. Pushed to `ral197979/crania` (private, 9 branches)
  on 2026-08-13.
- **Neutral:** the transport split from ADR-011 holds — MCP for calculations (`CRANIA_MCP_URL`,
  21 tools), REST for the doc factory (`CRANIA_BASE_URL`).

## Alternatives considered

- **Wire all nine disciplines and let the registry's own levels speak.** Rejected: Denver's UI does
  not currently surface support levels, so an UNSUPPORTED electrical breaker value would render
  indistinguishable from a benchmarked pump duty. That is worse than the present placeholder,
  because it looks authoritative.
- **Wait for Crania to reach L3+ before wiring anything.** Rejected: L3+ requires qualified-engineer
  review, which is a human gate on a schedule Denver does not control. Four disciplines are useful
  at screening grade today, and the alternative in the interim is demonstrably fabricated math.
- **Bridge Denver directly to ava-math-engine, per `FEATURES.md` L83.** Rejected: superseded by
  ADR-011, and it would bypass Crania's validation registry, jurisdiction handling and unit
  profiles — the parts that make a result defensible rather than merely computed.
- **Build the missing five disciplines in Denver.** Rejected: contradicts ADR-002 (specialist
  engines own technical execution). Missing math belongs in Crania.

## Follow-up (not authorized by this ADR)

1. Populate `CRANIA_MCP_URL` / `CRANIA_BASE_URL` and build the client.
2. Surface registry support level + known limitations alongside every calculated value in the UI.
3. Update `FEATURES.md` rows only after the wiring is verified end to end.
4. Commit or discard ava-math-engine's uncommitted working-tree changes; pin the engine version.
