# Workflow Composition Builder

## Overview

The Workflow Composer Service enables teams to build, validate, and publish multi-step automation workflows through a policy-checked composition system. Workflows are defined as ordered step arrays, validated for dangerous patterns, dry-run simulated before publish, and version-snapshotted on each release.

## Workflow Structure

A workflow definition is a JSON object:

```json
{
  "steps": [
    { "id": "s1", "type": "notify", "name": "Alert On-Call", "target": "pagerduty" },
    { "id": "s2", "type": "send_email", "name": "Notify Manager" },
    { "id": "s3", "type": "update_ticket", "name": "Set Priority", "field": "priority", "value": "critical" }
  ]
}
```

## Publish Gates

A workflow must pass two gates before it can be published:

1. **Policy validation** (`policy_validated = TRUE`) — `validateWorkflowPolicy()` checks for:
   - Forbidden SQL patterns: `DROP TABLE`, `DELETE FROM`, `TRUNCATE`
   - Dangerous code patterns: `eval(`, `exec(`, `process.exit`
   - Generates warnings for high-impact step types: `send_email`, `webhook`, `delete_record`

2. **Dry-run simulation** (`dry_run_passed = TRUE`) — the workflow is executed against test data without side effects to confirm all conditional branches behave as expected

If either gate is not passed, `publishWorkflow()` throws:
- `'policy'` error if `policy_validated = FALSE`
- `'dry'` error if `dry_run_passed = FALSE`

## Workflow Lifecycle

```
createWorkflow()         → status='draft'
validateWorkflowPolicy() → policy_validated=TRUE (or violations list)
[dry-run simulation]     → dry_run_passed=TRUE
publishWorkflow()        → version snapshot created, status='published'
pauseWorkflow()          → status='paused'
rollbackWorkflow()       → restores prior version, resets gates to FALSE
```

## Version Snapshots

On publish, the current definition is saved to `workflow_versions`:

```typescript
// version N definition is immutable after publish
// rollback restores version N-1 and resets policy_validated=FALSE, dry_run_passed=FALSE
```

Rollback requires re-validation and re-dry-run before the restored version can be published again.

## Mutability Rule

Published workflows are immutable — `updateWorkflowDefinition()` throws `'Published workflows are immutable'` when called on a published workflow. To modify a published workflow, create a new draft or rollback to a prior version.

## API Surface

| Function | Description |
|---|---|
| `createWorkflow(tenantId, input)` | Create a draft workflow |
| `getWorkflow(tenantId, workflowId)` | Retrieve workflow |
| `updateWorkflowDefinition(tenantId, id, def)` | Update draft definition |
| `validateWorkflowPolicy(tenantId, id)` | Run policy checks |
| `publishWorkflow(tenantId, id, publishedBy)` | Publish after both gates pass |
| `pauseWorkflow(tenantId, id)` | Pause active workflow |
| `rollbackWorkflow(tenantId, id, version)` | Restore prior version |
| `getWorkflowVersions(tenantId, id)` | List version history DESC |
| `getWorkflowRuns(tenantId, id, dryRunOnly)` | List execution records |

## Related Services

- `playbookMarketplaceService` — playbooks can be imported as workflow definitions
- `externalAgentGateway` — workflow steps can invoke external agents
- `automationAdapterService` — adapter events can trigger workflow runs
