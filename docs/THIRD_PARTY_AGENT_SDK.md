# Third-Party Agent SDK

## Overview

The External Agent Gateway provides a zero-trust interface for registering and executing third-party agents. All agents are scoped, authenticated via hashed API keys, and their outputs are validated before being persisted. High-impact actions can require human approval before execution completes.

## Agent Registration

```typescript
const { agent, apiKey } = await registerExternalAgent({
  name: 'Incident Classifier',
  description: 'Classifies incoming incidents by severity',
  ownerTenantId: 'tenant-abc',
  capabilities: ['classify', 'prioritize'],
  allowedScopes: ['read:incidents', 'write:labels'],
  endpointUrl: 'https://agent.example.com/v1/execute',
  publicKey: '...',  // optional: for payload signature verification
})
// apiKey is returned ONCE — store it securely. It is never retrievable again.
```

The `apiKey` is a 64-character hex string generated from `randomBytes(32)`. Only its SHA-256 hash (`api_key_hash`) is stored. The raw key is returned once at registration and never stored on the platform.

## Execution Flow

```
executeExternalAgent(agentId, {
  tenantId,
  requestPayload,
  apiKey?,          // optional per-request authentication
  requireApproval?, // force approval gate
})
```

1. Agent must have `status = 'active'`
2. If `apiKey` provided, hash is compared against stored `api_key_hash`
3. Payload is scoped to `allowedScopes` (unscoped fields are stripped)
4. Output is validated via `_validateAgentOutput()`
5. Execution record is inserted into `external_agent_executions` via `tenantQuery`
6. If `requireApproval = true` or payload signals high-impact, `approval_required = true` is returned

## Return Value

```typescript
{
  execution: ExternalAgentExecution,  // persisted record
  outputValidated: boolean,
  approvalRequired: boolean,
  approvalId: string | null,
}
```

## Scope Enforcement

The gateway enforces scope isolation via `_scopePayload()`. Only fields matching `allowedScopes` are passed to the agent's execution context. This prevents agents from accessing data outside their declared permission set.

## Agent Status Lifecycle

| Status | Description |
|---|---|
| `active` | Can execute requests |
| `suspended` | Temporarily disabled, can be re-activated |
| `revoked` | Permanently disabled, excluded from list queries |

`updateAgentStatus(agentId, status)` transitions between states.

## Security Properties

- API keys are never stored in plaintext — only SHA-256 hashes
- All outputs are validated before persistence
- Execution records are scoped to `tenantId` via `tenantQuery`
- Agents cannot cross tenant boundaries
- `listExternalAgents()` excludes `status = 'revoked'` agents

## Related Services

- `automationAdapterService` — adapters can trigger agent executions
- `workflowComposerService` — workflow steps can invoke external agents
- `pluginRegistryService` — agents and plugins share the scope permission model
