# User Workflows — Denver Engineering

> v1. End-to-end flows by persona. ✅ supported today · 🟡 partial · ❌ planned.
> The recurring theme: the **Project Copilot Focus** screen is the daily entry point that replaces
> "clicking and chasing" with "deciding and executing."

## Project Manager — daily coordination
1. Open **Focus** ✅ → ranked list of overdue RFIs, stalled submittals, high risks, slip, overrun (each with *why* + recommended action).
2. Click a card → **deep-link** ✅ into the RFI/submittal/risk/inspection/punch in place.
3. Resolve: respond to RFI, route submittal, assign action ✅.
4. 🟡→❌ Ask Coordination Copilot "what approvals are missing / what clashes exist?" (planned).
5. ❌ RFI impact analysis (schedule/cost/procurement/systems) before committing an answer.

## Superintendent — field execution (mobile)
1. ✅ Offline daily log: crew, weather, equipment, production; photos/signatures.
2. 🟡 Capture inspections/punch with media + QR/GPS; queue offline → sync.
3. 🟡 AI daily report drafted from the day's captures.
4. 🟡→❌ Field assistant: "what's behind schedule / blocking Area B / inspections due today?" (Focus engine scoped to area).

## QA/QC — quality
1. ✅ Run template inspection (e.g., ACI 318, UL 1479), record pass/fail/na, sign.
2. ✅ Failed item → deficiency / punch item, assigned + tracked.
3. ❌ NCR → CAPA → root-cause; quality intelligence flags recurring issues & contractor performance.

## Cost Manager — controls
1. ✅ Maintain budget by cost code/WBS; record change orders; enter actuals.
2. ✅ Review EVM (SPI/CPI, EAC); ✅ Focus flags budget overrun.
3. ❌ Generate pay application from SOV + % complete; track retention/lien waivers.
4. 🟡→❌ AI explains budget drift with cited drivers.

## Project Executive / Executive — portfolio & assurance
1. ✅ Portfolio rollup (IRR/NPV/MOIC), Predict health/risk matrix.
2. 🟡 Executive/Ops command center (overview, risk, hotspots, blockers).
3. ❌ Executive/Owner Copilot generates board/owner/weekly report (narrated over EVM+risk+schedule, cited).
4. 🟡→❌ Portfolio Copilot compares projects, flags systemic issues & resource conflicts.

## Owner — visibility & accountability
1. 🟡 Read-only project health, documents, transmittals.
2. ❌ Owner Copilot summary + immutable decision log for accountability.

## Contractor / Sub — self-serve
1. ✅ View assigned drawings, submittals, RFIs, tasks/actions; ✅ notifications.
2. 🟡 Submit/respond with overdue tracking.

## Autonomous coordination (Phase 12, planned)
Monitor RFIs/submittals/schedule/cost/procurement → detect delays/bottlenecks/risks → recommend action+owner+due date (spawn `action`) → **execute with approval** (reminders/assignments/escalations/reports), every step in the immutable decision log.
