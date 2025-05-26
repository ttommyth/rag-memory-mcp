import { Migration } from './migration-manager.js';

export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Complete RAG Knowledge Graph schema - all tables and features',
    up: (db) => {
      // Disable foreign key enforcement to make deletions easier
      db.pragma('foreign_keys = OFF');

      // Original entities table (enhanced)
      db.exec(`
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

      // Original relationships table (enhanced) - FK constraints kept for reference but not enforced
      db.exec(`
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

      // Documents table for RAG
      db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          metadata TEXT DEFAULT '{}',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Vector embeddings using sqlite-vec for document chunks
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING vec0(
          embedding FLOAT[384]
        )
      `);

      // Vector embeddings for entities using sqlite-vec
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entity_embeddings USING vec0(
          embedding FLOAT[384]
        )
      `);

      // Basic chunk metadata table (without enhanced hybrid search features)
      db.exec(`
        CREATE TABLE IF NOT EXISTS chunk_metadata (
          rowid INTEGER PRIMARY KEY,
          chunk_id TEXT UNIQUE,
          document_id TEXT,
          chunk_index INTEGER,
          text TEXT,
          start_pos INTEGER,
          end_pos INTEGER,
          metadata TEXT DEFAULT '{}',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        )
      `);

      // Entity embedding metadata
      db.exec(`
        CREATE TABLE IF NOT EXISTS entity_embedding_metadata (
          rowid INTEGER PRIMARY KEY,
          entity_id TEXT UNIQUE,
          embedding_text TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
        )
      `);

      // Chunk-Entity associations
      db.exec(`
        CREATE TABLE IF NOT EXISTS chunk_entities (
          chunk_rowid INTEGER NOT NULL,
          entity_id TEXT NOT NULL,
          PRIMARY KEY (chunk_rowid, entity_id),
          FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
          FOREIGN KEY (chunk_rowid) REFERENCES chunk_metadata(rowid) ON DELETE CASCADE
        )
      `);

      // Create indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
        CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity);
        CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity);
        CREATE INDEX IF NOT EXISTS idx_chunk_entities_entity ON chunk_entities(entity_id);
        CREATE INDEX IF NOT EXISTS idx_chunk_metadata_document ON chunk_metadata(document_id);
        CREATE INDEX IF NOT EXISTS idx_entity_embedding_metadata_entity ON entity_embedding_metadata(entity_id);
      `);
    },
    down: (db) => {
      db.exec(`DROP TABLE IF EXISTS chunk_entities`);
      db.exec(`DROP TABLE IF EXISTS entity_embedding_metadata`);
      db.exec(`DROP TABLE IF EXISTS entity_embeddings`);
      db.exec(`DROP TABLE IF EXISTS chunks`);
      db.exec(`DROP TABLE IF EXISTS chunk_metadata`);
      db.exec(`DROP TABLE IF EXISTS documents`);
      db.exec(`DROP TABLE IF EXISTS relationships`);
      db.exec(`DROP TABLE IF EXISTS entities`);
    }
  },

  {
    version: 2,
    description: 'Enhanced hybrid search - add chunk_type support for knowledge graph chunks',
    up: (db) => {
      // Add new columns to chunk_metadata to support knowledge graph chunks
      db.exec(`
        ALTER TABLE chunk_metadata ADD COLUMN chunk_type TEXT DEFAULT 'document'
      `);
      
      db.exec(`
        ALTER TABLE chunk_metadata ADD COLUMN entity_id TEXT
      `);
      
      db.exec(`
        ALTER TABLE chunk_metadata ADD COLUMN relationship_id TEXT
      `);

      // Add indexes for the new columns
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chunk_metadata_type ON chunk_metadata(chunk_type);
        CREATE INDEX IF NOT EXISTS idx_chunk_metadata_entity ON chunk_metadata(entity_id);
        CREATE INDEX IF NOT EXISTS idx_chunk_metadata_relationship ON chunk_metadata(relationship_id);
      `);

      // Update existing rows to have chunk_type = 'document'
      db.exec(`
        UPDATE chunk_metadata SET chunk_type = 'document' WHERE chunk_type IS NULL
      `);
    },
    down: (db) => {
      // SQLite doesn't support dropping columns, so we'd need to recreate the table
      // For now, we'll just mark this as not reversible
      throw new Error('This migration cannot be reversed due to SQLite limitations');
    }
  }
]; 