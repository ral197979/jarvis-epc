# Screen Inventory — Denver Engineering

> v1, grounded in `src/config/navigation.ts` + `src/components/ContentRouter.tsx` (live tab map).
> ✅ implemented view · 🟡 shallow/partial · ❌ planned.

## Navigation domains & screens

**AI**
- 🧭 **Focus** (`focus`) ✅ — Project Copilot ranked focus list + deep-links (shipped this work).
- 🤖 **Ask Jarvis** (`ask`) ✅ — grounded RAG chat with citations.
- 🔮 **Predict** (`predict`) ✅ — portfolio health, risk matrix, EAC forecast.

**Operations**
- 📊 **Dashboard** (`dash`) ✅ · **Projects** (`projects`) ✅ · **Team** (`team`) ✅ · **Timesheets** (`timesheets`) ✅ · **Actions** (`actions`) ✅ · **Notifications** (`notifications`) ✅
- **Executive / Ops command center** (`/api/v1/executive`, `/ops`) 🟡 — overview, portfolio risk, escalation hotspots, blockers.

**Construction**
- **Construct** (`construction`) ✅ · **Daily Logs** ✅ · **Drawings** ✅ · **Import Schedule** (XER/MPP) ✅ · **Subcontracts** ✅ · **Meetings** ✅ · **BIM** ✅ · **IoT Sensors** ✅ · **RFIs** ✅ · **Submittals** ✅ · **Punch List** ✅ · **Inspections** ✅ · **Compliance** ✅ · **Risk Register** ✅

**Finance**
- **Change Orders** ✅ · **Cost Control** ✅ · **Cost Entry** ✅ · **EVM** ✅ · **Budget** ✅ · **Portfolio** ✅

**CRM / BD**
- **CRM** ✅ · **Proposals** ✅

**Engineering**
- **FEED** ✅ · **Process Design** ⚠️ (shell) · **Calcs** ⚠️ (shell) · **Eng Hub** ✅ · **Fix Library** ✅

**Documents / Procurement / System**
- **Transmittals** ✅ · **Documents** ✅ · **Directory** ✅ · **Knowledge** ✅ · **MCP** ✅ · **Automation** ✅ · **Integrations** 🟡 · **System/Settings** ✅

## Planned screens (gap to vision)
- ❌ **Executive Copilot** report builder · ❌ **Coordination Copilot** board · ❌ **Portfolio Copilot** comparison
- ❌ **Safety** suite (observations/incidents/permits/JSA) · ❌ **Submittal review assistant** · ❌ **RFI impact analysis** panel
- ❌ **Schedule Monte Carlo / recovery planner** · ❌ **Billing / pay applications** · ❌ **Document control** (superseded/distribution/overlay) · ❌ **Integration marketplace** catalog
- 🟡 **Mobile field PWA** screens (arrival/scan/field-home/sync exist in `denver-engineering-next`)

> Shells (⚠️) render real UI but rely on placeholder math — see `FEATURES.md`. They must be relabeled or backed by validated engines before being shown to enterprise buyers.
