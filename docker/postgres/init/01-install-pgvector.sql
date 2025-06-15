-- Install pgvector extension
-- This script runs during PostgreSQL initialization

-- Create the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify the extension is installed
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- Test vector functionality
SELECT '[1,2,3]'::vector;

-- Create a test table to verify vector operations work
CREATE TABLE IF NOT EXISTS vector_test (
    id SERIAL PRIMARY KEY,
    embedding vector(3)
);

-- Insert test data
INSERT INTO vector_test (embedding) VALUES 
    ('[1,2,3]'::vector),
    ('[4,5,6]'::vector),
    ('[7,8,9]'::vector);

-- Test vector similarity search
SELECT id, embedding, embedding <-> '[1,2,3]'::vector as distance 
FROM vector_test 
ORDER BY embedding <-> '[1,2,3]'::vector 
LIMIT 3;

-- Clean up test table
DROP TABLE vector_test;

-- Log successful installation
\echo 'pgvector extension installed and tested successfully'
