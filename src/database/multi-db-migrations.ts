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
 * Migration 1: Complete RAG Knowledge Graph Schema
 * Creates all tables and features for both SQLite and PostgreSQL
 */
const migration001: MultiDbMigration = {
  version: 1,
  description: 'Complete RAG Knowledge Graph schema - all tables and features',
  
  sqlite: {
    up: async (adapter: DatabaseAdapter) => {
      // Execute raw SQL for SQLite-specific schema
      await adapter.executeInTransaction(async (tx) => {
        // Disable foreign key enforcement for easier deletions
        await tx.execute('PRAGMA foreign_keys = OFF');

        // Entities table
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            entityType TEXT DEFAULT 'CONCEPT',
            observations TEXT DEFAULT '[]',
            mentions INTEGER DEFAULT 0,
            metadata TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Relationships table
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS relationships (
            id TEXT PRIMARY KEY,
            source_entity TEXT NOT NULL,
            target_entity TEXT NOT NULL,
            relationType TEXT NOT NULL,
            confidence REAL DEFAULT 1.0,
            metadata TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (source_entity) REFERENCES entities(id) ON DELETE CASCADE,
            FOREIGN KEY (target_entity) REFERENCES entities(id) ON DELETE CASCADE
          )
        `);

        // Documents table
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            metadata TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Vector embeddings using sqlite-vec for document chunks
        await tx.execute(`
          CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING vec0(
            embedding FLOAT[384]
          )
        `);

        // Vector embeddings for entities using sqlite-vec
        await tx.execute(`
          CREATE VIRTUAL TABLE IF NOT EXISTS entity_embeddings USING vec0(
            embedding FLOAT[384]
          )
        `);

        // Chunk metadata table
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS chunk_metadata (
            rowid INTEGER PRIMARY KEY,
            chunk_id TEXT UNIQUE,
            document_id TEXT,
            chunk_index INTEGER,
            text TEXT,
            start_pos INTEGER,
            end_pos INTEGER,
            chunk_type TEXT DEFAULT 'document',
            entity_id TEXT,
            relationship_id TEXT,
            metadata TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
          )
        `);

        // Entity embedding metadata
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS entity_embedding_metadata (
            rowid INTEGER PRIMARY KEY,
            entity_id TEXT UNIQUE,
            embedding_text TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
          )
        `);

        // Chunk-Entity associations
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS chunk_entities (
            chunk_rowid INTEGER NOT NULL,
            entity_id TEXT NOT NULL,
            PRIMARY KEY (chunk_rowid, entity_id),
            FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
            FOREIGN KEY (chunk_rowid) REFERENCES chunk_metadata(rowid) ON DELETE CASCADE
          )
        `);

        // Create indexes
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_chunk_entities_entity ON chunk_entities(entity_id)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_chunk_metadata_document ON chunk_metadata(document_id)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_chunk_metadata_type ON chunk_metadata(chunk_type)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_entity_embedding_metadata_entity ON entity_embedding_metadata(entity_id)`);
      });
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

        // Chunk metadata table with vector embedding
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
            embedding halfvec(384),
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
          )
        `);

        // Entity embeddings table
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS entity_embeddings (
            id SERIAL PRIMARY KEY,
            entity_id TEXT UNIQUE,
            embedding_text TEXT,
            embedding halfvec(384),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
          )
        `);

        // Chunk-Entity associations
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS chunk_entities (
            chunk_id INTEGER NOT NULL,
            entity_id TEXT NOT NULL,
            PRIMARY KEY (chunk_id, entity_id),
            FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
            FOREIGN KEY (chunk_id) REFERENCES chunk_metadata(id) ON DELETE CASCADE
          )
        `);

        // Create indexes
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_chunk_entities_entity ON chunk_entities(entity_id)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_chunk_metadata_document ON chunk_metadata(document_id)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_chunk_metadata_type ON chunk_metadata(chunk_type)`);
        await tx.execute(`CREATE INDEX IF NOT EXISTS idx_entity_embeddings_entity ON entity_embeddings(entity_id)`);

        // Create HNSW indexes for vector similarity search
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_hnsw 
          ON chunk_metadata USING hnsw (embedding halfvec_cosine_ops) 
          WITH (m = 24, ef_construction = 40)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_entity_embeddings_hnsw 
          ON entity_embeddings USING hnsw (embedding halfvec_cosine_ops) 
          WITH (m = 24, ef_construction = 40)
        `);
      });
    },

    down: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        await tx.execute('DROP TABLE IF EXISTS chunk_entities CASCADE');
        await tx.execute('DROP TABLE IF EXISTS entity_embeddings CASCADE');
        await tx.execute('DROP TABLE IF EXISTS chunk_metadata CASCADE');
        await tx.execute('DROP TABLE IF EXISTS documents CASCADE');
        await tx.execute('DROP TABLE IF EXISTS relationships CASCADE');
        await tx.execute('DROP TABLE IF EXISTS entities CASCADE');
      });
    }
  }
};

/**
 * Migration 2: Schema Migrations Table
 * Creates the schema_migrations table for tracking applied migrations
 */
const migration002: MultiDbMigration = {
  version: 2,
  description: 'Create schema migrations tracking table',
  
  common: {
    up: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        // This table structure works for both SQLite and PostgreSQL
        await tx.execute(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      });
    },

    down: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        await tx.execute('DROP TABLE IF EXISTS schema_migrations');
      });
    }
  }
};

/**
 * Migration 3: Enhanced Search Features
 * Adds additional indexes and features for improved search performance
 */
const migration003: MultiDbMigration = {
  version: 3,
  description: 'Enhanced search features and performance optimizations',
  
  sqlite: {
    up: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        // Add full-text search indexes for SQLite
        await tx.execute(`
          CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
            name, observations, content='entities', content_rowid='rowid'
          )
        `);

        await tx.execute(`
          CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            content, metadata, content='documents', content_rowid='rowid'
          )
        `);

        // Triggers to keep FTS indexes in sync
        await tx.execute(`
          CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities BEGIN
            INSERT INTO entities_fts(rowid, name, observations) VALUES (new.rowid, new.name, new.observations);
          END
        `);

        await tx.execute(`
          CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities BEGIN
            INSERT INTO entities_fts(entities_fts, rowid, name, observations) VALUES ('delete', old.rowid, old.name, old.observations);
          END
        `);

        await tx.execute(`
          CREATE TRIGGER IF NOT EXISTS entities_fts_update AFTER UPDATE ON entities BEGIN
            INSERT INTO entities_fts(entities_fts, rowid, name, observations) VALUES ('delete', old.rowid, old.name, old.observations);
            INSERT INTO entities_fts(rowid, name, observations) VALUES (new.rowid, new.name, new.observations);
          END
        `);
      });
    },

    down: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        await tx.execute('DROP TRIGGER IF EXISTS entities_fts_update');
        await tx.execute('DROP TRIGGER IF EXISTS entities_fts_delete');
        await tx.execute('DROP TRIGGER IF EXISTS entities_fts_insert');
        await tx.execute('DROP TABLE IF EXISTS documents_fts');
        await tx.execute('DROP TABLE IF EXISTS entities_fts');
      });
    }
  },

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

        // Add text search indexes
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_entities_name_trgm 
          ON entities USING gin(name gin_trgm_ops)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_documents_content_trgm 
          ON documents USING gin(content gin_trgm_ops)
        `);
      });
    },

    down: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        await tx.execute('DROP INDEX IF EXISTS idx_documents_content_trgm');
        await tx.execute('DROP INDEX IF EXISTS idx_entities_name_trgm');
        await tx.execute('DROP INDEX IF EXISTS idx_documents_metadata_gin');
        await tx.execute('DROP INDEX IF EXISTS idx_entities_observations_gin');
      });
    }
  }
};

/**
 * Migration 4: Performance Optimizations
 * Additional indexes and optimizations for better query performance
 */
const migration004: MultiDbMigration = {
  version: 4,
  description: 'Performance optimizations and additional indexes',
  
  sqlite: {
    up: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        // Add composite indexes for common query patterns
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_relationships_composite 
          ON relationships(source_entity, relation_type)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_chunk_metadata_composite 
          ON chunk_metadata(document_id, chunk_type)
        `);

        // Add index on created_at for temporal queries
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
        await tx.execute('DROP INDEX IF EXISTS idx_chunk_metadata_composite');
        await tx.execute('DROP INDEX IF EXISTS idx_relationships_composite');
      });
    }
  },

  postgresql: {
    up: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        // Add composite indexes for common query patterns
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_relationships_composite 
          ON relationships(source_entity, relation_type)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_chunk_metadata_composite 
          ON chunk_metadata(document_id, chunk_type)
        `);

        // Add index on created_at for temporal queries
        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_entities_created_at ON entities(created_at)
        `);

        await tx.execute(`
          CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at)
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
      });
    },

    down: async (adapter: DatabaseAdapter) => {
      await adapter.executeInTransaction(async (tx) => {
        await tx.execute('DROP INDEX IF EXISTS idx_chunk_metadata_entity_chunks');
        await tx.execute('DROP INDEX IF EXISTS idx_chunk_metadata_document_chunks');
        await tx.execute('DROP INDEX IF EXISTS idx_documents_created_at');
        await tx.execute('DROP INDEX IF EXISTS idx_entities_created_at');
        await tx.execute('DROP INDEX IF EXISTS idx_chunk_metadata_composite');
        await tx.execute('DROP INDEX IF EXISTS idx_relationships_composite');
      });
    }
  }
};

/**
 * Export all migrations
 */
export const multiDbMigrations: MultiDbMigration[] = [
  migration001,
  migration002,
  migration003,
  migration004
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
