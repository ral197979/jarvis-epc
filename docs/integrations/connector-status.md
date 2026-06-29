# Denver — Third-Party Integration Status Matrix

Verified against the code (not the marketing/spec docs). Status legend:
- **Implemented** — real outbound/inbound wiring exists (HTTP/SDK/OAuth).
- **Stub** — registered as an integration *type* but the sync handler is a no-op placeholder.
- **Data-model only** — DB fields exist; no API calls.
- All external integrations are **per-tenant and OFF until credentials are configured.**

## Implemented
| Integration | Type | Wiring | File(s) | Credentials needed |
|---|---|---|---|---|
| **Outbound Webhooks** | generic | `fetch`, HMAC-SHA256 (`X-Jarvis-Signature`), SSRF-guarded, ret/backoff via job queue | `api/routes/integrations.ts`, `services/webhookDispatch.ts` | per-webhook secret (auto) |
| **Slack** | notify | incoming webhook + `chat.postMessage` (bot token), signature verify | `services/integration/slackConnector.ts` | webhook URL and/or `xoxb-` bot token |
| **Microsoft Teams** | notify | incoming webhook `fetch` | `services/integration/teamsConnector.ts` | Teams webhook URL |
| **QuickBooks** | ERP/accounting | Intuit API (sandbox+prod) + OAuth2 token flow | `services/integration/quickbooksConnector.ts` | Intuit OAuth client + tokens |
| **AWS S3** | file storage | real `@aws-sdk/client-s3` (lazy-required) | `api/files/storage.ts` | `STORAGE_BACKEND=s3` + `S3_*`/AWS keys; `npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` |
| **SAML SSO** | identity | full SP routes (login/ACS) | `routes/saml`, migration `073` | IdP metadata/cert (Okta/Auth0/Azure AD) |
| **SCIM 2.0** | identity provisioning | user/group provisioning endpoints | `routes/scim.ts`, migration `074` | SCIM bearer token |
| **Anthropic / Claude** | AI | AI gateway (the product's AI) | `routes/mcp.ts`, gateway | `ANTHROPIC_API_KEY` |
| **Sentry** | observability | error tracking (Pino fallback if unset) | error-tracking init | `SENTRY_DSN` (optional) |
| **Menlo (commissioning)** | federation | gateway + HMAC webhook (sister repo) | `services/integration/commissioning*` | flag `COMMISSIONING_EXTERNAL` + URL/secret |
| **Ava MCP bridge** | federation/AI | outbound MCP bridge | `routes/mcp.ts` | `AVA_MCP_URL` |

## Stub (type registered, sync is a no-op in v1)
`api/services/integrationSync.ts` defines these integration types but the handlers are commented out and
return a clean no-op:
| Integration | Status |
|---|---|
| **Procore** | Stub — `// case 'procore': return _syncProcore(...)` (no-op) |
| **Autodesk BIM 360 / Forge** | Stub — `routes/bim.ts` + sync placeholder; no live Forge OAuth |
| **SAP** | Stub |
| **Oracle Primavera (P6)** | Stub |
| **MS Project** | Stub |
| **Aconex** | Stub |

> The `custom_webhook` path routes through the implemented generic webhook dispatcher; the named ERP/BIM
> connectors above need real handlers before use.

## Data-model only (not a live integration)
| Integration | Status |
|---|---|
| **Stripe** | Only `stripe_customer_id` / `stripe_subscription_id` columns in enterprise provisioning; **no Stripe SDK/API calls** |

## Notes
- **Identity providers** (Okta / Auth0 / Azure AD / generic OIDC) are reached via the standard **SAML/SCIM**
  surface — they are configuration, not separate connectors.
- **Federation** connections (AEC, Crania, ControlCore, Menlo) go through the capability registry / MCP and
  are distinct from external-vendor integrations; all flag-OFF in v2.0.1.
- **Marketplace/plugin model** exists (`INTEGRATION_MARKETPLACE_SPEC.md`, `pluginRegistryService`,
  `playbookMarketplaceService`) as a framework; it is not a set of live vendor connectors.
- The generic **integration registry** (`/api/v1/integrations`, `connectorFramework.ts`) is the supported
  way to add/configure connectors per tenant with health + retry.
