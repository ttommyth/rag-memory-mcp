-- PostgreSQL HNSW Vector Indexes
-- Create vector indexes after tables are populated with data
-- Run this after data migration is complete

-- Drop existing vector indexes if they exist
DROP INDEX IF EXISTS idx_chunks_embedding_hnsw;
DROP INDEX IF EXISTS idx_entity_embeddings_embedding_hnsw;

-- Create HNSW indexes for vector similarity search
-- Parameters optimized for 384-dimensional vectors

-- Chunks vector index
CREATE INDEX idx_chunks_embedding_hnsw ON chunks 
    USING hnsw (embedding vector_cosine_ops) 
    WITH (m = 16, ef_construction = 64);

-- Entity embeddings vector index  
CREATE INDEX idx_entity_embeddings_embedding_hnsw ON entity_embeddings 
    USING hnsw (embedding vector_cosine_ops) 
    WITH (m = 16, ef_construction = 64);

-- Alternative distance metrics (uncomment if needed)
-- L2 distance indexes
-- CREATE INDEX idx_chunks_embedding_l2 ON chunks 
--     USING hnsw (embedding vector_l2_ops) 
--     WITH (m = 16, ef_construction = 64);

-- CREATE INDEX idx_entity_embeddings_embedding_l2 ON entity_embeddings 
--     USING hnsw (embedding vector_l2_ops) 
--     WITH (m = 16, ef_construction = 64);

-- Inner product indexes
-- CREATE INDEX idx_chunks_embedding_ip ON chunks 
--     USING hnsw (embedding vector_ip_ops) 
--     WITH (m = 16, ef_construction = 64);

-- CREATE INDEX idx_entity_embeddings_embedding_ip ON entity_embeddings 
--     USING hnsw (embedding vector_ip_ops) 
--     WITH (m = 16, ef_construction = 64);

-- Analyze tables after index creation
ANALYZE chunks;
ANALYZE entity_embeddings;

-- Show index information
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('chunks', 'entity_embeddings')
    AND indexname LIKE '%hnsw%'
ORDER BY tablename, indexname;
