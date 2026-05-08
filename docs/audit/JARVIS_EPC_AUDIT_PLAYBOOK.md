# Denver_Engineering Audit Execution Playbook for Claude

Use this as the operating structure for auditing **Denver_Engineering**. This is not a generic SaaS audit. It is an **EPC / commissioning / completions / turnover / engineering workflow audit** designed to determine whether Denver_Engineering is actually credible for project delivery.

The goal is to produce an **owner-useful, evidence-backed, execution-grade audit** that identifies what is production-ready, what is risky, what is missing, what is fake or stubbed, and what must be fixed before real project use.

---

# 1) Mission

You are auditing **Denver_Engineering**, an EPC / commissioning / completions platform that may include modules such as:
- project setup
- systems / subsystems / tags / equipment register
- engineering document ingestion
- drawing / spec / submittal parsing
- commissioning matrix generation
- pre-commissioning workflows
- pre-functional / functional test packs
- inspection and punch workflows
- turnover packages / dossiers
- redlines / attachments / evidence capture
- field execution status tracking
- dashboard / progress reporting
- AI assistant and document reasoning workflows
- role-based multi-user delivery across engineering, QA/QC, commissioning, construction, and owner handover

Your output must help the owner decide:
1. whether Denver_Engineering is safe to demo,
2. whether it is safe to pilot on a real project,
3. whether it is safe for field teams,
4. whether the data model supports real completions and turnover,
5. what the top blockers are,
6. what the fastest path to deployment is.

You are not allowed to hide uncertainty. Distinguish between:
- **verified facts**
- **high-confidence inferences**
- **assumptions requiring confirmation**

---

# 2) Audit Principles

## 2.1 Owner-first standard
Audit from the product owner’s perspective, not as a style-only code review.

That means:
- A missing enterprise feature is **not** a defect unless the app claims it.
- A broken turnover or test-pack workflow is critical even if the UI is polished.
- A slick dashboard with weak document traceability is not production-ready.
- A large feature set with no field reliability is not a pass.

## 2.2 Evidence over opinion
Every major claim must cite evidence from one or more of:
- source files
- parsers / rules / generators
- config files
- package manifests
- Docker / compose / deployment files
- APIs
- schemas / migrations
- tests
- logs
- screenshots
- build results
- lint results
- runtime validation
- sample generated outputs

## 2.3 No false completion
Do not say “fixed” unless verified.
Use these labels precisely:
- **Observed**
- **Reproduced**
- **Verified fixed**
- **Likely**
- **Unknown**

## 2.4 Business and project impact matters
For each important issue, explain why it matters in EPC terms:
- wrong scope generation
- wrong test coverage
- incomplete handover
- incorrect status reporting
- QA/QC evidence gaps
- schedule risk
- owner rejection risk
- field rework risk
- commissioning delay risk
- dispute / claims exposure
- reputational risk

---

# 3) Required Final Deliverables

## 3.1 Executive summary
Cover:
- overall verdict
- readiness level
- strongest areas
- weakest areas
- top 5 blockers
- recommended next phase

## 3.2 Scorecard
Score 0–10 with one-sentence justification:
- product architecture
- frontend UX
- backend/API quality
- data model quality
- auth and authorization
- tenant / project isolation
- security hardening
- document-control integrity
- engineering data traceability
- commissioning workflow completeness
- test-pack generation quality
- turnover / dossier readiness
- reliability / operational maturity
- observability / logging
- performance / scalability
- testing depth
- deployment readiness
- mobile / offline field readiness
- AI safety and usefulness
- maintainability / code health
- documentation / handover readiness

Then provide:
- **overall weighted score**
- **Go / Conditional Go / No-Go**

## 3.3 Findings register
Include:
- ID
- severity
- title
- affected area
- evidence
- impact
- recommended fix
- estimated effort (S / M / L)
- owner priority (Now / Next / Later)

## 3.4 Phase-based remediation plan
Group into:
- Phase 0: truth-finding and verification
- Phase 1: project-delivery blockers
- Phase 2: pilot hardening
- Phase 3: enterprise scale and polish

## 3.5 Proof appendix
Include:
- commands run
- build/lint/test results
- logs observed
- files inspected
- runtime checks
- generated sample outputs reviewed
- assumptions not verified

---

# 4) Required Audit Workflow

## Phase A — repo and environment truth
Establish what Denver_Engineering actually is and how it runs.

### A.1 Inventory the repo
Identify:
- frontend apps
- backend services
- shared packages
- parsers
- template/rules engines
- document ingestion components
- workflow/status engines
- test-pack generators
- turnover/dossier modules
- Docker / compose / infra
- env examples
- scripts
- tests
- mobile/PWA artifacts

### A.2 Establish runtime shape
Answer with evidence:
- ports
- required services
- database
- object storage
- queue/workers
- OCR or document-processing services
- search/indexing services
- reverse proxy
- monolith vs modular monolith vs multi-service

### A.3 Version and dependency truth
Check:
- package manager(s)
- Node/Python/runtime versions
- engines field
- lockfiles
- parser/OCR/document dependencies
- deprecated or risky packages
- docs vs actual runtime mismatches

### A.4 Configuration truth
Inspect:
- `.env.example`
- config loaders
- startup validation
- dev fallbacks
- hardcoded secrets
- default admin/bootstrap users
- document storage assumptions
- local path assumptions
- CORS / proxy trust

### A.5 Build and startup truth
Verify:
- install
- build
- backend boot
- frontend boot
- health endpoint
- obvious runtime errors
- document pipeline init if applicable

Output required:
- concise architecture snapshot
- exact run path
- setup blockers
- config risk summary

---

## Phase B — product and project workflow audit
Determine whether Denver_Engineering supports real EPC / commissioning workflows.

### B.1 Core personas
Identify likely roles:
- admin
- project manager
- engineering manager
- discipline engineer
- QA/QC inspector
- commissioning manager
- commissioning engineer
- field technician
- document controller
- client/owner representative
- read-only executive

Confirm role separation exists and is enforced.

### B.2 Core workflows to inspect
Audit where applicable:
1. sign in / sign out / session persistence
2. project creation
3. system / subsystem setup
4. tag / equipment register creation
5. document upload / ingestion
6. drawing/spec parsing
7. classification / system mapping
8. commissioning matrix generation
9. test-pack generation
10. field execution / checklist completion
11. attachment / evidence capture
12. issue / punch / deficiency tracking
13. status transitions
14. dashboard / progress rollups
15. turnover package generation
16. dossier completeness
17. search / filtering / traceability
18. AI assistant action boundaries
19. mobile/responsive field usability
20. offline behavior if claimed

For each workflow classify:
- Present and works
- Present but fragile
- Partial / stubbed
- Missing
- Misleadingly represented in UI

### B.3 Domain authenticity
Audit whether Denver_Engineering behaves like a real EPC/completions platform rather than generic task software.

Look for evidence of:
- project > area > system > subsystem > tag hierarchy
- discipline segregation
- status model that matches completions reality
- test forms tied to systems/equipment
- evidence capture and traceability
- turnover package logic
- dossier completeness logic
- document revision awareness
- engineering-to-commissioning continuity
- field usability

Output required:
- workflow matrix
- persona fit summary
- domain authenticity verdict

---

## Phase C — frontend UX and field usability audit
Determine whether the UI works for office and field teams.

### C.1 Information architecture
Evaluate:
- project navigation clarity
- grouping of modules
- consistency of EPC/commissioning terms
- discoverability by role
- document-heavy workflow usability

### C.2 Critical screens
Review:
- project dashboard
- systems/subsystems/tag register
- document viewer or ingestion screen
- matrix/test-pack builder
- checklist execution screen
- punch/issues screen
- turnover package view
- AI assistant surfaces
- mobile field screens

### C.3 UX quality checks
Check:
- loading/error/empty states
- validation
- destructive action confirmation
- status clarity
- evidence upload UX
- attachment preview
- responsive behavior
- readability in dense engineering data screens
- technician usability in the field

### C.4 Trust signals
Look for:
- fake progress metrics
- buttons that do nothing
- status changes without persistence
- sample outputs pretending to be generated
- misleading document or revision counts
- dashboard numbers that do not reconcile

Output required:
- strongest UX decisions
- weakest UX decisions
- top usability blockers

---

## Phase D — backend, data, and API audit
Determine whether backend structure supports project-delivery truth.

### D.1 API surface map
Identify:
- auth middleware
- route groups
- validation
- controllers/services split
- health/version endpoints
- file/document APIs
- generation endpoints

### D.2 Data model integrity
Inspect whether the data model supports:
- users
- organizations/tenants
- projects
- facilities/areas/systems/subsystems
- tags/equipment
- documents and revisions
- templates
- matrix rows
- test packs
- checklists/results
- punch/issues
- turnover packages
- dossiers
- audit logs
- AI interactions

Check for:
- poor normalization
- status sprawl
- missing traceability
- revision ambiguity
- tenant/project leakage
- missing audit trail
- incomplete relational integrity

### D.3 Validation and failure handling
Confirm:
- payload validation
- safe failure on invalid data
- structured errors
- safe generator failures
- queue/retry behavior
- predictable API contracts

### D.4 Frontend/backend truth alignment
Compare UI claims with backend capability:
- pages with no real API
- APIs with no surfaced use
- hardcoded metrics
- “generate” actions that are mock only
- outputs not persisted or not versioned

Output required:
- API health summary
- data model verdict
- alignment verdict

---

## Phase E — security, project isolation, and document-safety audit
Identify exploitable or deployment-blocking risks.

### E.1 Authentication
Check for:
- dev secrets
- hardcoded JWT/session secrets
- default credentials
- insecure storage patterns
- token expiry/refresh gaps

### E.2 Authorization
Verify:
- role boundaries
- project-level access control
- tenant isolation
- object-level permissions
- document visibility restrictions

### E.3 Input/output safety
Inspect:
- XSS risks
- file upload safety
- unsafe document rendering
- path traversal
- SSRF
- command execution risk
- prompt-injection exposure in document AI flows
- unsafe HTML insertion

### E.4 Infra and deployment security
Check:
- exposed services/ports
- document storage exposure
- admin tooling exposure
- TLS/proxy assumptions
- CORS
- secret handling
- debug endpoints
- default bootstrap behavior

### E.5 Audit/log safety
Check:
- sensitive logging
- token leaks
- user action auditability
- document access traceability
- generation traceability

Output required:
- top security risks
- exploitability assessment
- deployment blockers

---

## Phase F — reliability, observability, performance
Determine whether Denver_Engineering can survive real project usage.

### F.1 Runtime reliability
Check:
- healthchecks
- startup order
- migrations
- storage availability handling
- queue durability
- graceful shutdown
- retries
- job failure reporting

### F.2 Observability
Inspect:
- structured logs
- request IDs
- job IDs
- error reporting
- metrics
- tracing
- version visibility
- diagnostics

### F.3 Performance and scale posture
Assess:
- large document handling
- parsing latency
- generation latency
- unbounded queries
- pagination
- dashboard aggregation cost
- attachment rendering bottlenecks
- large project dataset behavior

### F.4 Offline / poor connectivity resilience
For field flows inspect:
- local persistence
- retry/sync behavior
- duplicate submission protection
- stale data signaling
- attachment retry logic
- conflict handling

Output required:
- runtime maturity verdict
- biggest reliability gaps
- scale-readiness summary

---

## Phase G — testing and deployment readiness
Determine whether the app can be changed safely and shipped repeatedly.

### G.1 Testing truth
Inventory:
- unit tests
- integration tests
- end-to-end tests
- parser/generator tests
- sample fixture coverage
- API contract tests
- workflow smoke tests

Reward critical workflow coverage, not raw count.

### G.2 CI/CD truth
Inspect:
- lint
- tests
- builds
- image builds
- security scans
- secret scans
- deployment workflows

Classify failures as:
- pre-existing
- introduced by recent changes
- infra/config only
- actual product risk

### G.3 Documentation and handover readiness
Check for:
- README accuracy
- setup docs
- deployment docs
- env docs
- sample data docs
- admin/bootstrap docs
- release notes
- operator docs
- data migration/backup notes

Output required:
- shipping confidence verdict
- CI trustworthiness verdict
- documentation readiness verdict

---

# 5) Severity Model

## Critical
Immediate deployment blocker or serious security / data / project-integrity risk.
Examples:
- forged auth
- tenant/project leakage
- wrong turnover data generation
- non-traceable test results
- document revision confusion causing wrong execution basis
- app cannot boot reliably

## High
Major business or project-delivery risk.
Examples:
- broken matrix generation
- broken test-pack linkage
- unreliable status rollups
- weak authorization boundaries
- checklist evidence not preserved

## Medium
Trust, usability, or maintainability weakness.
Examples:
- poor validation
- inconsistent terminology
- fragile mobile layout
- partial traceability
- stale dashboards

## Low
Minor issue or polish item.
Examples:
- naming inconsistency
- weak empty states
- cosmetic defects
- noncritical lint clutter

---

# 6) Required Output Format

Claude must present the audit in this structure:

1. **Executive Summary**
2. **Architecture Snapshot**
3. **Scorecard**
4. **Top 5 Blockers**
5. **Workflow Audit Matrix**
6. **Detailed Findings Register**
7. **Security Review**
8. **Reliability / Ops Review**
9. **Deployment Readiness Verdict**
10. **Remediation Roadmap by Phase**
11. **Proof Appendix**

---

# 7) Required Commands and Verification Behavior

Claude should adapt commands to the repo, but must verify through actual actions where possible:
- inspect root tree
- inspect package manifests
- inspect Docker/compose files
- inspect env examples
- inspect schemas/migrations
- inspect parsers/generators
- run install
- run lint
- run tests
- run build
- boot backend
- boot frontend
- hit health endpoint
- inspect logs
- generate sample outputs where safe
- compare UI claims against stored backend artifacts

If blocked, say exactly what was blocked and how it limits confidence.

---

# 8) Anti-patterns Claude Must Avoid

Do not:
- give generic advice detached from Denver_Engineering
- confuse missing enterprise features with broken core workflow
- over-praise UI polish if generators are fake
- treat passing lint as production readiness
- mark issues fixed without verification
- ignore document-control and turnover integrity
- assume EPC realism without checking hierarchy, status, traceability, and evidence flows

---

# 9) Owner-specific Focus Areas for Denver_Engineering

Pay extra attention to whether Denver_Engineering supports real EPC/completions delivery.

Specifically inspect for:
- project/system/subsystem/tag hierarchy
- commissioning matrix realism
- test-pack generation tied to actual systems/equipment
- evidence capture and traceability
- revision-aware document handling
- turnover package/dossier logic
- field execution usability
- dashboard truthfulness
- AI assistant boundaries and prompt-injection resistance
- multi-project / multi-tenant isolation

---

# 10) Final Verdict Rules

Claude must end with one of these:

## GO
Only if core workflows, auth boundaries, project traceability, and runtime reliability are strong enough for real use.

## CONDITIONAL GO
Use if Denver_Engineering is demoable or pilotable but has bounded issues that must be fixed before wider deployment.

## NO-GO
Use if security, project integrity, core workflow truth, or runtime reliability are too weak for responsible use.

The verdict must include:
- why
- what must happen next
- what not to do yet

---

# 11) Copy-Paste Prompt for Claude

```text
Audit Denver_Engineering using the attached Denver_Engineering Audit Execution Playbook.

Rules:
- Execute the audit in the prescribed phase order.
- Be owner-first, evidence-backed, and explicit about uncertainty.
- Do not give generic advice detached from the repo.
- Verify as much as possible through code inspection, commands, runtime checks, logs, and workflow validation.
- Distinguish observed vs reproduced vs likely vs unknown.
- Produce the required deliverables exactly:
  1) Executive Summary
  2) Architecture Snapshot
  3) Scorecard
  4) Top 5 Blockers
  5) Workflow Audit Matrix
  6) Detailed Findings Register
  7) Security Review
  8) Reliability / Ops Review
  9) Deployment Readiness Verdict
  10) Remediation Roadmap by Phase
  11) Proof Appendix

Severity model:
- Critical / High / Medium / Low

Final verdict must be one of:
- GO
- CONDITIONAL GO
- NO-GO

Extra emphasis for Denver_Engineering:
- EPC hierarchy realism
- commissioning matrix integrity
- test-pack generation truth
- turnover/dossier completeness
- document revision traceability
- field execution usability
- AI assistant safety
- project/tenant isolation

Do not mark anything fixed unless verified.
Do not hide setup blockers.
Do not confuse polished UI with project-delivery readiness.
```
