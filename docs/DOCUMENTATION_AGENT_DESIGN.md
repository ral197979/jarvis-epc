# Documentation Agent Design

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Purpose

The DocumentationAgent generates operational reports, summaries, and draft runbooks from live system data. It is the only agent with governance level `low` because it produces read-only output.

## Capabilities

| Capability ID | Task Types | Approval Required |
|---------------|-----------|-------------------|
| `doc.generate` | `generate_report`, `generate_summary`, `draft_runbook` | Never |

## Governance Level: Low

Never requires human approval because:
1. Output is read-only (no system mutations)
2. Documents are drafts pending human review before use
3. Worst-case outcome is an inaccurate document, not a broken system

## Output Schema

```typescript
{
  documentId: string   // e.g. 'doc-a1b2c3d4'
  wordCount: number
  status: 'generated'
}
```

## Memory Usage

After generation, DocumentationAgent stores the document ID and generation timestamp:

```typescript
storeMemory({
  memoryType: 'outcome',
  key: `last_doc_${taskType}`,
  value: { docId, generatedAt },
  confidence: 100,
})
```

This prevents redundant regeneration and provides provenance.

## Supported Scopes

- `project` — project-level reports
- `workflow` — workflow status summaries
- `global` — cross-project operational reports

## Integration

DocumentationAgent is the terminal step in the `validate_and_document` and `assess_readiness` objective plans, consuming outputs from validation and risk analysis agents.

## Handoff Pattern

Typical flow:
```
ValidationAgent → handoff → DocumentationAgent
  contextPackage: { validationResult, issues, score }
  reason: 'Generate compliance summary from validation results'
```
