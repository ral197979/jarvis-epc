-- ============================================================
-- JARVIS EPC — Migration 025: pgvector semantic embeddings (Phase 3)
-- v4.31.0 | Vector column + HNSW index for cosine similarity search
--
-- Semantic retrieval upgrade to the knowledge corpus. Lexical FTS
-- (via websearch_to_tsquery + ts_rank_cd) stays in place; the hybrid
-- ranker blends both scores so synonym/paraphrase queries ("purge
-- sequence" → "flushing procedure") start hitting the right chunks.
--
-- Storage:
--   embedding VECTOR(1536) — OpenAI text-embedding-3-small dimensions.
--   Upgrading to 3-large (3072-dim) is a column ALTER + re-embed.
--
-- Indexing:
--   HNSW is chosen over IVFFlat because we're adding embeddings
--   incrementally (as corpus grows) and HNSW's online-insert is
--   cheap — IVFFlat would need periodic rebuilds.
--
-- Backwards compatibility:
--   knowledge_chunks.embedding_json (added in migration 022) stays —
--   it stores the raw array alongside the pgvector value so we can
--   re-derive / migrate dimensions without re-embedding. Writes go
--   to both columns via the ingest handler.
-- ============================================================

-- The extension is provided by the pgvector Postgres extension.
-- Requires a superuser role; the jarvis user has superuser locally.
CREATE EXTENSION IF NOT EXISTS vector;

-- Column dimension must match the configured EMBED model. v4.31.0
-- defaults to Together AI's intfloat/multilingual-e5-large-instruct (1024 dim).
-- Swap to OpenAI text-embedding-3-small by running:
--   ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(1536);
-- and re-embedding the corpus.
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- HNSW index for cosine similarity. Parameters:
--   m = 16        — default; graph neighbors per node
--   ef_construction = 64  — build-time search breadth
-- These defaults give good recall with modest index size for ~100k
-- chunks. Tune with `SET hnsw.ef_search = N;` per-query at read time.
CREATE INDEX IF NOT EXISTS idx_kc_embedding_hnsw
  ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Track the model used per chunk so mixed-dimension / provider
-- corpora stay coherent. Populated by the embed handler.
-- (embedding_model column was already added in migration 022.)
