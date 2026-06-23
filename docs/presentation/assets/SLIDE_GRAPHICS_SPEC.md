# Slide Graphics Specification

> A build spec for every "Suggested graphic" in `PRESENTATION_SLIDES.md`. Paired slide-by-slide. Each entry gives: **what to show**, **the data/labels**, **layout**, and **style notes**. Use with `BRAND_AND_STYLE.md`.

General principle: every graphic should be legible at a glance from the back of a boardroom — one idea per slide, generous whitespace, one accent color for emphasis.

---

| Slide | Graphic | What to show | Data / labels | Layout & style |
|---|---|---|---|---|
| 1 | Hero | Facility + command-center overlay + readiness gauge | Product name + tagline | Full-bleed, dark industrial background, single glowing accent gauge |
| 2 | Before/After | Tool sprawl vs. one platform | "10+ tools" → "1 source of truth" | Split screen, left desaturated/chaotic, right clean/unified |
| 3 | Problem | Disconnected tools leaking value | Tool icons + "$ leaking" | Tangled-wires / spaghetti diagram, muted with red leak accents |
| 4 | Cost bar chart | Overrun ranges + callout | "20–80% overruns", "5–12% rework"; callout "1 avoided overrun > years of subscription" | Horizontal bars, one bold callout box |
| 5 | Market map | Build vs. Operate tools with a gap | "Build" / "Operate" columns, highlighted center "seam" | Use DIAGRAMS.md #2; highlight the seam in accent color |
| 6 | Bridge | Bridge connecting Build & Operate | Keystone = logo | Simple iconographic bridge |
| 7 | Lifecycle ribbon | Proposal→Turnover with cross-cutting layers | From DIAGRAMS.md #1 | Horizontal ribbon, 5 stages, 3 underlying bands |
| 8 | Domain grid | Nine work domains | Domain names + icons | Honeycomb or 3×3 grid |
| 9 | Security shield | Defense-in-depth layers | From DIAGRAMS.md #9 | Concentric layers or stacked bands |
| 10 | Intelligence triptych | Jarvis / Predict / Command Center over data | From DIAGRAMS.md #6 | Three panels on a data-model base |
| 11 | Dashboard mockup | Annotated dashboard | KPI tiles, EVM gauges, activity feed | Real UI mockup with callout pins |
| 12 | Project + actions | Project hub with action cards | SLA badges, escalation arrows | UI mockup |
| 13 | Cx funnel | 4-phase commissioning | pre-comm → pre-functional → functional → turnover; "21 asset types" | From DIAGRAMS.md #4 (top half); funnel styling |
| 14 | Retest loop | Deficiency → retest → close | "Closes only on a passing retest" | Loop diagram, accent on the loop-back arrow |
| 15 | Readiness gauge | Score + weighted components | 30/25/20/15/10 weights; states | From DIAGRAMS.md #5; big gauge + small component bars |
| 16 | EVM S-curve | BCWS/BCWP/ACWP + CPI/SPI gauges | Curve labels + two gauges | Line chart + two arc gauges |
| 17 | Risk + portfolio | 5×5 matrix + rollup | Probability×impact grid; IRR/NPV/MOIC | Matrix left, table right |
| 18 | Design coordination | Drawing markup + BIM clash | Revision tag, clash callout | UI mockup with annotation pins |
| 19 | P&ID | Generated ISA-5.1 diagram | Valve actuators, instrument bubbles, title block | Real generated P&ID sample with callouts |
| 20 | Field sync | Mobile capture → dashboard | "Offline → sync" arrow | Phone mockup syncing to a dashboard |
| 21 | Document AI | Register + AI summary panel | Search bar, summary card | UI mockup |
| 22 | Cited answer | Chat answer with citations | Hover-citation linking to source | UI mockup with citation popovers |
| 23 | Predict | Health gauge + EAC forecast | Trend line + anomaly flags | Gauge + trendline with flag markers |
| 24 | Command center | Heatmap + live feed | Worst-first project rows; live events | UI mockup, heatmap red→green |
| 25 | Recommendation + root cause | Reco card + correlation timeline | "why" text + impact/urgency/confidence; correlated events | Card + horizontal timeline (DIAGRAMS.md #7 simplified) |
| 26 | Delivery swimlane | Win→Close-out | 6 stages | Horizontal swimlane |
| 27 | Cx-to-turnover | Scope→turnover with readiness gauge | From DIAGRAMS.md #4 | End on the readiness gauge |
| 28 | Asset ring | Register→operating record | From DIAGRAMS.md #10 | Circular ring |
| 29 | Ops loop | Detect→learn | From DIAGRAMS.md #7 | Closed loop |
| 30 | Data funnel | Live data→decision | From DIAGRAMS.md #8 | Funnel/flow |
| 31 | ROI scale | Subscription vs. avoided overrun | Balance tipping to value | Scale icon, heavy on the value side |
| 32 | ROI cards (DC/Industrial) | Two headline cards | $300M→~$4.5M+1.5–2.5wks; $150M→~$4.5M | Two cards, big numbers |
| 33 | ROI cards (Hospital/Embassy) | Two headline cards | $200M→~$3.0M+60%; $120M→~$1.8M+70% | Two cards |
| 34 | ROI cards (Water/University) | Two headline cards | $90M→~$1.35M+2–4wks; $250M→~$5.0M | Two cards |
| 35 | Levers table | Seven ROI levers | From ROI_ANALYSIS.md levers table | Clean table |
| 36 | Category map | Four categories + our seam | Maximo/Procore/ServiceNow/Cx tools; center = us | 2×2 or band map |
| 37 | Win matrix | vs. each competitor | Win / tie / complement | Matrix, green/amber for win/tie |
| 38 | Scope columns | In scope / integrates with | Two columns | Honest, clean two-column |
| 39 | Roadmap horizons | Now / Next / Later | Direction items (not commitments) | Three horizon bands |
| 40 | Closing | Pilot path + contact | 5-step pilot path | Clean, calm, single CTA |

---

## Reusable graphic components

- **Readiness gauge** (slides 1, 15, 27): a single arc gauge, 0–100, color band red→amber→green at the 40/65/85 thresholds, with the weighted-component mini-bars beside it.
- **ROI card** (slides 31–34): project value (small, top) · headline savings (large, accent) · time benefit (subtitle) · facility icon.
- **Heatmap row** (slide 24): project name · open actions · escalations · overdue · readiness — cell color red→green.
- **Citation popover** (slide 22): a small card showing source document title + chunk snippet, anchored to the cited phrase.

---

*Keep all numeric claims consistent with `ROI_ANALYSIS.md` (illustrative, assumption-stated) and never depict SCADA/plant-operations or certified-calculator capabilities the platform doesn't have (see `COMPETITIVE_POSITIONING.md`).*
