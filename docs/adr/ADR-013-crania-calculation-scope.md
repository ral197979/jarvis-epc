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

This ADR records what Crania can actually close, verified by executing the engine rather than by
reading its claims.

### Verification performed (2026-08-13)

Against Crania @ `feat/phase-8-crania-fuel`, booted locally against Postgres:

- `npm run typecheck` — passes, all five apps (water, fire, fuel, hvac, electrical).
- `npm run test` — **0 failures**; 276 tests in `crania-water`, ~409 across all workspaces.
- `npm run benchmarks:run` — **21/21 validation cases pass** across FIRE, FUEL, HVAC, MECHANICAL
  and WATER.
- `npm run docs:capability-matrix` — regenerated **byte-identical** to the committed
  `docs/pilot/capability-matrix.md`.
- **Runtime probe of all 21 MCP tools — 21/21 execute** and return structured results with
  provenance, once pointed at the correct engine checkouts (see the hazard below).
- Spot-checked against independent hand calculations: `designPump` returned 14.686 kW against
  ρgQH = 14.715 kW (0.2%); annual energy 19.581 kW × 8000 h = 156,648 kWh exactly; a 5 MLD
  brackish PWTP request closed its mass balance (208.33 ÷ 0.85 − 208.33 = 36.76 m³/h concentrate).
- Registry: **49 capabilities** — 17 Supported, 10 Supported (screening only), 5 Partial,
  5 Partial (screening only), 12 Unsupported.

### Operational hazard — silent engine mis-resolution

**This is the finding that most affects the wiring work, and it cost a full diagnostic cycle.**

`packages/engine-client/src/index.ts` and `engineering-core.ts` resolve their engines by
*relative filesystem path*, defaulting to the siblings `../../../../ava-math-engine` and
`../../../../Ava-Engineering-Core`. The engines that actually carry the integration baseline are
in **different directories**:

| Engine | Default resolution | Correct checkout | Branch |
|---|---|---|---|
| Engineering core | `Ava-Engineering-Core` | `Ava-Engineering-Core-crania-clean` | `integration/crania-water-controlled-baseline` |
| Math engine | `ava-math-engine` | `ava-math-engine-crania-clean` | `integration/crania-water-wwtp-controlled-baseline` |

Under the **default** resolution, **8 of 21 MCP tools throw** — all six fuel tools
(`m.fuelEnergyBalance is not a function`, and likewise for `fuelInventoryBalance`,
`simulateFuelInventory`, `designMultiGeneratorFuel`, `designFuelPolishing`, `containmentVolume`),
plus `fire_supply_adequacy` (`m.evaluateSupplyForScreeningDemand is not a function`) and
`hvac_supply_air` (`psychrometrics.engine not found`). `npm run seed:demo` fails outright.

Under the **correct** resolution, all 21 execute. Nothing is missing; the wrong directory was
being read.

Three mechanisms that should have caught this did not:

1. **`GET /api/health` reports `engines.*.available: true` in both configurations.** It checks
   that a directory resolves, not that the capabilities in the registry are callable. A fully
   mis-wired service self-reports healthy.
2. **The benchmark suite passes in both configurations** — no case exercises a capability whose
   function is absent. Passing benchmarks are evidence about *covered* capabilities only, never
   about registry completeness.
3. **The capability matrix passes in both configurations.** It is generated from a declarative
   registry; nothing asserts that a declared `engine · function` binding resolves to a callable
   export. The matrix states *"every row is a capability as currently implemented"* — true of the
   implementation, not of the binding.

Set `AVA_ENGINEERING_CORE_DIR` and `AVA_MATH_ENGINE_DIR` explicitly. Never rely on the default.

## Decision

Wire Denver to Crania **for the four disciplines Crania demonstrably closes, and only those.**
The remaining five rows keep their existing `FEATURES.md` ⚠️/❌ rating until the underlying
capability exists.

### Disciplines to wire

| `FEATURES.md` row | Crania capability | Level | Evidence |
|---|---|---|---|
| **PWTP** | RO flow & recovery, RO membrane area | L2 | `water-ro-recovery-001` PASS_EXACT; mass balance closes over HTTP |
| | Conventional train (coag/floc/sed/filtration), NaOCl dosing | L1 | `water-conventional-pwtp-001`, `water-chemical-dosing-001` PASS_EXACT |
| **Process: pump** | `designPump`, wet-well & cycle sizing, `hydraulic_pipe_loss`, `pipe_design`, `tank_design` | L2 | `water-pump-station-001`; 0.2% vs independent ρgQH |
| **Fire protection** | NFPA 13/20/22 sprinkler demand, storage, fire-pump; NFPA 291 supply adequacy | L1 | `fire-ordinary-hazard-001` PASS_EXACT; both tools execute |
| **HVAC** | Block loads (`designHvacLoads`, Partial); psychrometrics, supply airflow & coil duties (`designSupplyAir`, Supported) | L1 | `hvac-office-package-001` PASS; both tools execute |

Additionally, two of the six process-equipment items close: **heat-exchanger sizing**
(LMTD + Bowman F, 0.189% diff) and **pressure-vessel sizing** (ASME VIII Div 1 UG-27, 0.008% diff).

### Disciplines that do NOT close, and must keep their current rating

| `FEATURES.md` row | Why |
|---|---|
| **WWTP** | MBBR and MBR size at L2, but **ASM1/2d/3 and BNR — the methods the row names — are UNSUPPORTED.** Total-nitrogen removal and IFAS are also UNSUPPORTED. Crania excludes Wastewater from pilot scope because the workflow *"has not had qualified-engineer review."* |
| **Electrical / NEC** | Crania **withdrew** its NEC Article 430 declaration. The breaker output is UNSUPPORTED — sized with an overload multiplier, *"wrong under both NEC and IEC"* (finding F9). Fault level, voltage drop, conduit fill/derating and coordination are all UNSUPPORTED. `electrical_distribution` executes, but its most load-bearing output is disclaimed. |
| **Stormwater** | No stormwater vertical exists in Crania. Zero coverage. |
| **Oil & Gas** | Crania's fuel vertical is diesel/genset storage, not O&G separation. An `oil-gas.engine.ts` exists in Ava-Engineering-Core but is not exposed through the MCP surface or the registry. |
| **Process equipment** (remaining 4) | Souders-Brown (separator), Rachford-Rice (flash-VLE), reactor, and general mass balance: not exposed. |

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
- **Negative / deployment constraint:** Crania's engines are **filesystem dependencies, not HTTP
  ones.** Any image serving Crania must contain both engine checkouts, on the right branches,
  built, with `AVA_ENGINEERING_CORE_DIR` and `AVA_MATH_ENGINE_DIR` set explicitly. The
  `ava-math-engine` `dist/` artifacts are **gitignored and uncommitted**, so a fresh clone has no
  WWTP math until it is built.
- **Negative:** a mis-resolved engine degrades silently — health stays green, benchmarks stay
  green, and only the uncovered capabilities fail, at call time.
- **Risk retired:** both engine repositories previously had **no git remote**. Pushed 2026-08-13
  to `ral197979/crania` (private, 9 branches) and `ral197979/ava-engineering-core` (private,
  22 branches).
- **Neutral:** the transport split from ADR-011 holds — MCP for calculations (`CRANIA_MCP_URL`,
  21 tools), REST for the doc factory (`CRANIA_BASE_URL`, 72 endpoints).

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

1. **Add a registry-integrity test in Crania** asserting every declared `engine · function`
   binding resolves to a callable export, and fail CI otherwise. One probe of the 21 MCP handlers
   would have caught the mis-resolution immediately. This should land before any Denver wiring.
2. **Make `/api/health` capability-aware** — resolve the registry's bindings rather than reporting
   `available: true` for a directory that exists.
3. Merge or document the `-crania-clean` engine checkouts so the default path resolution is
   correct, removing the need for an environment override to get a working system.
4. Populate `CRANIA_MCP_URL` / `CRANIA_BASE_URL` and build the client — restricted to the
   capabilities above.
5. Surface registry support level + known limitations alongside every calculated value in the UI.
6. Update `FEATURES.md` rows only after the wiring is verified end to end.
7. Commit or discard ava-math-engine's uncommitted working-tree changes; pin the engine version
   and record it with every calculation result.
