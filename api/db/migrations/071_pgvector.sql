-- Migration 071: pgvector extension + embedding column
-- P2-5: The knowledge search service (knowledgeSearch.ts) uses pgvector's
-- cosine distance operator (<=>). This migration ensures the extension exists
-- and the knowledge_chunks.embedding column is the correct vector type.
--
-- Idempotent: safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to knowledge_chunks if not already present.
-- Dimension matches EMBED_DIMENSIONS env var (default 1536 for OpenAI).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name = 'knowledge_chunks'
      AND  column_name = 'embedding'
  ) THEN
    ALTER TABLE knowledge_chunks
      ADD COLUMN embedding vector(1536);
  END IF;
END $$;

-- IVFFlat index for fast approximate nearest-neighbour search.
-- Created only if the table has data; otherwise it's a no-op until
-- REINDEX is run after the first batch of embeddings is inserted.
CREATE INDEX IF NOT EXISTS idx_kc_embedding_cosine
  ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
