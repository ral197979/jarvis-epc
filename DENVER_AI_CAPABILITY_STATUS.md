# Denver Engineering — AI Capability Status

**Companion to** [`DENVER_FEATURE_TRUTH.md`](DENVER_FEATURE_TRUTH.md). Machine-readable source: [`src/config/capabilityRegistry.ts`](src/config/capabilityRegistry.ts).

> **The headline:** Denver has **one** genuine generative-AI feature (Ask Jarvis, a grounded RAG assistant). Everything else branded "AI", "Copilot", "Autopilot", "IQ", "Intelligence", or "Predict" is **deterministic analytics or a statistical model** — useful, often sophisticated, but **not** generative AI and it should not be sold as such.

---

## 1. Mechanism map

| Surface | Route | Branding implies | Actual mechanism | LLM? | Status |
|---|---|---|---|---|---|
| **Ask Jarvis** | `ask` | AI assistant | Grounded RAG: retrieval over tenant corpus + Fix Library → Anthropic Claude → schema-enforced answer with citations | **Yes** | `GROUNDING_OR_RAG` |
| Knowledge | `knowledge` | Document search | Ingest + chunk + embed + search; LLM summaries | Yes (summaries) | `VERIFIED_EXTERNAL` |
| Focus | `focus` | AI copilot | Deterministic ranking of live cross-module signals | No | `DETERMINISTIC_AUTOMATION` |
| Coordination | `coordination` | AI | Deterministic blocker/clash/approval detection | No | `DETERMINISTIC_AUTOMATION` |
| Autopilot | `autopilot` | Autonomous AI | Deterministic recommendations + **human** approve/dismiss loop | No | `DETERMINISTIC_AUTOMATION` |
| Executive | `executive` | AI briefing | Deterministic portfolio-health briefing | No | `DETERMINISTIC_AUTOMATION` |
| Portfolio IQ | `portfolioiq` | AI | Deterministic cross-project benchmarks + resource conflicts | No | `DETERMINISTIC_AUTOMATION` |
| Quality IQ | `quality` | AI | Deterministic analytics over inspections + punch | No | `DETERMINISTIC_AUTOMATION` |
| Cost IQ | `costiq` | AI | Deterministic budget-drift explanation with cited drivers | No | `DETERMINISTIC_AUTOMATION` |
| Procurement Risk | `procurementrisk` | Risk prediction | Deterministic PO ranking + vendor rollup | No | `DETERMINISTIC_AUTOMATION` |
| Vendor Scorecard | `vendorscore` | Scoring intelligence | Deterministic synthesis from subcontracts + POs | No | `DETERMINISTIC_AUTOMATION` |
| Field Assistant | `fieldai` | AI Field Assistant | Deterministic, grounded in inspections + punch + schedule | No | `DETERMINISTIC_AUTOMATION` |
| Predict | `predict` | ML prediction | **Statistical/heuristic** — portfolio health, EAC trend, anomaly flags; confidence values are heuristic, not model-calibrated | No | `PREDICTIVE_MODEL` |
| Schedule Forecast | `forecast` | AI forecast | **Monte Carlo simulation** over the real CPM dependency network | No | `PREDICTIVE_MODEL` |
| Process Design | `processdesign` | AI Process Engineering | UI → external Ava MCP orchestrator (unconfigured by default); no proven calc engine | Indirect | `EXTERNAL_SHELL` |
| MCP tools | `mcp` | 43 AI tools | ~6-9 native; ~34 proxy to unconfigured `AVA_MCP_URL` → 503 | Partial | `PARTIAL` |

## 2. Approved product language

For deterministic features, these are accurate and still compelling:
**automated · rules-based · risk-scored · decision-support · analytics · workflow intelligence · deterministic**

Do **not** describe a deterministic feature as: *generative AI · AI-powered · the AI decides · machine learning · intelligent agent*.

For `PREDICTIVE_MODEL` features, state the method (*Monte Carlo simulation*, *statistical trend*) and that outputs are **not** model-calibrated confidence.

## 3. Ask Jarvis — the one real generative feature

| Dimension | Finding |
|---|---|
| Provider | Anthropic Claude (`ANTHROPIC_API_KEY`); external dependency |
| Backend | `api/services/askBuilder.ts` (`POST /api/v1/ask`) |
| Retrieval | Hybrid retrieval over ingested tenant corpus + Fix Library |
| Grounding | System prompt instructs *"Answer ONLY from the provided SOURCES — never from general knowledge"* — **already honest**, unchanged by this audit |
| Citations | Schema-enforced structured output incl. citations; hoverable/clickable source previews |
| Sessions | Persisted; tenant-scoped |
| Budget | Enforced on the ask path (402 when over budget; fails open only on lookup error) |
| Gaps | Budget-path and federated-DP tests absent (prior audit P1-10 / P1-11) |

**Unsupported-calculation behavior (remediated in this audit):** Ask Jarvis must not present unimplemented engineering calculators as executable. See §4.

## 4. System-prompt remediation (this audit)

`src/config/systemPrompt.ts` previously advertised capabilities Denver does not have:

| Removed overclaim | Reality |
|---|---|
| "107 skills, AGI (10 modules), 43 tools" | No AGI modules; ~6-9 reachable MCP tools by default |
| "44 calcs, 9 disciplines, 4 design tools (HVAC/WWTP/**Fuel**/Aqua)" | No reachable calculation backend; "Fuel" tool does not exist |
| "12 NEC auto-calcs", "NEC: Motor FLA 430.250, Wire 310.16, Breaker 430.52…" | No NEC implementation anywhere |
| "7 agents", "MULTI-AGENT: WTP, HVAC, Electrical, Hydraulics…" | No such agent roster |
| "ENGINEERING: Use design tools for calcs." | Design tools cannot calculate |

**Replaced with an explicit engineering-calculation honesty boundary** instructing the assistant to help organize the design basis, retrieve documents, and prepare inputs — and to state that the calculation must be performed in a validated external tool and reviewed by a qualified engineer.

**Blast radius (stated honestly):** this prompt's only consumer is the legacy `src/jarvis/JarvisCore.jsx` client path. The production RAG assistant already used its own grounded prompt, so this correction removes latent hallucination fuel rather than fixing an active production defect.

**Enforced by tests** (`src/__tests__/config/config.test.ts`): the prompt must not contain `44 calcs`, `12 NEC auto-calcs`, `Fuel`, `107 skills`, or `AGI`, and must contain the honesty boundary. Two pre-existing tests that asserted the *false* NEC-`430.x` / EVM-CPI-SPI calculation advertising were replaced with these honesty assertions — the old assertions encoded the overclaim.

## 5. What is genuinely notable

Denver's deterministic analytics layer is a real strength when described accurately: cross-module blocker detection, cited budget-drift explanation, CPM-based Monte Carlo forecasting, and deterministic quality/vendor scoring are all **explainable and auditable** — properties an LLM-based equivalent would not have. The honesty fix is a *positioning* correction, not a capability downgrade.
