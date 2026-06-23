# 07 — AI LAYER AUDIT

---

## AI Capabilities Inventory

| Feature | Implementation | Grade |
|---------|---------------|-------|
| Ask Jarvis (RAG) | Real — pgvector + Anthropic Claude | ✅ A |
| Knowledge ingestion | Real — chunking, embedding, FTS | ✅ B+ |
| Fix Library extraction | Real — pattern mining from deficiencies | ✅ B |
| Predict | Heuristic — linear regression, no ML | 🟡 C+ |
| Process Design | AI proxy — no engineering computation | 🟡 C |
| Prompt injection guard | Real — 6 regex patterns | ✅ B+ |
| AI Governance | Schema exists; routes exist; limited depth | 🟡 C |

---

## Ask Jarvis — RAG Pipeline Analysis

### Pipeline (verified from `api/services/askBuilder.ts`):

```
User question
    ↓
Prompt injection check (6 regex patterns)
    ↓
Generate embedding (OpenAI text-embedding-3-large, 1536 dim)
    ↓
pgvector cosine similarity search (knowledge_chunks table)
    ↓
PostgreSQL FTS fallback (if embedding unavailable)
    ↓
Hybrid score blend (cosine + lexical)
    ↓
Build system prompt with retrieved chunks
    ↓
Anthropic Claude API call
    ↓
Store message + chunk IDs in chat_messages
    ↓
Return structured answer with citation chunk IDs
```

### Grounding Assessment

**Genuinely grounded** — not a direct LLM call. The system:
1. Embeds the query and searches the knowledge corpus
2. Includes retrieved chunks as context in the system prompt
3. Records which chunk IDs were used for citation
4. Returns citations the user can click to read the source

**Hallucination risk:** MEDIUM
- Without sufficient knowledge documents, Claude will use its training knowledge
- No explicit "I don't know" instruction in system prompt (not verified — system prompt not audited)
- No confidence threshold on retrieval — weak cosine matches still passed to LLM

### Cross-Tenant AI Leakage

**Test:** Can tenant A's question retrieve tenant B's knowledge chunks?

**Evidence:**
```typescript
// knowledgeSearch.ts — tenant-scoped query
WHERE c.tenant_id = current_setting('app.current_tenant_id', true)::uuid
```
Plus RLS on `knowledge_chunks` if enabled.

**Verdict:** ✅ Knowledge retrieval is tenant-scoped at query level. Tenant isolation holds.

**Exception:** Chat session history. Sessions are scoped by `user_id AND tenant_id` — a user who somehow receives a valid JWT for another tenant could read their chat history. Prevented by JWT signing.

---

## Prompt Injection Guard

**Patterns implemented:**
```typescript
/ignore\s+(all\s+)?previous\s+instructions?/i
/disregard\s+(your\s+)?system\s+prompt/i
/you\s+are\s+now\s+a/i
/forget\s+(everything|all)\s+(above|before|prior)/i
/act\s+as\s+(if\s+you\s+(are|were)\s+)?(?:an?\s+)?(?:evil|unrestricted|jailbroken|unfiltered)/i
/\bdan\b.*\bmode\b/i
```

**Assessment:** Covers the most common jailbreak patterns. However:

**Bypass risk (MEDIUM):** These patterns are easily circumvented by:
- Unicode lookalike characters: `i̤gnore previous instructions`
- Encoding: `base64_decode("aWdub3JlIHByZXZpb3VzIGluc3RydWN0aW9ucw==")`
- Novel prompts not in the pattern list
- Multi-turn extraction (splitting the injection across messages)

**Recommendation:** Layer on Anthropic's built-in Constitutional AI safety features; use a classifier model rather than regex for production; add server-side sanitization of non-printable/unusual Unicode.

---

## Knowledge Embedding System

**Provider:** OpenAI `text-embedding-3-large` (1536 dimensions)  
**Storage:** pgvector (migration 071)  
**Index:** IVFFlat with 100 lists  

**Degradation behavior (verified):**
```typescript
// knowledgeSearch.ts
// Fails open — if no embedding provider / no embedded chunks, falls back to lexical
```
System gracefully falls back to PostgreSQL FTS if OpenAI embedding fails. ✅

**Cold start issue:** Fresh installs have no knowledge documents. Ask Jarvis will answer from Claude's training knowledge (not grounded) until documents are uploaded and embedded.

**Embedding cost:** Each uploaded document triggers chunking + OpenAI API call per chunk. For large knowledge bases (thousands of PDFs), embedding costs can be significant. No cost guard or monthly cap implemented.

---

## Predict Service — AI vs. Heuristic

**Claimed:** "AI predictive analytics"  
**Reality (from source comment):**
```typescript
// api/services/predict/predictService.ts line 7
// No ML models — uses linear regression on time-series snapshots,
// composite health scoring, and anomaly detection heuristics.
```

**What it actually does:**
1. Pulls EVM snapshots from DB
2. Runs ordinary least-squares linear regression on EAC time series
3. Computes health score: CPI(40%) + SPI(30%) + burn(20%) + CO risk(10%)
4. Anomaly detection: threshold comparisons (CPI < 0.8 = amber)

**Verdict:** This is statistical heuristics masquerading as AI prediction. Not dishonest — the code comments it clearly — but the marketing claim of "AI prediction" needs calibrating.

**When it works well:** Projects with 8+ EVM snapshots, consistent actuals entry, and full WBS coverage.  
**When it fails:** New projects (< 3 snapshots), projects without EVM baselines, projects with irregular actuals entry.

---

## Process Design AI

**Implementation:** Frontend sends a natural language prompt; `src/components/ProcessDesignView.tsx` calls the AI gateway.  
**Backend:** The AI gateway (`POST /api/v1/gateway`) proxies directly to Anthropic with no engineering domain tools.  
**Assessment:** This is a Claude chat interface with an engineering-themed prompt. No actual process simulation, thermodynamic calculations, or P&ID standards enforcement.

---

## AI Governance Layer

**What exists:**
- `api/routes/aiGovernance.ts` — routes for AI decision approval queue
- `api/db/migrations/` — `ai_approval_events`, `ai_recommendation_queue`, `ai_usage_records` tables
- `api/services/ai/` directory

**What's missing:**
- No frontend for the governance queue (not navigable from the UI)
- No AI model usage dashboard
- No cost tracking or budget alerts for AI API spend

---

## AI Security Scorecard

| Concern | Status | Finding |
|---------|--------|---------|
| Cross-tenant leakage | ✅ PASS | Tenant-scoped retrieval |
| Prompt injection | 🟡 PARTIAL | Regex guard bypassable; no deep defense |
| Knowledge source integrity | ✅ PASS | Sources tracked with license_type |
| Citation accuracy | ✅ PASS | chunk_ids recorded per message |
| Hallucination guard | 🟡 PARTIAL | Grounded but no confidence threshold |
| AI cost control | ❌ MISSING | No monthly cap or usage alerts |
| Governance audit trail | 🟡 PARTIAL | Schema exists; UI missing |

**AI Layer Score: 71/100**
