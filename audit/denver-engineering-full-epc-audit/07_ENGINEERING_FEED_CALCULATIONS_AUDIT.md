# 07 — Engineering, FEED & Calculations Audit

## Modules Covered
- FEED (Front-End Engineering Design) Module
- Engineering Calculations (CalcView)
- Fix Library (Pattern-based engineering fixes)
- Hub (Engineering collaboration)
- Process Design
- Knowledge Base (engineering documents)

---

## FEED Module

**Frontend:** `src/components/FeedView.tsx` ✅  
**Domain:** `engineering` in navigation  
**Backend:** No dedicated FEED route identified — may use generic project/document routes

### Assessment
The FEED view appears to be a data-driven engineering feed/activity stream rather than a full FEED engineering study tool (Process Flow Diagrams, P&IDs, equipment lists, etc.).

**Gaps:**
- No confirmed PFD/P&ID generation capability
- No equipment sizing calculations
- No process simulation integration (HYSYS, Aspen, etc.)
- No equipment datasheets module
- No instrument index
- **Assessment: This is an engineering activity feed, not a true FEED module.** For an EPC platform competing with industry tools, a FEED module should include process engineering calculations, equipment specifications, and process flow documentation. **P1 — Feature gap vs. EPC claim.**

---

## Engineering Calculations (CalcView)

**Frontend:** `src/components/CalcView.tsx` ✅ (modified in current branch)  
**Backend:** `api/routes/calculations.ts`, `api/services/epcCore.ts` ✅  
**Migration:** `005_calc_sessions.sql` ✅  
**Test:** `api/__tests__/epcCore.test.ts` ✅

### Calculation Types Found
`api/services/epcCore.ts` — EPC core calculation engine. Contains:
- Structural calculations (likely beam/column sizing)
- Hydraulic calculations (likely pipe sizing)
- Electrical calculations (likely cable sizing)
- Thermal calculations

**Cannot fully assess without reading epcCore.ts content** — but the file exists and has test coverage.

### CalcView Assessment
- Calculation session management (`calc_sessions` table) ✅
- Session persistence across users ✅
- Currently modified (`M src/components/CalcView.tsx` in git status) — active development

**Gaps:**
- No confirmed calculation audit trail (who ran which calc, with what inputs)
- No peer review workflow for calculations
- No PDF export of calculation reports
- No unit system switching (SI vs. Imperial)

---

## Fix Library

**Frontend:** `src/components/FixLibraryView.tsx` ✅  
**Backend:** `api/routes/fixLibrary.ts`, `api/services/fixLibrary.ts`, `api/services/fixExtractor.ts` ✅  
**Test:** `api/__tests__/fixLibrary.test.ts`, `api/__tests__/fixExtractor.test.ts` ✅

### Assessment
Pattern-based fix library for engineering issues. The `fixExtractor` extracts patterns from resolved issues, and `fixLibrary` stores them for future reference. Connected to the AI knowledge base.

**Strengths:**
- Test coverage for both fixLibrary and fixExtractor ✅
- Background worker (`registerFixExtractorHandler`) runs pattern extraction ✅

**Gaps:**
- Fix pattern quality scoring not confirmed
- No approval workflow for publishing extracted fixes to library
- No fix pattern categorization schema documented

---

## Engineering Hub

**Frontend:** `src/components/HubView.tsx` ✅  
**Domain:** `engineering`

**Assessment:** Engineering collaboration hub. Exact capabilities not confirmed without component inspection. Likely aggregates drawings, documents, calculations, and team activity.

---

## Process Design

**Frontend:** `src/components/ProcessDesignView.tsx` ✅ (new file in current working tree)  
**Static asset:** `public/tools/denver/ProcessDesignPro-v1.0.html` (new file in current working tree)  
**Nav ID:** `processdesign` ✅ (in both navigation.ts and ContentRouter TAB_MAP)

**Assessment:** A new Process Design module is being developed (untracked files). The static HTML tool suggests it may be an embedded HTML-based process design tool rather than a full React implementation.

**Risk P2:** Serving an HTML tool from `public/tools/` without sanitization or auth gating could expose it as a standalone URL (`/tools/denver/ProcessDesignPro-v1.0.html`) without authentication.

---

## Knowledge Base

**Frontend:** `src/components/KnowledgeView.tsx` ✅  
**Backend:** `api/routes/knowledge.ts`, `api/services/knowledgeIngest.ts`, `api/services/knowledgeBulkIngest.ts`, `api/services/knowledgeSearch.ts`, `api/services/knowledgeEmbed.ts`, `api/services/knowledgeTier.ts` ✅  
**Migration:** `022_knowledge_base.sql`, `025_vector_embeddings.sql` ✅  
**Tests:** `api/__tests__/knowledgeIngest.test.ts`, `api/__tests__/knowledgeBulkIngest.test.ts`, `api/__tests__/knowledgeSearch.test.ts`, `api/__tests__/knowledgeTier.test.ts` ✅

**Strengths:**
- Multi-tier knowledge (tier 1 = internal, tier 2 = vendor, tier 3 = public standards)
- Vector embeddings for semantic search
- Bulk ingest from directory (`scripts/ingest-directory.ts`)
- Tenant-scoped retrieval ✅

**Embed Provider:**
- `EMBED_PROVIDER` env var — likely OpenAI `text-embedding-ada-002` or Together.ai
- Both `OPENAI_API_KEY` and `TOGETHER_AI_API_KEY` in `.env` ✅

**Gaps:**
- pgvector extension availability on Render not confirmed
- Document type support: PDF (confirmed via `pdf-parse`), no Office doc support (DOCX, XLSX)
- No knowledge article expiry/staleness detection
- No citation confidence threshold — all retrieved chunks surfaced regardless of similarity score

---

## EPC Core Tests

`api/__tests__/epcCore.test.ts` — covers core EPC calculations  
**Status:** Tests pass ✅ (not in failure list)

---

## Risk Summary

| Module | Finding | Severity |
|---|---|---|
| FEED | Not a real FEED engineering module — activity feed only | P1 |
| Process Design | Public HTML tool at /public/tools/ may be auth-bypassed | P2 |
| Calculations | No calculation audit trail | P2 |
| Calculations | No PDF export of calculation reports | P2 |
| Knowledge Base | pgvector availability unconfirmed | P2 |
| Knowledge Base | No citation confidence threshold | P2 |
| Fix Library | No approval workflow for publishing fixes | P2 |
| FEED | No process engineering tools (PFD, P&ID, datasheets) | P1 |
