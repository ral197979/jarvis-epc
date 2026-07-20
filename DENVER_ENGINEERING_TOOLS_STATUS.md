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
| **HVAC / MEP** (ASHRAE load, duct/pipe sizing) | Load & sizing calcs | **Stub** — in-app "load" math is not validated engineering. | `EXTERNAL_SHELL` |
| **Electrical / NEC** (motor FLA, wire, breaker, conduit) | NEC sizing | **Text references only** — no 430.250 / 310.16 / 430.52 / conduit-fill implementation. | `EXTERNAL_SHELL` |
| **Stormwater** (detention, LID, runoff) | Hydrology & detention | **Stub** — no Rational Method / curve-number / routing. | `EXTERNAL_SHELL` |
| **Fire protection** (NFPA) | Suppression references | **Mention only** — a UL 1479 firestop *inspection* checklist exists; no NFPA hydraulics. | `EXTERNAL_SHELL` |
| **Oil & Gas** (separator, flash) | O&G process | **Missing** — same as Process equipment. | `EXTERNAL_SHELL` |
| **P&ID / PFD diagrams** | ISA-5.1 drawings | ✅ **Real** — genuine SVG/DXF generation (`public/tools/denver/UNIVERSAL-PID-GENERATOR.js`, `TRUE-PID-GENERATOR.js`). **Drawing only.** | `DRAWING_GENERATOR` |
| **EPC calculators** (EVM, schedule, manpower, unit rate) | Project-controls math | ✅ **Real and deterministic**, in-repo — these are project-controls arithmetic, not discipline engineering design. | `VERIFIED_NATIVE` (within `calc`) |

## 3. What P&ID/PFD generation does and does not prove

**Does:** produce real ISA-5.1-style diagrams — valve/actuator symbols, instrument bubbles, title block, SVG rendering, DXF export.

**Does NOT prove or imply:** hydraulic sizing · process sizing · equipment selection · code compliance · operability · safety · constructability.

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
