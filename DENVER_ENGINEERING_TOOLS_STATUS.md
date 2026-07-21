# Denver Engineering — Engineering Tools Status

**Companion to** [`DENVER_FEATURE_TRUTH.md`](DENVER_FEATURE_TRUTH.md). Machine-readable source: [`src/config/capabilityRegistry.ts`](src/config/capabilityRegistry.ts).

> **Read this before relying on any number produced by a Denver engineering tool.**
> Denver has **no validated engineering-calculation backend reachable from this application**. The discipline design tools are **design-assist / drafting interfaces**, not certified calculators. Every output requires performance in a validated external tool and review by a qualified, licensed engineer.

---

## 1. How engineering tool calls actually flow

```
CalcView.tsx / ProcessDesignView.tsx   (UI: inputs, tool cards)
        │
        ▼
POST /api/v1/mcp/execute               (api/routes/mcp.ts)
        │
        ├── ~6-9 NATIVE_TOOLS ────────► implemented in this repo (http_fetch, audit_log/query,
        │                               model_call, knowledge.*/ask_domain, session_*)
        │
        └── ~34 AVA_ONLY_TOOLS ───────► proxied to AVA_MCP_URL
                                          │
                                          ▼
                             Ava **agent/task orchestrator**
                             (chat / skills / task / git dispatcher)
                             — NOT a calculation engine
                             — AVA_MCP_URL is **blank in .env.example**
                                          │
                                          ▼
                             503 { error: 'ava_not_configured' }  ← default behavior
```

**Consequence:** in a default deployment, discipline engineering tool calls do not reach any calculation implementation. Where a tool computes something locally in the browser instead, that math is placeholder (synthetic / noise-multiplier / unvalidated approximation), not engineering.

## 2. Discipline-by-discipline matrix

| Discipline / tool | UI claims | Actual calculation status | Truth status |
|---|---|---|---|
| **WWTP** (ASM1/2d/3, BNR, MBR, sludge) | Treatment design & sizing | Real validated math is reported to exist in a **separate repository** (`ava-math-engine`). **Not wired** to Denver — no configured runtime path. Denver's tool is a shell. | `EXTERNAL_SHELL` |
| **PWTP** (RO/NF, clarifiers, GAC, UV, chlorine CT) | Potable water design | **Missing** — no design code reachable; in-app math is synthetic. | `EXTERNAL_SHELL` |
| **Pump / hydraulics** (TDH, Darcy-Weisbach) | Pump sizing | Real calc reported in a **separate repository** (`MEPPro-Precision-Edition`), **isolated** — not reachable from Denver. | `EXTERNAL_SHELL` |
| **Process equipment** — separator, flash/VLE, reactor, mass balance, heat exchanger, pressure vessel | Process equipment design | **Missing** — routes to MCP; no backend implements Souders-Brown, Rachford-Rice, LMTD/NTU, ASME VIII. | `EXTERNAL_SHELL` |
| **HVAC / MEP** (ASHRAE load, duct/pipe sizing) | Load & sizing calcs | **Corrected 2026-07-21 — NOT a stub.** Real deterministic U·A·ΔT envelope loads, orientation-split solar gains, psychrometrics, Reynolds/friction/pressure-drop exist (`Denver-v3_4-MCP-API.html:17984-18075, :20223-20275`). But **unvalidated**, with hard-coded fudge factors (invented `1.3/1.5/1.6` "solar factors"), and it shows a false `"per NEC/ASHRAE"`-style success toast. Treat as **unvalidated in-app calculation**, not a shell and not a stub. | `EXTERNAL_SHELL`* |
| **Electrical / NEC** (motor FLA, wire, breaker, conduit) | NEC sizing | **Corrected 2026-07-21 — NOT "text only".** Real 3-phase current (`demand/(480·√3·0.85)`), 125% continuous factor, breaker ladder, voltage-drop, short-circuit exist (`Denver-v3_4-MCP-API.html:25610-25739`). **Unvalidated**, and emits a false `"Electrical loads calculated per NEC Article 220"` toast. **Unvalidated in-app calculation.** | `EXTERNAL_SHELL`* |
| **Stormwater** (detention, LID, runoff) | Hydrology & detention | **Corrected 2026-07-21 — NOT a stub.** Rational Method (`Q=CiA`), NRCS curve-number TR-55 (`S=1000/CN−10`), Kirpich/NRCS/Kerby time-of-concentration, detention sizing, inlet/channel/bioretention design exist (`Stormwater-Designer-v1_4-MCP-API.html:4851-5876`). **Unvalidated in-app calculation**, not a stub. | `EXTERNAL_SHELL`* |
| **Fire protection** (NFPA) | Suppression references | **Corrected 2026-07-21 — NOT "mention only".** Real NFPA-13 density-by-hazard table, `flowHead=k·√P` orifice equation, hose-stream allowance, standpipe (`Denver-v3_4-MCP-API.html:25891-25938`). **Unvalidated** (magic `+5 psi`, "simplified Hazen-Williams `·0.5`"), and shows a false `"Sprinkler system designed per NFPA 13"` toast. **Unvalidated in-app calculation.** | `EXTERNAL_SHELL`* |
| **Oil & Gas** (separator, flash) | O&G process | **Missing** — same as Process equipment. | `EXTERNAL_SHELL` |
| **P&ID / PFD diagrams** | ISA-5.1 drawings | **Corrected 2026-07-21 — BROKEN, not real.** The PFD tool always renders a placeholder fallback (symbol-name probe misses `class UniversalPIDGenerator`); the TRUE-P&ID tool throws a `TypeError` every run (wrong arg order + four undefined methods); both are **canvas, not SVG** (`generateSVG()` returns an empty rect); **DXF export is a stub** (`exportToPIDDXF` undefined repo-wide — the button downloads an SVG). | `BROKEN_OR_DEAD` |
| **EPC calculators** (EVM, schedule, manpower, unit rate) | Project-controls math | ✅ **Real and deterministic**, in-repo — these are project-controls arithmetic, not discipline engineering design. | `VERIFIED_NATIVE` (within `calc`) |

> **\* `EXTERNAL_SHELL*` (corrected 2026-07-21).** The independent review found the original "stub / text-only / mention-only" labels on HVAC, Electrical, Stormwater, and Fire were **too harsh and misleading in the opposite direction**: each contains real, hand-rolled deterministic engineering code that returns a confident, precisely-formatted number. The taxonomy lacks an exact status for this; the honest description is **"unvalidated in-app calculation"** — *worse* than an empty shell for a reviewer, because a shell returns nothing while these return a plausible unvalidated answer with a green success toast. Do not read these rows as "nothing to worry about."

## 2a. Undisclosed misleading behavior (added 2026-07-21)

The original audit documented synthetic math but omitted three user-facing behaviors that actively mislead:

1. **Fabricated results presented as an optimization run.** `WWTP-DesignPro-v5_0-MCP-API.html:18525-18546` `runOptimization()` waits 2 s, generates four `Math.random()` numbers, and shows `"✓ Optimization complete! Pareto-optimal solution found."` `runSensitivityAnalysis()` claims "100 simulations" and does nothing.
2. **False code-compliance toasts.** `"Sprinkler system designed per NFPA 13"` (`Denver-v3_4-MCP-API.html:25933`), `"Electrical loads calculated per NEC Article 220"` (`:25644`), plus a `"DXF/CAD EXPORT — FULLY WORKING"` banner (`:803-804`) for an export that downloads an SVG.
3. **No in-app warning anywhere.** No discipline tool renders any disclaimer from §4 below; the `calc` surface offers **"Save to Project"**, persisting synthetic numbers into the project record of truth with no provenance flag. The registry documents the problem; the running app does not.

## 3. What P&ID/PFD generation does and does not prove

> **Corrected 2026-07-21: P&ID/PFD generation is currently BROKEN** (see the table row and the `pid-pfd-generator` registry entry). The description below is the *intended* behavior; it is not what the tools do today. The PFD tool renders a placeholder, the TRUE-P&ID tool throws, output is canvas-not-SVG, and "DXF export" downloads an SVG.

**Intended (not currently working):** produce real ISA-5.1-style diagrams — valve/actuator symbols, instrument bubbles, title block.

**Would NOT prove or imply, even when fixed:** hydraulic sizing · process sizing · equipment selection · code compliance · operability · safety · constructability.

A generated diagram is a **drafting artifact**. It carries no calculation authority.

## 4. Approved user-facing language

Use:
- `Design-assist interface`
- `Drafting tool`
- `Diagram generation only`
- `External calculation service required`
- `Calculation backend not connected`
- `Prototype output — not for engineering use`
- `Requires engineer verification`
- `Unavailable in this deployment`

Do **not** use `beta`, `experimental`, or `AI-assisted` when the real issue is that **no calculation backend exists** — those words imply the capability works but is immature, which is untrue and misleading.

## 5. To make these real (deferred — not implemented in this audit)

Tracked in [`DENVER_CAPABILITY_BACKLOG.md`](DENVER_CAPABILITY_BACKLOG.md):
- **WWTP:** implement and test a runtime bridge from Denver to a validated WWTP calculation service, then re-classify only after the path is exercised end-to-end.
- **Pump:** expose a validated pump-head calculator as a reachable MCP tool or HTTP endpoint.
- **PWTP, process equipment, HVAC, NEC, stormwater, fire, O&G:** no backend exists; these require building or integrating real calculation engines.

**A capability is only `VERIFIED_EXTERNAL` once Denver can actually invoke it over a configured, tested runtime path** — the existence of calculation code in another repository is explicitly *not* integration, and this audit did not enter, inspect, or copy from any external repository.
