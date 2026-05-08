# Industry Playbook Marketplace

## Overview

The Playbook Marketplace is a curated library of runbooks, SOPs, and workflow templates that tenants can discover, install, and rate. Playbooks are sandbox-validated before publication and become immutable once published to prevent drift.

## Lifecycle

```
Author creates playbook
  → createPlaybook() inserts with status='draft'
  → initial version created (version='1.0.0', is_immutable=FALSE)

Sandbox validation
  → runbook tested in isolated environment
  → sandbox_validated flag set to TRUE on playbook version

Publication
  → publishPlaybook(playbookId, sandboxValidated=true)
  → current version marked is_immutable=TRUE
  → playbook status set to 'published'
  → published_at timestamp recorded

Tenant installation
  → installPlaybook(tenantId, playbookId)
  → install record created in tenant_playbook_installs
  → install_count incremented on playbook
```

## Immutability Contract

Once a playbook version is published, its `is_immutable = TRUE` flag prevents any further edits to that version. Subsequent changes must create a new version with an incremented version string. This ensures:
- Installed tenants always run what they tested
- Audit trails remain consistent
- Version history is append-only

## Rating System

Tenants submit ratings (1–5) via `submitPlaybookReview()`. Ratings outside this range throw `'Rating must be between 1 and 5'`. The `avg_rating` and `rating_count` on the playbook row are updated atomically after each review.

## Discovery

`listPlaybooks()` supports filtering by:
- `playbookType` — `runbook` | `sop` | `template` | `checklist`
- `industryTag` — e.g., `saas`, `fintech`, `healthcare`
- Status always filtered to `published` for non-admin callers

## Tenant Management

| Function | Description |
|---|---|
| `installPlaybook(tenantId, playbookId)` | Install a published playbook |
| `uninstallPlaybook(tenantId, playbookId)` | Soft-delete (is_active=FALSE) |
| `getTenantInstalls(tenantId)` | List all active installs for a tenant |

## API Surface

| Function | Description |
|---|---|
| `createPlaybook(input)` | Draft a new playbook |
| `publishPlaybook(id, validated)` | Publish and freeze version |
| `listPlaybooks(opts)` | Discover playbooks with filters |
| `getPlaybook(id)` | Retrieve single playbook |
| `getPlaybookVersion(id, version)` | Retrieve specific version |
| `submitPlaybookReview(tenantId, id, rating, comment)` | Submit 1–5 rating |

## Related Services

- `workflowComposerService` — playbooks can be imported as workflow definitions
- `pluginRegistryService` — plugins can extend playbook steps
