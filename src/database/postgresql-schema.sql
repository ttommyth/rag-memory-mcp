-- PostgreSQL Schema Conversion for RAG Memory MCP
-- Converts SQLite schema to PostgreSQL with pgvector support
-- 
-- Prerequisites:
-- - PostgreSQL 12+ with pgvector extension
-- - CREATE EXTENSION vector; must be run first

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Set optimal settings for vector operations
SET maintenance_work_mem = '512MB';
SET max_parallel_maintenance_workers = 7;

-- ============================================================================
-- 1. CORE KNOWLEDGE GRAPH TABLES
-- ============================================================================

-- 1.1 entities - Primary nodes in the knowledge graph
CREATE TABLE entities (
    id VARCHAR(255) PRIMARY KEY,                    -- Format: entity_{name_normalized}
    name VARCHAR(255) NOT NULL UNIQUE,              -- Human-readable entity name
    entity_type VARCHAR(100) DEFAULT 'CONCEPT',     -- PERSON, CONCEPT, TECHNOLOGY, etc.
    observations JSONB DEFAULT '[]'::jsonb,         -- Array of contextual information
    mentions INTEGER DEFAULT 0,                     -- Usage frequency counter
    metadata JSONB DEFAULT '{}'::jsonb,             -- Metadata object
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for entities
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_mentions ON entities(mentions);
CREATE INDEX idx_entities_observations_gin ON entities USING GIN(observations);
CREATE INDEX idx_entities_metadata_gin ON entities USING GIN(metadata);

-- 1.2 relationships - Directed connections between entities
CREATE TABLE relationships (
    id VARCHAR(255) PRIMARY KEY,                    -- Format: rel_{source}_{type}_{target}
    source_entity VARCHAR(255) NOT NULL,            -- References entities(id)
    target_entity VARCHAR(255) NOT NULL,            -- References entities(id)
    relation_type VARCHAR(100) NOT NULL,            -- IS_A, HAS, USES, IMPLEMENTS, etc.
    confidence REAL DEFAULT 1.0,                   -- Relationship strength (0.0-1.0)
    metadata JSONB DEFAULT '{}'::jsonb,             -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_relationships_source FOREIGN KEY (source_entity) 
        REFERENCES entities(id) ON DELETE CASCADE,
    CONSTRAINT fk_relationships_target FOREIGN KEY (target_entity) 
        REFERENCES entities(id) ON DELETE CASCADE,
    CONSTRAINT chk_confidence CHECK (confidence >= 0.0 AND confidence <= 1.0)
);

-- Indexes for relationships
CREATE INDEX idx_relationships_source ON relationships(source_entity);
CREATE INDEX idx_relationships_target ON relationships(target_entity);
CREATE INDEX idx_relationships_type ON relationships(relation_type);
CREATE INDEX idx_relationships_confidence ON relationships(confidence);
CREATE INDEX idx_relationships_metadata_gin ON relationships USING GIN(metadata);

-- ============================================================================
-- 2. DOCUMENT MANAGEMENT TABLES
-- ============================================================================

-- 2.1 documents - RAG document storage
CREATE TABLE documents (
    id VARCHAR(255) PRIMARY KEY,                    -- User-defined document identifier
    content TEXT NOT NULL,                         -- Full document text content
    metadata JSONB DEFAULT '{}'::jsonb,            -- Document metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for documents
CREATE INDEX idx_documents_created_at ON documents(created_at);
CREATE INDEX idx_documents_metadata_gin ON documents USING GIN(metadata);

-- 2.2 chunk_metadata - Document chunk information and knowledge graph chunks
CREATE TABLE chunk_metadata (
    id SERIAL PRIMARY KEY,                         -- Auto-increment primary key
    chunk_id VARCHAR(255) UNIQUE NOT NULL,        -- Format: doc_chunk_N or kg_entity_X
    document_id VARCHAR(255),                      -- References documents(id), NULL for KG chunks
    chunk_index INTEGER,                           -- Position within document
    text TEXT,                                     -- Chunk content
    start_pos INTEGER,                             -- Character start position
    end_pos INTEGER,                               -- Character end position
    metadata JSONB DEFAULT '{}'::jsonb,            -- Chunk metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Knowledge graph chunk support
    chunk_type VARCHAR(50) DEFAULT 'document',     -- 'document', 'entity', 'relationship'
    entity_id VARCHAR(255),                        -- For knowledge graph chunks
    relationship_id VARCHAR(255),                  -- For relationship chunks
    
    CONSTRAINT fk_chunk_metadata_document FOREIGN KEY (document_id) 
        REFERENCES documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_chunk_metadata_entity FOREIGN KEY (entity_id) 
        REFERENCES entities(id) ON DELETE CASCADE,
    CONSTRAINT fk_chunk_metadata_relationship FOREIGN KEY (relationship_id) 
        REFERENCES relationships(id) ON DELETE CASCADE,
    CONSTRAINT chk_chunk_type CHECK (chunk_type IN ('document', 'entity', 'relationship'))
);

-- Indexes for chunk_metadata
CREATE INDEX idx_chunk_metadata_document ON chunk_metadata(document_id);
CREATE INDEX idx_chunk_metadata_type ON chunk_metadata(chunk_type);
CREATE INDEX idx_chunk_metadata_entity ON chunk_metadata(entity_id);
CREATE INDEX idx_chunk_metadata_relationship ON chunk_metadata(relationship_id);
CREATE INDEX idx_chunk_metadata_chunk_id ON chunk_metadata(chunk_id);
CREATE INDEX idx_chunk_metadata_metadata_gin ON chunk_metadata USING GIN(metadata);

-- ============================================================================
-- 3. VECTOR EMBEDDING TABLES (pgvector)
-- ============================================================================

-- 3.1 chunks - Vector embeddings for document chunks
CREATE TABLE chunks (
    id SERIAL PRIMARY KEY,                         -- Auto-increment primary key
    chunk_metadata_id INTEGER NOT NULL,           -- References chunk_metadata(id)
    embedding vector(384) NOT NULL,               -- 384-dimensional vector embeddings
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_chunks_metadata FOREIGN KEY (chunk_metadata_id) 
        REFERENCES chunk_metadata(id) ON DELETE CASCADE
);

-- Vector indexes for chunks (HNSW indexes created separately after data migration)
-- CREATE INDEX idx_chunks_embedding_hnsw ON chunks 
--     USING hnsw (embedding vector_cosine_ops) 
--     WITH (m = 16, ef_construction = 64);

-- Additional indexes
CREATE INDEX idx_chunks_metadata_id ON chunks(chunk_metadata_id);

-- 3.2 entity_embeddings - Vector embeddings for entities
CREATE TABLE entity_embeddings (
    id SERIAL PRIMARY KEY,                         -- Auto-increment primary key
    entity_id VARCHAR(255) NOT NULL UNIQUE,       -- References entities(id)
    embedding vector(384) NOT NULL,               -- 384-dimensional entity vectors
    embedding_text TEXT,                          -- Text used to generate embedding
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_entity_embeddings_entity FOREIGN KEY (entity_id) 
        REFERENCES entities(id) ON DELETE CASCADE
);

-- Vector indexes for entity_embeddings (HNSW indexes created separately after data migration)
-- CREATE INDEX idx_entity_embeddings_embedding_hnsw ON entity_embeddings 
--     USING hnsw (embedding vector_cosine_ops) 
--     WITH (m = 16, ef_construction = 64);

-- Additional indexes
CREATE INDEX idx_entity_embeddings_entity_id ON entity_embeddings(entity_id);

-- ============================================================================
-- 4. ASSOCIATION TABLES
-- ============================================================================

-- 4.1 chunk_entities - Many-to-many relationship between chunks and entities
CREATE TABLE chunk_entities (
    chunk_metadata_id INTEGER NOT NULL,           -- References chunk_metadata(id)
    entity_id VARCHAR(255) NOT NULL,              -- References entities(id)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (chunk_metadata_id, entity_id),
    
    CONSTRAINT fk_chunk_entities_chunk FOREIGN KEY (chunk_metadata_id) 
        REFERENCES chunk_metadata(id) ON DELETE CASCADE,
    CONSTRAINT fk_chunk_entities_entity FOREIGN KEY (entity_id) 
        REFERENCES entities(id) ON DELETE CASCADE
);

-- Indexes for chunk_entities
CREATE INDEX idx_chunk_entities_entity ON chunk_entities(entity_id);
CREATE INDEX idx_chunk_entities_chunk ON chunk_entities(chunk_metadata_id);

-- ============================================================================
-- 5. MIGRATION SUPPORT TABLES
-- ============================================================================

-- 5.1 schema_migrations - Track database schema versions
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rollback_sql TEXT
);

-- Insert initial migration record
INSERT INTO schema_migrations (version, description) 
VALUES (1, 'Initial PostgreSQL schema with pgvector support');

-- ============================================================================
-- 6. PERFORMANCE OPTIMIZATION
-- ============================================================================

-- Analyze tables for query planner
ANALYZE entities;
ANALYZE relationships;
ANALYZE documents;
ANALYZE chunk_metadata;
ANALYZE chunks;
ANALYZE entity_embeddings;
ANALYZE chunk_entities;

-- ============================================================================
-- 7. UTILITY FUNCTIONS
-- ============================================================================

-- Function to calculate vector similarity (cosine distance)
CREATE OR REPLACE FUNCTION vector_similarity(vec1 vector, vec2 vector)
RETURNS REAL AS $$
BEGIN
    RETURN 1 - (vec1 <=> vec2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to find similar chunks
CREATE OR REPLACE FUNCTION find_similar_chunks(
    query_embedding vector(384),
    similarity_threshold REAL DEFAULT 0.7,
    max_results INTEGER DEFAULT 10
)
RETURNS TABLE(
    chunk_id VARCHAR(255),
    similarity REAL,
    text TEXT,
    document_id VARCHAR(255)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cm.chunk_id,
        vector_similarity(c.embedding, query_embedding) as similarity,
        cm.text,
        cm.document_id
    FROM chunks c
    JOIN chunk_metadata cm ON c.chunk_metadata_id = cm.id
    WHERE vector_similarity(c.embedding, query_embedding) >= similarity_threshold
    ORDER BY c.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Function to find similar entities
CREATE OR REPLACE FUNCTION find_similar_entities(
    query_embedding vector(384),
    similarity_threshold REAL DEFAULT 0.7,
    max_results INTEGER DEFAULT 10
)
RETURNS TABLE(
    entity_name VARCHAR(255),
    entity_type VARCHAR(100),
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.name,
        e.entity_type,
        vector_similarity(ee.embedding, query_embedding) as similarity
    FROM entity_embeddings ee
    JOIN entities e ON ee.entity_id = e.id
    WHERE vector_similarity(ee.embedding, query_embedding) >= similarity_threshold
    ORDER BY ee.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 8. VIEWS FOR COMPATIBILITY
-- ============================================================================

-- View to maintain compatibility with existing queries
CREATE VIEW v_chunk_with_embeddings AS
SELECT 
    cm.id as rowid,
    cm.chunk_id,
    cm.document_id,
    cm.chunk_index,
    cm.text,
    cm.start_pos,
    cm.end_pos,
    cm.metadata,
    cm.chunk_type,
    cm.entity_id,
    cm.relationship_id,
    c.embedding,
    cm.created_at
FROM chunk_metadata cm
LEFT JOIN chunks c ON cm.id = c.chunk_metadata_id;

-- View for entity embeddings compatibility
CREATE VIEW v_entity_with_embeddings AS
SELECT 
    e.id,
    e.name,
    e.entity_type,
    e.observations,
    e.mentions,
    e.metadata,
    ee.embedding,
    ee.embedding_text,
    e.created_at
FROM entities e
LEFT JOIN entity_embeddings ee ON e.id = ee.entity_id;

-- ============================================================================
-- 9. GRANTS AND PERMISSIONS
-- ============================================================================

-- Grant permissions to application user
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rag_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rag_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO rag_user;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rag_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rag_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO rag_user;

-- ============================================================================
-- 10. COMMENTS AND DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE entities IS 'Primary nodes in the knowledge graph representing concepts, people, technologies, etc.';
COMMENT ON TABLE relationships IS 'Directed connections between entities with relationship types and confidence scores';
COMMENT ON TABLE documents IS 'RAG document storage for full-text content and metadata';
COMMENT ON TABLE chunk_metadata IS 'Document chunks and knowledge graph chunks with positioning and metadata';
COMMENT ON TABLE chunks IS 'Vector embeddings for document chunks using pgvector';
COMMENT ON TABLE entity_embeddings IS 'Vector embeddings for entities using pgvector';
COMMENT ON TABLE chunk_entities IS 'Many-to-many associations between chunks and entities';

COMMENT ON COLUMN entities.observations IS 'JSONB array of contextual information and evidence about the entity';
COMMENT ON COLUMN relationships.confidence IS 'Relationship strength from 0.0 to 1.0';
COMMENT ON COLUMN chunks.embedding IS '384-dimensional vector embedding using sentence-transformers/all-MiniLM-L12-v2';
COMMENT ON COLUMN entity_embeddings.embedding IS '384-dimensional vector embedding generated from entity name, type, and observations';

-- ============================================================================
-- SCHEMA CREATION COMPLETE
-- ============================================================================

-- Final verification
SELECT 'PostgreSQL schema created successfully with pgvector support' as status;
SELECT version() as postgresql_version;
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- Show table sizes (will be 0 for new schema)
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation
FROM pg_stats 
WHERE schemaname = 'public' 
    AND tablename IN ('entities', 'relationships', 'documents', 'chunk_metadata', 'chunks', 'entity_embeddings')
ORDER BY tablename, attname;
