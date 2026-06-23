# 13 — Integrations, MCP & Automation Audit

## Modules Covered
- Integration Hub
- MCP (Model Context Protocol) Bridge
- Automation Scheduler
- Webhook Dispatcher
- Sync Jobs
- Ecosystem Platform

---

## Integration Hub

**Frontend:** `integrations` nav → **ComingSoonView** ❌ (P1)  
**Backend:** `api/routes/integrationHub.ts` ✅  
**Migration:** `004_integrations.sql`, `049_ecosystem_platform.sql` ✅

**Critical Gap:** The integration hub backend exists, but the frontend integration view is a `ComingSoonView` stub. Enterprise customers cannot use integrations through the UI. **P1.**

### Integration Services
- `api/routes/integrations.ts` — base integration CRUD ✅
- `api/routes/webhooks.ts` — outbound webhook dispatcher ✅
- `api/routes/sync-jobs.ts` — sync job management ✅
- `api/services/integrationSync.ts` — sync orchestration ✅
- `api/services/integration/connectorFramework.ts` — connector framework ✅

### Declared Integrations (from navigation context)
The `ComingSoonView` message mentions: "QuickBooks, Slack, Tractian, BACnet" — suggesting planned integrations. None are fully implemented.

**Gaps:**
- No working integration implementations confirmed
- No OAuth2 flow for third-party auth
- No integration health monitoring
- No retry/dead-letter queue for failed webhook deliveries (**P1**)

---

## MCP (Model Context Protocol)

**Frontend:** `src/components/MCPToolsPage.tsx` ✅  
**Backend:** `api/routes/mcp.ts` ✅  
**Migration:** `015_mcp_marketplace.sql` ✅  
**Constants:** `src/constants/mcpTools.ts` ✅  
**Test:** `api/__tests__/mcp.test.ts` ✅

**Assessment:** MCP bridge allows the AI system to invoke tools via the Model Context Protocol. Marketplace for MCP tools with install/manage capabilities.

**Strengths:**
- MCP marketplace with governance (**PluginPermissionReview** component) ✅
- Test coverage ✅

**Gaps:**
- MCP tool execution sandboxing — can MCP tools access arbitrary filesystem paths? Not confirmed. (**P1**)
- No rate limiting per MCP tool execution
- Plugin kill switch exists (`triggerKillSwitch`) ✅ but automated health monitoring unclear

---

## Automation Scheduler

**Frontend:** `src/components/AutomationView.tsx` ✅ (58KB gzipped — largest non-commissioning view)  
**Backend:** `api/routes/automation.ts`, `api/services/scheduler.ts` ✅  
**Admin route:** `api/v1/admin/automation` — requires owner/admin ✅

### Scheduler Jobs
- `registerKpiSnapshotHandler` — KPI snapshots
- `registerComplianceWatcher` — compliance checks
- `registerAuditRetentionHandler` — audit cleanup
- `registerKnowledgeIngestHandler` — knowledge ingest
- `registerFixExtractorHandler` — fix pattern extraction
- `registerKnowledgeEmbedHandler` — embedding generation
- `registerSlaEngine` — SLA tracking
- `registerNotificationWorker` — notifications
- `registerAnalyticsSnapshotHandler` — analytics
- `registerReadinessSnapshotHandler` — readiness snapshots

**Strength:** Comprehensive background job system ✅

**Gap:** No persistent job store. Jobs are in-memory. On Render free tier (sleep), all scheduled jobs are lost and restart on wake. Critical jobs (embedding, compliance) may miss cycles.

---

## Webhook Dispatcher

**Backend:** `api/services/webhookDispatch.ts` ✅  
**Migration:** `004_integrations.sql` — `webhooks` table

**Gaps:**
- Retry logic not confirmed (failed webhooks may not be retried) (**P1**)
- No dead-letter queue for permanently failed webhooks
- No webhook signature verification for inbound webhooks (security)
- HMAC signing of outbound webhooks not confirmed

---

## Ecosystem Platform

**Backend:** `api/routes/ecosystem.ts` ✅  
**Services:** 10 ecosystem services (federated intelligence, plugin registry, workflow composer, etc.)  
**Migration:** `049_ecosystem_platform.sql` ✅

### Plugin Registry
- `api/services/ecosystem/pluginRegistryService.ts` — plugin management
- `api/services/ecosystem/playbookMarketplaceService.ts` — playbook marketplace
- Kill switch: `triggerKillSwitch` — disables plugin and all tenant installs ✅

**Tests (FAILING):**
```
× publishPlaybook marks version immutable and updates status
× installPlaybook inserts install and increments install_count
× submitPlaybookReview inserts review and updates avg_rating
× triggerKillSwitch disables plugin and all tenant installs
```
**P1:** Core ecosystem operations have failing tests.

---

## Notifications

**Frontend:** `src/components/notifications/NotificationsView.tsx` ✅  
**Backend:** `api/routes/notifications.ts` ✅  
**Migration:** `064_notifications.sql` ✅  
**Service:** `api/services/notifications/notificationWorker.ts`, `api/services/notifications2/notificationService.ts` ✅

**Finding:** Two notification service files (`notifications/notificationWorker.ts` and `notifications2/notificationService.ts`) suggest a refactor in progress. **P2** — duplicate services.

**RLS on notifications:** NOT confirmed (**P1**)

---

## Risk Summary

| Module | Finding | Severity |
|---|---|---|
| Integrations | Frontend is ComingSoonView stub | P1 |
| Ecosystem | Core playbook/plugin tests fail | P1 |
| Webhook | No retry/dead-letter queue confirmed | P1 |
| Notifications | RLS not confirmed | P1 |
| MCP | Tool execution sandboxing not confirmed | P1 |
| Scheduler | In-memory jobs lost on restart | P1 |
| Webhook | No HMAC signing of outbound webhooks | P2 |
| Notifications | Duplicate notification service files | P2 |
| Ecosystem | Automated plugin health monitoring unclear | P2 |
