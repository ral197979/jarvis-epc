# Denver Engineering — Navigation & Information Architecture

> **The authoritative reference for the sidebar and IA.** Mirrors the shipped
> [src/config/navigation.ts](src/config/navigation.ts) (the `NAV_SECTIONS` +
> `NAVIGATION_ITEMS` arrays) and the lifecycle redesign in
> [WORKFLOW_REDESIGN.md](WORKFLOW_REDESIGN.md). If the code and this doc disagree,
> the code wins — update this doc.

---

## The four planes

Navigation is organised into four planes (see [WORKFLOW_REDESIGN.md §1](WORKFLOW_REDESIGN.md#1-new-information-architecture)):

1. **Personal** — where every user starts (Focus, My Work, Notifications, Actions)
2. **Project Lifecycle** — the EPC spine, project-scoped (Setup → Planning → Engineering → Procurement → Construction → Quality → Safety → Commercial → Turnover → Operations)
3. **Intelligence** — cross-cutting, mostly portfolio-scoped (AI + Executive)
4. **Governance / Admin** — org-scoped (Administration)

After login the user lands on **Focus** (not Dashboard). The sidebar renders the
sections below as collapsible groups, in this order; the section containing the
active screen auto-expands.

---

## Sidebar sections & items

Items marked **★ new** were added by the Workflow Redesign. Every other item is a
pre-existing screen that was re-homed (nothing was removed).

### Personal
| Item | id | Notes |
|---|---|---|
| 🧭 Focus | `focus` | Default landing; ranked cross-module daily briefing |
| 🗂️ My Work ★ | `mywork` | Personal queue: Assigned / Approvals / Overdue / Upcoming / Completed today |
| ⚡ Actions | `actions` | Cross-module action center (backs My Work) |
| 🔔 Notifs | `notifications` | Real-time alerts |

### Project Setup
| Item | id | Notes |
|---|---|---|
| 🧙 Setup Wizard ★ | `setup` | Resumable project initialization → creates a project |
| 📋 Projects | `projects` | Project registry |
| 🛤️ Lifecycle ★ | `lifecycle` | Lifecycle timeline + approval gates |
| 🎯 CRM | `crm` | |
| 📄 Proposals | `proposals` | |
| 👥 Team | `team` | |

### Planning
| Item | id |
|---|---|
| 📅 Import Schedule | `scheduleimport` |
| 🎲 Schedule Forecast | `forecast` |
| ⚠️ Risk Register | `riskregister` |
| 💰 Budget | `budget` |
| 📋 Meetings | `meetings` |

### Engineering
| Item | id |
|---|---|
| 🔬 FEED | `feed` |
| 🧪 Process Design | `processdesign` |
| 🧮 Calcs | `calc` |
| 📐 Drawings | `drawings` |
| 🏢 BIM | `bim` |
| 🛠️ Eng Hub | `hub` |
| 🔧 Fix Library | `fixlibrary` |
| ❓ RFIs | `rfis` |
| 📨 Submittals | `submittals` |

### Procurement
| Item | id |
|---|---|
| 🏗️ Subcontracts | `subcontracts` |
| 🚚 Procure Risk | `procurementrisk` |
| 🏅 Vendor Scorecard | `vendorscore` |
| 📚 Directory | `directory` |

### Construction
| Item | id |
|---|---|
| 🏗️ Construct | `construction` |
| 🗓️ Daily Logs | `dailylogs` |
| 🛠️ Field Svc | `field` |
| 🦺 Field Asst | `fieldai` |
| ⏱️ Timesheets | `timesheets` |
| 📡 IoT Sensors | `iot` |

### Quality
| Item | id |
|---|---|
| 🔍 Inspections | `inspections` |
| 📌 Punch List | `punch` |
| 🚫 NCR / CAPA | `ncr` |
| 🔬 Quality IQ | `quality` |

### Safety
| Item | id |
|---|---|
| 🦺 Safety | `safety` |
| 🛡️ Compliance | `compliance` |

### Commercial
| Item | id |
|---|---|
| 🔄 Change Orders | `changeorders` |
| 📉 Cost Control | `costcontrol` |
| 💵 Cost Entry | `costentry` |
| 📊 EVM | `evm` |
| 🧾 Billing | `billing` |
| 💸 Cost IQ | `costiq` |

### Turnover
| Item | id | Notes |
|---|---|---|
| 📦 Turnover ★ | `turnover` | Turnover packages + commissioning handoff (commissioning stays external) |
| 📬 Transmittals | `transmittals` | |
| 🗄️ Documents | `docs` | |

### Operations
| Item | id |
|---|---|
| 💰 Portfolio | `portfolio` |

### AI
| Item | id |
|---|---|
| 🔗 Coordination | `coordination` |
| 🔮 Predict | `predict` |
| 🤖 Autopilot | `autopilot` |
| 🤖 Ask Jarvis | `ask` |

### Executive
| Item | id | Notes |
|---|---|---|
| 📋 Executive | `executive` | Decision-first board view |
| 🗂️ Portfolio IQ | `portfolioiq` | |
| 📊 Dashboard | `dash` | Informational only (demoted from landing) |

### Administration
| Item | id |
|---|---|
| ⚙️ Automation | `automation` |
| 🔗 Integrations | `integrations` |
| 🔌 MCP | `mcp` |
| 📚 Knowledge | `knowledge` |
| ⚙️ System | `system` |

---

## Always-on shell context (every screen)

Rendered by [ContentRouter](src/components/ContentRouter.tsx) above each view:

- **Breadcrumb** — `Section › Screen` (from [WorkflowContextBar](src/components/shell/WorkflowContextBar.tsx)).
- **Project context chip** — active project · current phase · next-gate status; click → Lifecycle.
- **Guided-flow stepper** — when the active screen belongs to a workflow ([config/workflows.ts](src/config/workflows.ts)): Quality loop, Daily construction, Procurement, Engineering, Cost & commercial. Shows "you are here → next step".

---

## Role gating — navigation is a projection of authorization

Per [ADR-014](docs/adr/ADR-014-navigation-as-authorization-projection.md), the sidebar renders only
destinations the signed-in role can actually open, and the router enforces the same rule
independently. Both read one predicate — `canSee()` in
[src/config/capabilities.ts](src/config/capabilities.ts). There is no sidebar-specific permission
table.

- **`SCREEN_CAP`** maps every destination — all 62 sidebar items *and* the 8 hidden `TAB_MAP`-only
  routes — to the one capability that opens it.
- **`ROLE_CAPS`** grants capabilities to each of the **seven** `user_role` enum values
  (`api/db/migrations/001_tenants_and_users.sql`). Roles are not granted screens.
- **Fails closed.** An unknown role, an absent role, or an unregistered destination denies.
- **The router guards independently.** A deep link, a persisted tab from a prior role, or a
  cross-link from a KPI renders a **403** naming the destination and the missing capability — not
  the screen. Hiding a nav item is never the access control.

| Role | Capabilities | Sidebar items | Total routes |
|---|---|---|---|
| Owner | 20 | 62 / 62 | 70 |
| Admin | 20 | 62 / 62 | 70 |
| Project Manager | 15 | 44 / 62 | 50 |
| Engineer | 9 | 33 / 62 | 38 |
| Field Ops | 7 | 24 / 62 | 29 |
| Procurement | 5 | 19 / 62 | 24 |
| Viewer | 3 | 12 / 62 | 17 |

`portfolio.view` and `project.view` are deliberately distinct: a Project Manager has full depth on
projects with no cross-project financial roll-up.

> **⚠️ Client-side only — this is not yet a security boundary.** ADR-014 Phase 1 fixes the client.
> Server-side, `requireRole` is still applied only to administrative routers, so no cost, budget,
> EVM or portfolio endpoint enforces a role. The `requireCapability` middleware that closes that is
> **Phase 2 and not implemented**. Until it lands, treat this as UX correctness plus defence in
> depth, not as enforcement.

Write authority is separate and unchanged — see `POLICY_ACTIONS` and `PERSONAS[].canWrite` in
[src/modules/auth/index.ts](src/modules/auth/index.ts).

---

## Adding a screen (developer checklist)

1. Add the route/view component under `src/components/...`.
2. Register it in [ContentRouter.tsx](src/components/ContentRouter.tsx) (`lazy import` + `TAB_MAP`).
3. Add a `NavItem` to [navigation.ts](src/config/navigation.ts) with `id`, `label`, `icon`, `domain`, and `section`.
4. Add an icon to `ICON_MAP` in [NavSidebar.tsx](src/components/NavSidebar.tsx).
5. (Optional) Add it to a flow in [workflows.ts](src/config/workflows.ts) if it's a workflow step.

> The full screen-by-screen migration map (old home → new home) lives in
> [WORKFLOW_REDESIGN.md §13](WORKFLOW_REDESIGN.md#13-migration-plan--every-current-screen-mapped).
