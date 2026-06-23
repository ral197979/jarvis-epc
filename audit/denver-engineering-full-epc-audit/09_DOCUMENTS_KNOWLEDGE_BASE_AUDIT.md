# 09 — Documents & Knowledge Base Audit

## Modules Covered
- Document Management
- Knowledge Base (vector-embedded)
- File Storage
- Transmittals
- Audit Log Documents

---

## Document Management

**Frontend:** `src/components/DocumentsView.tsx`, `src/components/DocumentsSubView.tsx` ✅  
**Backend:** `api/routes/files.ts` ✅  
**Migration:** `003_files.sql` ✅

### File Model
`003_files.sql` creates the file storage structure:
- File metadata in DB (tenant-scoped)
- Actual bytes in storage backend (local or S3)
- Presigned URL pattern for client-side access

**Strengths:**
- Pluggable storage backend (local/S3) ✅
- File metadata in PostgreSQL ✅
- Time-limited presigned download URLs ✅

**Gaps:**
- No MIME type allowlist enforcement (**P1** — from security audit)
- No virus scanning on uploaded files (**P2**)
- No file versioning (version history for documents)
- No document category/tag taxonomy
- No document expiry or review date tracking
- DOCX/XLSX parsing not supported (only PDF via `pdf-parse`)

---

## Knowledge Base (Vector RAG)

**Frontend:** `src/components/KnowledgeView.tsx` ✅  
**Backend:** Multiple services (see 07_ENGINEERING audit)

### Ingest Pipeline
```
knowledgeIngest.ts   → single document ingest
knowledgeBulkIngest  → directory batch ingest
knowledgeEmbed.ts    → embedding generation
knowledgeTier.ts     → tier 1/2/3 classification
```

**Ingest Flow:**
1. Document uploaded or ingested from directory
2. Text extracted (PDF via `pdf-parse`, plain text directly)
3. Chunked (chunk size from `EMBED_MAX_INPUT_CHARS` env)
4. Embedded via `EMBED_PROVIDER` (OpenAI or Together.ai)
5. Stored in `knowledge_embeddings` table with `tenant_id`
6. Indexed for vector search

**Migration 025 (vector_embeddings):**
```sql
-- Creates knowledge_embeddings table
-- Vector storage: likely TEXT or VECTOR type depending on pgvector availability
```

**Critical Question:** Is `pgvector` extension enabled on the Render PostgreSQL instance? Without it, `VECTOR` column type fails. The migration runner would error on migration 025.

### Knowledge Tiers
- **Tier 1:** Tenant-specific (internal knowledge, project docs)
- **Tier 2:** Vendor/supplier documents
- **Tier 3:** Public standards (ASME, NFPA, ISO, etc.)

Tier 3 is shared across tenants (not tenant-scoped). This is correct — public standards don't need tenant isolation.

**Risk:** If Tier 2 (vendor docs) are shared across tenants without proper scoping, vendor-confidential information could leak (**P2** — need to verify tier scoping rules).

### Search Quality
- Semantic search via vector embeddings ✅
- `top_k` configurable ✅
- No minimum similarity threshold confirmed — low-relevance chunks returned
- No keyword + semantic hybrid search (pure vector only)
- No re-ranking step

---

## Transmittals

**Backend:** `api/routes/transmittals.ts` ✅  
**Migration:** `051_geo_links_montecarlo_transmittals.sql` ✅  
**RLS:** `069_rls_transmittal_counters.sql` — transmittal counters ✅  

**Assessment:** Transmittal module tracks document distribution to contractors/engineers. Auto-numbering via `transmittal_counters` table with RLS.

**Frontend:** No dedicated `TransmittalsView` found in `ContentRouter.tsx` TAB_MAP or navigation.ts.  
**Risk P1:** Transmittals backend exists but there is no frontend view wired up. Users cannot access transmittals through the UI.

---

## DocsView vs Knowledge vs Files

Three overlapping document surfaces:
1. `DocumentsView` — file management / DMS
2. `KnowledgeView` — semantic search over ingested docs
3. `DocsView` — appears to be same as DocumentsView or a subset

This triplication may confuse users. Clear UX separation needed.

---

## File Storage Security Review

**File:** `api/files/storage.ts`

### Local Backend
```typescript
// Local storage writes to STORAGE_LOCAL_DIR
// Uses crypto.randomBytes for filename generation (prevents guessing)
```
- Random storage keys prevent enumeration ✅
- Path traversal: filename generated server-side (not user-provided) ✅

### S3 Backend
- Presigned URLs for upload/download ✅
- Configurable TTL ✅
- No bucket policy confirmation

**Risk P1:** Upload endpoint must validate that the uploaded content matches the declared MIME type. Currently no magic-byte verification. A user could upload a PHP/Python script declaring `application/pdf`.

---

## OCR / PDF Processing Security

`pdf-parse ^1.1.1` used for PDF text extraction:
- Known vulnerability: `pdf-parse` has had CVEs related to malformed PDFs causing crashes (DoS)
- **Risk P2:** Malformed PDF could crash the knowledge ingest worker

---

## Risk Summary

| Module | Finding | Severity |
|---|---|---|
| Transmittals | No frontend view wired — backend only | P1 |
| Files | No MIME type / magic byte validation on upload | P1 |
| Knowledge | pgvector extension availability unconfirmed | P2 |
| Knowledge | No minimum similarity threshold — irrelevant chunks returned | P2 |
| Knowledge | Tier 2 cross-tenant scoping not confirmed | P2 |
| Documents | No file versioning | P2 |
| Documents | No DOCX/XLSX parsing support | P2 |
| OCR/PDF | pdf-parse DoS via malformed PDF | P2 |
| Knowledge | No hybrid keyword + semantic search | P3 |
| Documents | No document review/expiry dates | P3 |
