# Industry Expansion Program (Post-GA)

**Program:** Post-GA Operationalization  
**Domain:** Vertical Market Expansion  
**Service:** `industryExpansionFramework`  
**Component:** N/A (backend service only)  
**Owner:** Denver Engineering — Industry Solutions  

---

## Purpose

The Industry Expansion Program manages the lifecycle of industry-specific playbooks and vertical templates that enable the Ava/Denver platform to be deployed across regulated operational industries. It enforces certification gates, template deployability requirements, and readiness scoring before any industry vertical is considered production-ready.

---

## Supported Industries

| Industry                  | Description                                      |
|--------------------------|--------------------------------------------------|
| `water_wastewater`       | Water treatment and wastewater management        |
| `manufacturing`          | Industrial manufacturing operations              |
| `facilities`             | Facilities management and maintenance            |
| `utilities`              | Electric, gas, and water utilities               |
| `energy`                 | Energy production and distribution               |
| `industrial_operations`  | General industrial operational environments      |
| `infrastructure`         | Public and private infrastructure management     |

---

## Industry Playbook

An `IndustryPlaybook` is the top-level artifact for a vertical. Each playbook is scoped to a single industry and version, and tracks:

| Field                  | Description                                         |
|-----------------------|-----------------------------------------------------|
| `industry`            | Target industry vertical                            |
| `version`             | Semantic version string (e.g., `"1.0.0"`)          |
| `templateCount`       | Number of vertical templates registered             |
| `workflowCount`       | Number of operational workflows included            |
| `complianceFrameworks`| List of compliance frameworks (e.g., `["ISO-55001"]`)|
| `certificationStatus` | Lifecycle stage: `draft`, `review`, `certified`, `deprecated` |
| `deploymentCount`     | Number of tenant deployments using this playbook    |

Playbooks are registered in `draft` status and must advance through `review` before reaching `certified`.

---

## Playbook Readiness Score

The readiness score is a composite of four components, capped at 100:

```
certScore     = certified→40, review→25, draft→10, deprecated→0
contentScore  = min(30, templateCount × 3)
workflowScore = min(20, workflowCount × 2)
complianceScore = min(10, complianceFrameworks.length × 5)

playbookReadiness = min(100, certScore + contentScore + workflowScore + complianceScore)
```

| Component        | Max Points | Saturation Point                     |
|-----------------|------------|--------------------------------------|
| Certification    | 40         | `certified` status required for max  |
| Templates        | 30         | 10+ templates saturate               |
| Workflows        | 20         | 10+ workflows saturate               |
| Compliance       | 10         | 2+ frameworks saturate               |

A certified playbook with 10 templates, 10 workflows, and 2 compliance frameworks scores 100.

---

## Certification Lifecycle

```
draft ──→ review ──→ certified ──→ deprecated
```

- **`draft`**: Playbook registered but not yet validated
- **`review`**: Under governance review for certification
- **`certified`**: Fully validated; eligible for tenant deployment
- **`deprecated`**: No longer actively maintained or deployable

The `certifyPlaybook(playbookId)` function sets status to `certified` directly. Deprecation is a manual governance action.

---

## Vertical Templates

`VerticalTemplate` objects represent individual operational assets within a playbook:

| Field                | Description                                      |
|---------------------|--------------------------------------------------|
| `templateName`      | Human-readable name                              |
| `templateType`      | `'workflow' | 'checklist' | 'report' | 'alert_rule'` |
| `replayCompatible`  | Template produces deterministic replay output    |
| `governanceValidated`| Template has passed governance review           |
| `usageCount`        | Number of times deployed across tenants          |

### Template Deployability

A template is **deployable** only when BOTH conditions hold:

```
isDeployable = replayCompatible AND governanceValidated
```

A template that fails replay compatibility or governance validation is excluded from deployment pipelines regardless of its content quality. Both gates are non-negotiable.

---

## Council Approval Requirement

Some proposals interacting with the Industry Expansion Framework require Platform Evolution Council approval before deployment. An industry expansion action requires council approval when:

- `governanceRisk` is `'medium'` or `'high'`, OR
- `complexityImpact > 50`, OR
- `replaySurfaceImpact > 10`

---

## Operational Runbook

**Registering a new industry playbook:**
1. `registerPlaybook(industry, version, templateCount, workflowCount, complianceFrameworks)`
2. Playbook starts in `draft` status
3. Conduct governance review; advance to `review` status
4. `certifyPlaybook(playbookId)` — sets status to `certified`

**Adding templates to an industry:**
1. `registerTemplate(industry, templateName, templateType, replayCompatible, governanceValidated)`
2. Verify `isTemplateDeployable(template)` before scheduling deployment
3. `getTemplatesByIndustry(industry)` — ordered by usage count descending

**Assessing playbook readiness before tenant deployment:**
1. `getPlaybooksByIndustry(industry)` — retrieve all versions
2. `computePlaybookReadiness(playbook)` — score must be high enough for tenant tier
3. `isPlaybookCertified(playbook)` — required for production tenants
4. `getDeployableTemplates(templates)` — filter to deployable subset only

---

## Database Tables

| Table                       | Description                                       |
|----------------------------|---------------------------------------------------|
| `pga_industry_playbooks`   | Playbook records with certification status        |
| `pga_vertical_templates`   | Template records with deployability flags         |
