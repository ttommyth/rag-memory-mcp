-- Create the RAG Memory database structure
-- This script sets up the basic database structure for testing

-- Set database parameters for optimal vector performance
ALTER DATABASE rag_memory SET maintenance_work_mem = '512MB';
ALTER DATABASE rag_memory SET max_parallel_maintenance_workers = 7;

-- Create schema for RAG Memory tables
CREATE SCHEMA IF NOT EXISTS rag_memory;

-- Set search path
SET search_path TO rag_memory, public;

-- Create user roles
CREATE ROLE rag_readonly;
CREATE ROLE rag_readwrite;

-- Grant permissions
GRANT CONNECT ON DATABASE rag_memory TO rag_readonly, rag_readwrite;
GRANT USAGE ON SCHEMA rag_memory TO rag_readonly, rag_readwrite;
GRANT SELECT ON ALL TABLES IN SCHEMA rag_memory TO rag_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA rag_memory TO rag_readwrite;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA rag_memory TO rag_readwrite;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA rag_memory GRANT SELECT ON TABLES TO rag_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA rag_memory GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rag_readwrite;
ALTER DEFAULT PRIVILEGES IN SCHEMA rag_memory GRANT USAGE, SELECT ON SEQUENCES TO rag_readwrite;

-- Grant role to main user
GRANT rag_readwrite TO rag_user;

-- Log successful setup
\echo 'Database structure and permissions configured successfully'
