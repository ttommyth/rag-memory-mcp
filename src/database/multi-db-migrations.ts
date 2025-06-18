/**
 * Multi-Database Migrations
 * 
 * Migration definitions that support both SQLite and PostgreSQL databases.
 * Each migration includes database-specific implementations while maintaining
 * schema compatibility and feature parity.
 */

import { MultiDbMigration } from './multi-db-migration-manager.js';
import { DatabaseAdapter } from './interfaces.js';

/**
 * Migration 5: Complete RAG Knowledge Graph Schema (Multi-DB)
 * Creates all tables and features for both SQLite and PostgreSQL
 * Note: Using version 5 to avoid conflicts with legacy SQLite migrations (1-4)
 * This migration creates a schema equivalent to SQLite migration version 4
 */
const migration005: MultiDbMigration = {
  version: 5,
  description: 'Complete RAG Knowledge Graph schema - compatible with SQLite v4',
  
  sqlite: {
    up: async (adapter: DatabaseAdapter) => {
      // This SQLite implementation assumes legacy migrations 1-4 have already run
      // This migration is only for PostgreSQL systems that need to match SQLite v4 schema
      console.error('⚠️ SQLite should use legacy migrations 1-4, not multi-DB migration 5');
      console.error('   Multi-DB migration 5 is designed for PostgreSQL compatibility');
    },

    down: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        await tx.execute('DROP TABLE IF EXISTS chunk_entities');
        await tx.execute('DROP TABLE IF EXISTS entity_embedding_metadata');
        await tx.execute('DROP TABLE IF EXISTS entity_embeddings');
        await tx.execute('DROP TABLE IF EXISTS chunks');
        await tx.execute('DROP TABLE IF EXISTS chunk_metadata');
        await tx.execute('DROP TABLE IF EXISTS documents');
        await tx.execute('DROP TABLE IF EXISTS relationships');
        await tx.execute('DROP TABLE IF EXISTS entities');
      });
    }
  },

  postgresql: {
    up: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        // Ensure pgvector extension is available
        await tx.execute('CREATE EXTENSION IF NOT EXISTS vector');

        // Entities table
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            entity_type TEXT DEFAULT 'CONCEPT',
            observations JSONB DEFAULT '[]',
            mentions INTEGER DEFAULT 0,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Relationships table
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS relationships (
            id TEXT PRIMARY KEY,
            source_entity TEXT NOT NULL,
            target_entity TEXT NOT NULL,
            relation_type TEXT NOT NULL,
            confidence REAL DEFAULT 1.0,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (source_entity) REFERENCES entities(id) ON DELETE CASCADE,
            FOREIGN KEY (target_entity) REFERENCES entities(id) ON DELETE CASCADE
          )
        `);

        // Documents table
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Chunk metadata table (compatible with SQLite v4 schema)
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS chunk_metadata (
            id SERIAL PRIMARY KEY,
            chunk_id TEXT UNIQUE,
            document_id TEXT,
            chunk_index INTEGER,
            text TEXT,
            start_pos INTEGER,
            end_pos INTEGER,
            chunk_type TEXT DEFAULT 'document',
            entity_id TEXT,
            relationship_id TEXT,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
          )
        `);

        // Separate chunks table for vector embeddings (matches SQLite v4 structure)
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS chunks (
            id SERIAL PRIMARY KEY,
            chunk_id TEXT UNIQUE,
            embedding halfvec(384)
          )
        `);

        // Entity embeddings table (matches SQLite v4 structure)
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS entity_embeddings (
            id SERIAL PRIMARY KEY,
            entity_id TEXT UNIQUE,
            embedding halfvec(384)
          )
        `);

        // Entity embedding metadata (matches SQLite v4 structure)
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS entity_embedding_metadata (
            id SERIAL PRIMARY KEY,
            entity_id TEXT UNIQUE,
            embedding_text TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
          )
        `);

        // Chunk-Entity associations (matches SQLite v4 structure using chunk_metadata.id)
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS chunk_entities (
            chunk_rowid INTEGER NOT NULL,
            entity_id TEXT NOT NULL,
            PRIMARY KEY (chunk_rowid, entity_id),
            FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
            FOREIGN KEY (chunk_rowid) REFERENCES chunk_metadata(id) ON DELETE CASCADE
          )
        `);

        // Create indexes (compatible with SQLite v4 schema)
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_chunk_entities_entity ON chunk_entities(entity_id)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_chunk_metadata_document ON chunk_metadata(document_id)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_chunk_metadata_type ON chunk_metadata(chunk_type)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_entity_embeddings_entity ON entity_embeddings(entity_id)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_entity_embedding_metadata_entity ON entity_embedding_metadata(entity_id)`);

        // Create HNSW indexes for vector similarity search
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw 
          ON chunks USING hnsw (embedding vector_cosine_ops) 
          WITH (m = 16, ef_construction = 64)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_entity_embeddings_hnsw 
          ON entity_embeddings USING hnsw (embedding vector_cosine_ops) 
          WITH (m = 16, ef_construction = 64)
        `);
      });
    },

    down: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        await tx.execute('DROP TABLE IF EXISTS chunk_entities CASCADE');
        await tx.execute('DROP TABLE IF EXISTS entity_embedding_metadata CASCADE');
        await tx.execute('DROP TABLE IF EXISTS entity_embeddings CASCADE');
        await tx.execute('DROP TABLE IF EXISTS chunks CASCADE');
        await tx.execute('DROP TABLE IF EXISTS chunk_metadata CASCADE');
        await tx.execute('DROP TABLE IF EXISTS documents CASCADE');
        await tx.execute('DROP TABLE IF EXISTS relationships CASCADE');
        await tx.execute('DROP TABLE IF EXISTS entities CASCADE');
      });
    }
  }
};

/**
 * Migration 6: PostgreSQL Advanced Features (Multi-DB)
 * Adds PostgreSQL-specific advanced features not available in SQLite
 */
const migration006: MultiDbMigration = {
  version: 6,
  description: 'PostgreSQL advanced search and performance features',
  
  postgresql: {
    up: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        // Add GIN indexes for full-text search in PostgreSQL
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_entities_observations_gin 
          ON entities USING gin(observations jsonb_ops)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_documents_metadata_gin 
          ON documents USING gin(metadata jsonb_ops)
        `);

        // Add text search indexes (requires pg_trgm extension)
        await tx.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_entities_name_trgm 
          ON entities USING gin(name gin_trgm_ops)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_documents_content_trgm 
          ON documents USING gin(content gin_trgm_ops)
        `);

        // Add composite indexes for common query patterns
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_relationships_composite 
          ON relationships(source_entity, relation_type)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_chunk_metadata_composite 
          ON chunk_metadata(document_id, chunk_type)
        `);

        // Add partial indexes for better performance
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_chunk_metadata_document_chunks 
          ON chunk_metadata(document_id) WHERE chunk_type = 'document'
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_chunk_metadata_entity_chunks 
          ON chunk_metadata(entity_id) WHERE chunk_type = 'entity'
        `);

        // Add temporal indexes
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_entities_created_at ON entities(created_at)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at)
        `);
      });
    },

    down: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        await tx.execute('DROP INDEX IF EXISTS idx_documents_created_at');
        await tx.execute('DROP INDEX IF EXISTS idx_entities_created_at');
        await tx.execute('DROP INDEX IF EXISTS idx_chunk_metadata_entity_chunks');
        await tx.execute('DROP INDEX IF EXISTS idx_chunk_metadata_document_chunks');
        await tx.execute('DROP INDEX IF EXISTS idx_chunk_metadata_composite');
        await tx.execute('DROP INDEX IF EXISTS idx_relationships_composite');
        await tx.execute('DROP INDEX IF EXISTS idx_documents_content_trgm');
        await tx.execute('DROP INDEX IF EXISTS idx_entities_name_trgm');
        await tx.execute('DROP INDEX IF EXISTS idx_documents_metadata_gin');
        await tx.execute('DROP INDEX IF EXISTS idx_entities_observations_gin');
      });
    }
  }
};

/**
 * Migration 7: Fix HNSW Vector Indexes (Multi-DB)
 * Adds the missing HNSW indexes with correct parameters
 */
const migration007: MultiDbMigration = {
  version: 7,
  description: 'Fix HNSW vector indexes with correct parameters',
  
  postgresql: {
    up: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        console.error('🔧 Creating HNSW vector indexes with correct parameters...');
        
        // Create HNSW indexes for vector similarity search with correct parameters
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw 
          ON chunks USING hnsw (embedding vector_cosine_ops) 
          WITH (m = 16, ef_construction = 64)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_entity_embeddings_hnsw 
          ON entity_embeddings USING hnsw (embedding vector_cosine_ops) 
          WITH (m = 16, ef_construction = 64)
        `);
        
        console.error('✅ HNSW vector indexes created successfully');
      });
    },

    down: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        await tx.execute('DROP INDEX IF EXISTS idx_chunks_embedding_hnsw');
        await tx.execute('DROP INDEX IF EXISTS idx_entity_embeddings_hnsw');
      });
    }
  }
};

/**
 * Export all migrations
 * Note: Using versions 5-7 to avoid conflicts with legacy SQLite migrations (1-4)
 * Migration 5: Complete schema compatible with SQLite v4
 * Migration 6: PostgreSQL-specific advanced features  
 * Migration 7: Fix HNSW vector indexes
 */
export const multiDbMigrations: MultiDbMigration[] = [
  migration005,
  migration006,
  migration007
];

/**
 * Get migrations for a specific database type
 */
export function getMigrationsForDatabase(databaseType: 'sqlite' | 'postgresql'): MultiDbMigration[] {
  return multiDbMigrations.filter(migration => 
    migration.common || migration[databaseType]
  );
}

/**
 * Validate that all migrations have implementations for the specified database type
 */
export function validateMigrationsForDatabase(databaseType: 'sqlite' | 'postgresql'): boolean {
  return multiDbMigrations.every(migration => 
    migration.common || migration[databaseType]
  );
}
