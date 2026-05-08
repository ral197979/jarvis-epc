# Visual Orchestration Designer

## Overview

The Visual Orchestration Designer is the frontend interface for building workflows without writing code. It provides a drag-and-drop canvas where steps are composed into sequences, connected with conditional branches, and submitted for policy validation and dry-run simulation before publishing.

## Key Components

### `WorkflowPublishReview`

Located at `src/components/ecosystem/WorkflowPublishReview.tsx`.

The pre-publish checklist component that gates workflow publication behind three required checks:

1. **Policy Validation** — `policyValidated` flag on the workflow
2. **Dry-Run Simulation** — `dryRunPassed` flag on the workflow
3. **Not Already Published** — `status !== 'published'`

The "Publish Workflow" button is disabled (`disabled={!allPassed}`) until all three checks pass. A confirmation dialog appears before the final publish API call to prevent accidental publishes.

```tsx
<WorkflowPublishReview
  workflowId="wf-abc"
  tenantId="tenant-xyz"
  onPublished={() => router.push('/workflows')}
/>
```

### `SimulationPreviewPanel`

Located at `src/components/ecosystem/SimulationPreviewPanel.tsx`.

The dry-run interface where users provide a test context (JSON) and run a simulation to see which steps would execute, which would be skipped, and how many approval gates would be triggered.

```tsx
<SimulationPreviewPanel
  workflowId="wf-abc"
  tenantId="tenant-xyz"
/>
```

The panel renders three summary cards (steps simulated, approval gates triggered, PASS/FAIL) and expandable lists of steps that would execute vs. steps that would be skipped.

## Workflow Step Types

| Type | Description | Approval Gate |
|---|---|---|
| `notify` | Send notification | No |
| `send_email` | Send email (warns in policy check) | Warning |
| `webhook` | Call external URL | Warning |
| `update_ticket` | Modify a ticket field | No |
| `sql` | Execute a SQL query | Validated for forbidden patterns |
| `code` | Execute arbitrary code | Validated (blocks `eval(`, `exec(`) |
| `delete_record` | Delete a record | Warning + approval gate |

## Test Context Format

The simulation test context is a JSON object passed to the dry-run API:

```json
{
  "condition_a": true,
  "priority": "high",
  "ticket_type": "incident"
}
```

Step conditions are evaluated against this context to determine which branches execute.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/v1/ecosystem/workflows/:id` | GET | Load workflow for display |
| `POST /api/v1/ecosystem/workflows/:id/validate` | POST | Run policy validation |
| `POST /api/v1/ecosystem/workflows/:id/test` | POST | Run dry-run simulation |
| `POST /api/v1/ecosystem/workflows/:id/publish` | POST | Publish workflow |

## Related Services

- `workflowComposerService` — backend business logic for all operations
- `playbookMarketplaceService` — published playbooks can be loaded as starting templates
