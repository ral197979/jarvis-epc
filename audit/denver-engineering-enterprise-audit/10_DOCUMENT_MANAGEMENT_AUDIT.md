# 10 — DOCUMENT MANAGEMENT AUDIT

---

## Overview

Document management covers: file uploads/storage, versioning, folder structure, transmittals, approvals, drawings, and knowledge ingestion for AI.

---

## File Storage Architecture

**Implementation:** `api/routes/files.ts` (454 lines, verified)

### Upload Flow (Verified from Source)

```
1. POST /api/v1/files/request-upload
   → Creates document + version record in DB
   → Returns presigned S3 URL (production) or local token (dev)
   → Upload token stored in upload_tokens table

2. PUT /api/v1/files/upload/:token  (local dev only)
   OR direct S3 upload (production)

3. POST /api/v1/files/confirm/:versionId
   → Marks version as confirmed
   → Triggers knowledge ingestion if document qualifies
```

### Storage Backends

```typescript
// api/files/storage.ts
// STORAGE_BACKEND env var selects backend:
// - 's3': AWS S3 via presigned URLs
// - 'local': Node.js filesystem (uploads/ directory)
```

**Assessment:** Dual-backend design is correct for dev/prod parity. S3 presigned URLs mean the API server never handles binary data in production — files go direct to S3. ✅

---

## File Type & Size Controls

**MIME allowlist (verified):**
- Documents: PDF, Word, Excel, PowerPoint, CSV, TXT
- Images: JPEG, PNG, WebP, GIF, SVG
- BIM/CAD: IFC, GLB, GLTF, DWG (via octet-stream), NWD
- Schedule: XML (P6 export format)
- Archives: ZIP

**Size limits:**
- Global default: `MAX_FILE_SIZE_MB` env var (default: 50MB, set to 100MB in render.yaml)
- IFC files: hard cap at **100MB** regardless of global limit
- Enforced server-side before storage

**Grade: A-**

---

## Version Control

**Implementation:** `document_versions` table (migration 003)

```
document → document_versions (1:many)
Each version has: version_number, storage_key, file_size, mime_type, created_by
Version increment: confirmed on POST /files/confirm/:versionId
```

**Features confirmed:**
- Version history preserved — no destructive overwrites
- `GET /api/v1/files/documents/:id` returns document + all versions
- Presigned download per version (not just latest)
- Soft-delete on documents (status flag, not DELETE)

**Missing:**
- No version comparison or diff for text documents
- No checkout/lock mechanism (concurrent edits not prevented)
- No approval state per version (version is live on confirmation)

**Grade: B+**

---

## Folder Structure

**Implementation:** `document_folders` table + `GET/POST /api/v1/files/folders`

**Features:**
- Hierarchical folder tree (parent_id self-referencing FK)
- Per-project and tenant-scoped
- Folders used as containers for documents

**Missing:**
- No folder templates (typical for engineering projects: 00-General, 01-Civil, etc.)
- No permission controls per folder (uses tenant-wide RBAC only)

**Grade: B**

---

## Transmittal System

**Implementation:** `api/routes/transmittals.ts` + `api/services/transmittals/transmittalService.ts`

### Workflow (Verified)

```
POST /api/v1/transmittals           — create (draft)
POST /api/v1/transmittals/:id/send  — draft → sent (auto-assigns ref number)
POST /api/v1/transmittals/:id/respond — record response
POST /api/v1/transmittals/:id/close   — close
GET  /api/v1/transmittals/overdue     — response-due items
```

**Transmittal counter (verified):**
```sql
-- Migration 069: transmittal_counters table
-- Auto-increment per project: T-001, T-002, etc.
-- Uses SELECT ... FOR UPDATE to prevent duplicate numbers
```

**Event log:** Every state change recorded in `transmittal_events` — full audit trail.

**Response due date tracking:** `response_required_by` field; overdue endpoint queries this.

**Aconex parity assessment:**
- Aconex has formal correspondence (letters, instructions) — Denver Eng does not
- Aconex has multi-company transmittal distribution — Denver Eng is single-tenant recipient
- Core transmittal workflow is functionally comparable

**Grade: A-**

---

## Drawings Module

**Implementation:** `api/routes/drawings.ts` (found in routes list)

```
GET  /api/v1/projects/:id/drawings
POST /api/v1/projects/:id/drawings
```

**Assessment:** Routes exist. Drawing-specific features (sheet number, revision, discipline, scale) not verified from source. Drawing set management (superseded revisions) not confirmed.

**Grade: C+ (routes confirmed; depth unknown)**

---

## Knowledge Ingestion for AI

**Implementation:** `api/services/knowledgeIngest.ts` + `api/services/knowledgeEmbed.ts`

### Pipeline (Verified)

```
Document confirmed
    ↓
knowledgeIngestHandler polls for unprocessed documents
    ↓
Text extraction (via document.extracted_text or re-parse)
    ↓
Chunking (character-based splitting with overlap)
    ↓
knowledgeEmbedHandler: OpenAI text-embedding-3-large
    ↓
Store in knowledge_chunks with tenant_id + document_id
    ↓
Available for pgvector cosine search via Ask Jarvis
```

**Features:**
- `license_type` field on knowledge_chunks — tracks source provenance ✅
- FTS fallback index (GIN on tsvector) — works without OpenAI ✅
- Bulk ingest: `api/scripts/ingest-directory.ts` for existing document libraries

**Grade: A-**

---

## ISO 19650 Compliance Assessment

ISO 19650 is the BIM/information management standard for construction.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Common Data Environment (CDE) | 🟡 Partial | Folder structure + documents; no formal CDE states |
| Document state: WIP/Shared/Published/Archived | ❌ | Status field exists but not mapped to ISO states |
| Naming convention enforcement | ❌ | Free-form naming only |
| Suitability codes (A, B, D, S1–S7) | ❌ | Not implemented |
| Supersession tracking | 🟡 Partial | Version history exists; no supersede relationship |
| Clash/review with information containers | ❌ | BIM + docs not formally linked |

**Verdict:** Document management has the building blocks for ISO 19650 compliance but is not compliant out of the box. A configuration layer (naming conventions, status mapping) is needed.

---

## Document Management Summary

| Feature | Grade | Key Finding |
|---------|-------|-------------|
| File upload (S3/local) | A | Presigned upload, dual backend |
| Version control | B+ | Full history; no checkout lock |
| Folder structure | B | Hierarchy works; no permissions per folder |
| Transmittals | A- | Full workflow, counters, event log |
| Drawings | C+ | Routes confirmed; depth unknown |
| Knowledge AI pipeline | A- | Real embedding + FTS fallback |
| ISO 19650 compliance | C | Building blocks only; not out-of-box compliant |

**Document Management Score: 78/100**
