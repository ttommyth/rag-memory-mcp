#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { get_encoding } from 'tiktoken';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline, env } from '@huggingface/transformers';

// Import our new structured tool system
import { getAllMCPTools, validateToolArgs, getSystemInfo } from './src/tools/tool-registry.js';

// Configure Hugging Face transformers for local-only operation
env.allowRemoteModels = false;
env.allowLocalModels = true;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = './node_modules/@huggingface/transformers/dist/';
}

// Define database file path using environment variable with fallback
const defaultDbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rag-memory.db');
const DB_FILE_PATH = process.env.DB_FILE_PATH
  ? path.isAbsolute(process.env.DB_FILE_PATH)
    ? process.env.DB_FILE_PATH
    : path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.DB_FILE_PATH)
  : defaultDbPath;

// Original MCP interfaces
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// Enhanced RAG interfaces
interface Document {
  id: string;
  content: string;
  metadata: Record<string, any>;
  created_at: string;
}

interface Chunk {
  id: string;
  document_id: string;
  chunk_index: number;
  text: string;
  start_pos: number;
  end_pos: number;
  embedding?: Float32Array;
}

interface SearchResult {
  chunk: Chunk;
  document: Document;
  entities: string[];
  vector_similarity: number;
  graph_boost: number;
  hybrid_score: number;
  distance: number;
}

// Enhanced RAG-enabled Knowledge Graph Manager
class RAGKnowledgeGraphManager {
  private db: Database.Database | null = null;
  private encoding: any = null;
  private embeddingModel: any = null;
  private modelInitialized: boolean = false;

  async initialize() {
    console.error('🚀 Initializing RAG Knowledge Graph MCP Server...');
    
    // Initialize database
    this.db = new Database(DB_FILE_PATH);
    
    // Load sqlite-vec extension
    sqliteVec.load(this.db);
    
    // Initialize tiktoken
    this.encoding = get_encoding("cl100k_base");
    
    // Initialize embedding model
    await this.initializeEmbeddingModel();
    
    // Create tables
    await this.createTables();
    
    console.error('✅ RAG-enabled knowledge graph initialized');
    
    // Log system info
    const systemInfo = getSystemInfo();
    console.error(`📊 System Info: ${systemInfo.toolCounts.total} tools available (${systemInfo.toolCounts.knowledgeGraph} knowledge graph, ${systemInfo.toolCounts.rag} RAG, ${systemInfo.toolCounts.graphQuery} query)`);
  }

  private async initializeEmbeddingModel() {
    try {
      console.error('🤖 Loading sentence transformer model: all-MiniLM-L12-v2...');
      
      this.embeddingModel = await pipeline(
        'feature-extraction',
        'sentence-transformers/all-MiniLM-L12-v2',
        { 
          revision: 'main',
        }
      );
      
      this.modelInitialized = true;
      console.error('✅ Sentence transformer model loaded successfully');
      
    } catch (error) {
      console.error('❌ Failed to load embedding model:', error);
      console.error('📋 Falling back to simple embedding generation');
      this.modelInitialized = false;
    }
  }

  private async createTables() {
    if (!this.db) throw new Error('Database not initialized');

    // Disable foreign key enforcement to make deletions easier
    this.db.pragma('foreign_keys = OFF');

    // Original entities table (enhanced)
    this.db.exec(`
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
    this.db.exec(`
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Vector embeddings using sqlite-vec
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING vec0(
        embedding FLOAT[384]
      )
    `);

    // Chunk metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_metadata (
        rowid INTEGER PRIMARY KEY,
        chunk_id TEXT UNIQUE,
        document_id TEXT,
        chunk_index INTEGER,
        text TEXT,
        start_pos INTEGER,
        end_pos INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `);

    // Chunk-Entity associations
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_entities (
        chunk_rowid INTEGER NOT NULL,
        entity_id TEXT NOT NULL,
        PRIMARY KEY (chunk_rowid, entity_id),
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (chunk_rowid) REFERENCES chunk_metadata(rowid) ON DELETE CASCADE
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity);
      CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity);
      CREATE INDEX IF NOT EXISTS idx_chunk_entities_entity ON chunk_entities(entity_id);
      CREATE INDEX IF NOT EXISTS idx_chunk_metadata_document ON chunk_metadata(document_id);
    `);

    console.error('🔧 Database tables created with relaxed FK constraints for easier deletion');
  }

  cleanup() {
    if (this.encoding) {
      this.encoding.free();
      this.encoding = null;
    }
    if (this.embeddingModel) {
      // Clean up the embedding model if it has cleanup methods
      this.embeddingModel = null;
      this.modelInitialized = false;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // === ORIGINAL MCP FUNCTIONALITY ===

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const newEntities = [];
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO entities (id, name, entityType, observations, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const entity of entities) {
      const entityId = `entity_${entity.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const observations = JSON.stringify(entity.observations || []);
      const metadata = JSON.stringify({});
      
      const result = stmt.run(entityId, entity.name, entity.entityType, observations, metadata);
      if (result.changes > 0) {
        newEntities.push(entity);
      }
    }

    return newEntities;
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const newRelations = [];
    
    for (const relation of relations) {
      // Ensure entities exist
      await this.createEntities([
        { name: relation.from, entityType: 'CONCEPT', observations: [] },
        { name: relation.to, entityType: 'CONCEPT', observations: [] }
      ]);
      
      const sourceId = `entity_${relation.from.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const targetId = `entity_${relation.to.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const relationId = `rel_${sourceId}_${relation.relationType}_${targetId}`.toLowerCase();
      
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO relationships 
        (id, source_entity, target_entity, relationType, confidence, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(relationId, sourceId, targetId, relation.relationType, 1.0, '{}');
      if (result.changes > 0) {
        newRelations.push(relation);
      }
    }

    return newRelations;
  }

  async addObservations(observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const results = [];
    
    for (const obs of observations) {
      const entityId = `entity_${obs.entityName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      
      // Get current observations
      const entity = this.db.prepare(`
        SELECT observations FROM entities WHERE id = ?
      `).get(entityId) as { observations: string } | undefined;
      
      if (!entity) {
        throw new Error(`Entity with name ${obs.entityName} not found`);
      }
      
      const currentObservations = JSON.parse(entity.observations);
      const newObservations = obs.contents.filter(content => !currentObservations.includes(content));
      
      if (newObservations.length > 0) {
        const updatedObservations = [...currentObservations, ...newObservations];
        
        this.db.prepare(`
          UPDATE entities SET observations = ? WHERE id = ?
        `).run(JSON.stringify(updatedObservations), entityId);
      }
      
      results.push({ entityName: obs.entityName, addedObservations: newObservations });
    }

    return results;
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`🗑️ Deleting entities: ${entityNames.join(', ')}`);
    
    for (const name of entityNames) {
      const entityId = `entity_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      
      try {
        // Check if entity exists first
        const entityExists = this.db.prepare(`
          SELECT id FROM entities WHERE id = ?
        `).get(entityId);
        
        if (!entityExists) {
          console.warn(`⚠️ Entity '${name}' not found, skipping`);
          continue;
        }
        
        // Step 1: Delete chunk-entity associations
        const chunkAssociations = this.db.prepare(`
          DELETE FROM chunk_entities WHERE entity_id = ?
        `).run(entityId);
        if (chunkAssociations.changes > 0) {
          console.error(`  ├─ Removed ${chunkAssociations.changes} chunk associations for '${name}'`);
        }
        
        // Step 2: Delete relationships where this entity is involved
        const relationships = this.db.prepare(`
          DELETE FROM relationships 
          WHERE source_entity = ? OR target_entity = ?
        `).run(entityId, entityId);
        if (relationships.changes > 0) {
          console.error(`  ├─ Removed ${relationships.changes} relationships for '${name}'`);
        }
        
        // Step 3: Finally delete the entity itself
        const entity = this.db.prepare(`
          DELETE FROM entities WHERE id = ?
        `).run(entityId);
        if (entity.changes > 0) {
          console.error(`  └─ Deleted entity '${name}' successfully`);
        } else {
          console.warn(`  └─ Entity '${name}' was not deleted (possibly already removed)`);
        }
        
      } catch (error) {
        console.error(`❌ Failed to delete entity '${name}':`, error);
        // Continue with other entities instead of failing completely
      }
    }
    
    console.error(`✅ Entity deletion process completed`);
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    for (const deletion of deletions) {
      const entityId = `entity_${deletion.entityName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      
      const entity = this.db.prepare(`
        SELECT observations FROM entities WHERE id = ?
      `).get(entityId) as { observations: string } | undefined;
      
      if (entity) {
        const currentObservations = JSON.parse(entity.observations);
        const filteredObservations = currentObservations.filter(
          (obs: string) => !deletion.observations.includes(obs)
        );
        
        this.db.prepare(`
          UPDATE entities SET observations = ? WHERE id = ?
        `).run(JSON.stringify(filteredObservations), entityId);
      }
    }
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    for (const relation of relations) {
      const sourceId = `entity_${relation.from.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const targetId = `entity_${relation.to.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      
      this.db.prepare(`
        DELETE FROM relationships 
        WHERE source_entity = ? AND target_entity = ? AND relationType = ?
      `).run(sourceId, targetId, relation.relationType);
    }
  }

  async readGraph(): Promise<KnowledgeGraph> {
    if (!this.db) throw new Error('Database not initialized');
    
    const entities = this.db.prepare(`
      SELECT name, entityType, observations FROM entities
    `).all().map((row: any) => ({
      name: row.name,
      entityType: row.entityType,
      observations: JSON.parse(row.observations)
    }));
    
    const relations = this.db.prepare(`
      SELECT 
        e1.name as from_name,
        e2.name as to_name,
        r.relationType
      FROM relationships r
      JOIN entities e1 ON r.source_entity = e1.id
      JOIN entities e2 ON r.target_entity = e2.id
    `).all().map((row: any) => ({
      from: row.from_name,
      to: row.to_name,
      relationType: row.relationType
    }));

    return { entities, relations };
  }

  async searchNodes(query: string): Promise<KnowledgeGraph> {
    if (!this.db) throw new Error('Database not initialized');
    
    const searchTerm = `%${query.toLowerCase()}%`;
    
    const entities = this.db.prepare(`
      SELECT name, entityType, observations FROM entities
      WHERE LOWER(name) LIKE ? OR LOWER(entityType) LIKE ? OR LOWER(observations) LIKE ?
    `).all(searchTerm, searchTerm, searchTerm).map((row: any) => ({
      name: row.name,
      entityType: row.entityType,
      observations: JSON.parse(row.observations)
    }));
    
    const entityNames = entities.map(e => e.name);
    if (entityNames.length === 0) {
      return { entities: [], relations: [] };
    }
    
    const relations = this.db.prepare(`
      SELECT 
        e1.name as from_name,
        e2.name as to_name,
        r.relationType
      FROM relationships r
      JOIN entities e1 ON r.source_entity = e1.id
      JOIN entities e2 ON r.target_entity = e2.id
      WHERE e1.name IN (${entityNames.map(() => '?').join(',')}) 
        AND e2.name IN (${entityNames.map(() => '?').join(',')})
    `).all(...entityNames, ...entityNames).map((row: any) => ({
      from: row.from_name,
      to: row.to_name,
      relationType: row.relationType
    }));

    return { entities, relations };
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    if (!this.db) throw new Error('Database not initialized');
    
    if (names.length === 0) {
      return { entities: [], relations: [] };
    }
    
    const entities = this.db.prepare(`
      SELECT name, entityType, observations FROM entities
      WHERE name IN (${names.map(() => '?').join(',')})
    `).all(...names).map((row: any) => ({
      name: row.name,
      entityType: row.entityType,
      observations: JSON.parse(row.observations)
    }));
    
    const relations = this.db.prepare(`
      SELECT 
        e1.name as from_name,
        e2.name as to_name,
        r.relationType
      FROM relationships r
      JOIN entities e1 ON r.source_entity = e1.id
      JOIN entities e2 ON r.target_entity = e2.id
      WHERE e1.name IN (${names.map(() => '?').join(',')}) 
        AND e2.name IN (${names.map(() => '?').join(',')})
    `).all(...names, ...names).map((row: any) => ({
      from: row.from_name,
      to: row.to_name,
      relationType: row.relationType
    }));

    return { entities, relations };
  }

  // === NEW RAG FUNCTIONALITY ===

  // Simple configurable term extraction (replacing hardcoded patterns)
  private extractTermsFromText(text: string, options: {
    minLength?: number;
    includeCapitalized?: boolean;
    customPatterns?: string[];
  } = {}): string[] {
    const { minLength = 3, includeCapitalized = true, customPatterns = [] } = options;
    const terms = new Set<string>();
    
    // Include capitalized words if requested
    if (includeCapitalized) {
      const capitalizedWords = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
      capitalizedWords.forEach(term => {
        if (term.length >= minLength) {
          terms.add(term.trim());
        }
      });
    }
    
    // Apply custom patterns if provided
    customPatterns.forEach(patternStr => {
      try {
        const pattern = new RegExp(patternStr, 'gi');
        const matches = text.match(pattern) || [];
        matches.forEach(match => {
          if (match.length >= minLength) {
            terms.add(match.trim());
          }
        });
      } catch (error) {
        console.error('Invalid regex pattern:', patternStr, error);
      }
    });
    
    return Array.from(terms);
  }

  // Tokenize and chunk text
  private chunkText(text: string, maxTokens = 200, overlap = 20): Chunk[] {
    if (!this.encoding) throw new Error('Tokenizer not initialized');
    
    const tokens = this.encoding.encode(text);
    const chunks: Chunk[] = [];
    
    for (let i = 0; i < tokens.length; i += maxTokens - overlap) {
      const chunkTokens = tokens.slice(i, i + maxTokens);
      const decodedBytes = this.encoding.decode(chunkTokens);
      const chunkText = new TextDecoder().decode(decodedBytes);
      
      chunks.push({
        id: '',
        document_id: '',
        chunk_index: chunks.length,
        text: chunkText,
        start_pos: i,
        end_pos: i + chunkTokens.length
      });
    }
    
    return chunks;
  }

  // Generate embeddings using sentence transformers
  private async generateEmbedding(text: string, dimensions = 384): Promise<Float32Array> {
    if (this.modelInitialized && this.embeddingModel) {
      try {
        // Use the real sentence transformer model
        const result = await this.embeddingModel(text, { pooling: 'mean', normalize: true });
        
        // Extract the embedding array and convert to Float32Array
        const embedding = result.data;
        return new Float32Array(embedding.slice(0, dimensions));
        
      } catch (error) {
        console.error('⚠️ Embedding model failed, falling back to simple embedding:', error);
        // Fall through to simple implementation
      }
    }
    
    // Fallback: Simple TF-IDF like approach (much simpler than the complex hash-based one)
    if (!this.encoding) {
      throw new Error('Tokenizer not initialized');
    }
    
    const tokens = this.encoding.encode(text);
    const embedding = new Array(dimensions).fill(0);
    
    // Simple approach: use token frequency
    const tokenCounts = new Map<number, number>();
    tokens.forEach((token: number) => {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    });
    
    // Create embedding based on token frequencies
    let idx = 0;
    for (const [token, count] of tokenCounts.entries()) {
      if (idx >= dimensions) break;
      embedding[idx % dimensions] += count / tokens.length;
      idx++;
    }
    
    // Normalize the embedding
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return new Float32Array(magnitude > 0 ? embedding.map(val => val / magnitude) : embedding);
  }

  // === NEW SEPARATE TOOLS ===

  async storeDocument(id: string, content: string, metadata: Record<string, any> = {}): Promise<{ id: string; stored: boolean }> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`📄 Storing document: ${id}`);
    
    // Clean up existing document
    await this.cleanupDocument(id);
    
    // Store document
    this.db.prepare(`
      INSERT OR REPLACE INTO documents (id, content, metadata)
      VALUES (?, ?, ?)
    `).run(id, content, JSON.stringify(metadata));
    
    console.error(`✅ Document stored: ${id}`);
    return { id, stored: true };
  }

  async chunkDocument(documentId: string, options: { maxTokens?: number; overlap?: number } = {}): Promise<{ documentId: string; chunks: Array<{ id: string; text: string; startPos: number; endPos: number }> }> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Get document
    const document = this.db.prepare(`
      SELECT content FROM documents WHERE id = ?
    `).get(documentId) as { content: string } | undefined;
    
    if (!document) {
      throw new Error(`Document with ID ${documentId} not found`);
    }
    
    const { maxTokens = 200, overlap = 20 } = options;
    
    console.error(`🔪 Chunking document: ${documentId} (maxTokens: ${maxTokens}, overlap: ${overlap})`);
    
    // Clean up existing chunks
    await this.cleanupDocument(documentId);
    
    // Create chunks
    const chunks = this.chunkText(document.content, maxTokens, overlap);
    const resultChunks = [];
    
    for (const chunk of chunks) {
      const chunkId = `${documentId}_chunk_${chunk.chunk_index}`;
      
      // Store chunk metadata (no embedding yet)
      this.db.prepare(`
        INSERT INTO chunk_metadata (
          chunk_id, document_id, chunk_index, text, start_pos, end_pos
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(chunkId, documentId, chunk.chunk_index, chunk.text, chunk.start_pos, chunk.end_pos);
      
      resultChunks.push({
        id: chunkId,
        text: chunk.text,
        startPos: chunk.start_pos,
        endPos: chunk.end_pos
      });
    }
    
    console.error(`✅ Document chunked: ${chunks.length} chunks created`);
    return { documentId, chunks: resultChunks };
  }

  async embedChunks(documentId: string): Promise<{ documentId: string; embeddedChunks: number }> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`🔮 Embedding chunks for document: ${documentId}`);
    
    // Get all chunks for the document
    const chunks = this.db.prepare(`
      SELECT rowid, chunk_id, text FROM chunk_metadata WHERE document_id = ?
    `).all(documentId) as Array<{ rowid: number; chunk_id: string; text: string }>;
    
    if (chunks.length === 0) {
      throw new Error(`No chunks found for document ${documentId}. Run chunkDocument first.`);
    }
    
    let embeddedCount = 0;
    
    for (const chunk of chunks) {
      // Generate embedding
      const embedding = await this.generateEmbedding(chunk.text);
      
      // Store in vector table - the vec0 table should auto-handle rowid matching
      try {
        // First, delete any existing embedding for this rowid
        this.db.prepare(`DELETE FROM chunks WHERE rowid = ?`).run(chunk.rowid);
        
        // Insert new embedding, letting vec0 handle the rowid
        const result = this.db.prepare(`
          INSERT INTO chunks (embedding) VALUES (?)
        `).run(Buffer.from(embedding.buffer));
        
        if (result.changes > 0) {
          embeddedCount++;
          // console.log(`✅ Embedded chunk ${chunk.chunk_id} with rowid ${result.lastInsertRowid}`);
        }
      } catch (error) {
        console.error(`Failed to embed chunk ${chunk.chunk_id}:`, error);
        // Continue with other chunks instead of failing completely
      }
    }
    
    console.error(`✅ Chunks embedded: ${embeddedCount} embeddings created`);
    return { documentId, embeddedChunks: embeddedCount };
  }

  async extractTerms(documentId: string, options: {
    minLength?: number;
    includeCapitalized?: boolean;
    customPatterns?: string[];
  } = {}): Promise<{ documentId: string; terms: string[] }> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Get document
    const document = this.db.prepare(`
      SELECT content FROM documents WHERE id = ?
    `).get(documentId) as { content: string } | undefined;
    
    if (!document) {
      throw new Error(`Document with ID ${documentId} not found`);
    }
    
    console.error(`🔍 Extracting terms from document: ${documentId}`);
    
    const terms = this.extractTermsFromText(document.content, options);
    
    console.error(`✅ Terms extracted: ${terms.length} terms found`);
    return { documentId, terms };
  }

  async linkEntitiesToDocument(documentId: string, entityNames: string[]): Promise<{ documentId: string; linkedEntities: number }> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`🔗 Linking entities to document: ${documentId}`);
    
    // Verify document exists
    const document = this.db.prepare(`
      SELECT id FROM documents WHERE id = ?
    `).get(documentId);
    
    if (!document) {
      throw new Error(`Document with ID ${documentId} not found`);
    }
    
    // Get chunks for this document
    const chunks = this.db.prepare(`
      SELECT rowid FROM chunk_metadata WHERE document_id = ?
    `).all(documentId) as Array<{ rowid: number }>;
    
    let linkedCount = 0;
    
    for (const entityName of entityNames) {
      const entityId = `entity_${entityName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      
      // Verify entity exists
      const entity = this.db.prepare(`
        SELECT id FROM entities WHERE id = ?
      `).get(entityId);
      
      if (!entity) {
        console.warn(`Entity ${entityName} not found, skipping`);
        continue;
      }
      
      // Link entity to all chunks of the document
      for (const chunk of chunks) {
        this.db.prepare(`
          INSERT OR IGNORE INTO chunk_entities (chunk_rowid, entity_id)
          VALUES (?, ?)
        `).run(chunk.rowid, entityId);
      }
      
      linkedCount++;
    }
    
    console.error(`✅ Entities linked: ${linkedCount} entities linked to document`);
    return { documentId, linkedEntities: linkedCount };
  }

  private async cleanupDocument(documentId: string): Promise<void> {
    if (!this.db) return;
    
    console.error(`🧹 Cleaning up document: ${documentId}`);
    
    // Get existing chunks
    const existingChunks = this.db.prepare(`
      SELECT rowid FROM chunk_metadata WHERE document_id = ?
    `).all(documentId) as { rowid: number }[];
    
    let deletedAssociations = 0;
    let deletedVectors = 0;
    
    // Delete associations and vectors
    for (const chunk of existingChunks) {
      // Delete chunk-entity associations
      const associations = this.db.prepare(`
        DELETE FROM chunk_entities WHERE chunk_rowid = ?
      `).run(chunk.rowid);
      deletedAssociations += associations.changes;
      
      // Delete vector embeddings
      const vectors = this.db.prepare(`
        DELETE FROM chunks WHERE rowid = ?
      `).run(chunk.rowid);
      deletedVectors += vectors.changes;
    }
    
    // Delete chunk metadata
    const metadata = this.db.prepare(`
      DELETE FROM chunk_metadata WHERE document_id = ?
    `).run(documentId);
    
    if (existingChunks.length > 0) {
      console.error(`  ├─ Deleted ${deletedAssociations} entity associations`);
      console.error(`  ├─ Deleted ${deletedVectors} vector embeddings`);
      console.error(`  └─ Deleted ${metadata.changes} chunk metadata records`);
    }
  }

  async deleteDocument(documentId: string): Promise<{ documentId: string; deleted: boolean }> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`🗑️ Deleting document: ${documentId}`);
    
    try {
      // Check if document exists
      const document = this.db.prepare(`
        SELECT id FROM documents WHERE id = ?
      `).get(documentId);
      
      if (!document) {
        console.warn(`⚠️ Document '${documentId}' not found`);
        return { documentId, deleted: false };
      }
      
      // Clean up all associated data
      await this.cleanupDocument(documentId);
      
      // Delete the document itself
      const result = this.db.prepare(`
        DELETE FROM documents WHERE id = ?
      `).run(documentId);
      
      if (result.changes > 0) {
        console.error(`✅ Document '${documentId}' deleted successfully`);
        return { documentId, deleted: true };
      } else {
        console.warn(`⚠️ Document '${documentId}' was not deleted`);
        return { documentId, deleted: false };
      }
      
    } catch (error) {
      console.error(`❌ Failed to delete document '${documentId}':`, error);
      throw error;
    }
  }

  async deleteMultipleDocuments(documentIds: string[]): Promise<{ results: Array<{ documentId: string; deleted: boolean }>; summary: { deleted: number; failed: number; total: number } }> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`🗑️ Bulk deleting ${documentIds.length} documents`);
    
    const results: Array<{ documentId: string; deleted: boolean }> = [];
    let deletedCount = 0;
    let failedCount = 0;
    
    for (const documentId of documentIds) {
      try {
        const result = await this.deleteDocument(documentId);
        results.push(result);
        if (result.deleted) {
          deletedCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        console.error(`❌ Failed to delete document '${documentId}':`, error);
        results.push({ documentId, deleted: false });
        failedCount++;
      }
    }
    
    const summary = {
      deleted: deletedCount,
      failed: failedCount,
      total: documentIds.length
    };
    
    console.error(`✅ Bulk deletion completed: ${deletedCount} deleted, ${failedCount} failed, ${documentIds.length} total`);
    
    return { results, summary };
  }

  async deleteDocuments(documentIds: string | string[]): Promise<{ results: Array<{ documentId: string; deleted: boolean }>; summary: { deleted: number; failed: number; total: number } }> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Normalize input to always be an array
    const idsArray = Array.isArray(documentIds) ? documentIds : [documentIds];
    const isMultiple = Array.isArray(documentIds);
    
    console.error(`🗑️ Deleting ${idsArray.length} document${idsArray.length > 1 ? 's' : ''}`);
    
    const results: Array<{ documentId: string; deleted: boolean }> = [];
    let deletedCount = 0;
    let failedCount = 0;
    
    for (const documentId of idsArray) {
      try {
        const result = await this.deleteDocument(documentId);
        results.push(result);
        if (result.deleted) {
          deletedCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        console.error(`❌ Failed to delete document '${documentId}':`, error);
        results.push({ documentId, deleted: false });
        failedCount++;
      }
    }
    
    const summary = {
      deleted: deletedCount,
      failed: failedCount,
      total: idsArray.length
    };
    
    const operation = isMultiple ? 'Bulk deletion' : 'Document deletion';
    console.error(`✅ ${operation} completed: ${deletedCount} deleted, ${failedCount} failed, ${idsArray.length} total`);
    
    return { results, summary };
  }

  async listDocuments(includeMetadata = true): Promise<{ documents: Array<{ id: string; metadata?: any; created_at: string }> }> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`📋 Listing all documents (metadata: ${includeMetadata})`);
    
    const query = includeMetadata 
      ? `SELECT id, metadata, created_at FROM documents ORDER BY created_at DESC`
      : `SELECT id, created_at FROM documents ORDER BY created_at DESC`;
    
    const rows = this.db.prepare(query).all() as Array<{ id: string; metadata?: string; created_at: string }>;
    
    const documents = rows.map(row => ({
      id: row.id,
      ...(includeMetadata && row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
      created_at: row.created_at
    }));
    
    console.error(`✅ Found ${documents.length} documents`);
    
    return { documents };
  }

  async hybridSearch(query: string, limit = 5, useGraph = true): Promise<SearchResult[]> {
    if (!this.db) throw new Error('Database not initialized');
    if (!this.encoding) throw new Error('Tokenizer not initialized');
    
    console.error(`🔍 Hybrid search: "${query}"`);
    
    // Vector search
    const queryTokens = this.encoding.encode(query);
    const queryEmbedding = await this.generateEmbedding(query);
    
    const vectorResults = this.db.prepare(`
      SELECT 
        c.rowid,
        m.chunk_id,
        m.document_id,
        m.chunk_index,
        m.text,
        m.start_pos,
        m.end_pos,
        c.distance,
        d.content as doc_content,
        d.metadata as doc_metadata
      FROM chunks c
      JOIN chunk_metadata m ON c.rowid = m.rowid
      JOIN documents d ON m.document_id = d.id
      WHERE c.embedding MATCH ?
        AND k = ?
      ORDER BY c.distance
    `).all(Buffer.from(queryEmbedding.buffer), limit * 2) as Array<{
      rowid: number;
      chunk_id: string;
      document_id: string;
      chunk_index: number;
      text: string;
      start_pos: number;
      end_pos: number;
      distance: number;
      doc_content: string;
      doc_metadata: string;
    }>;
    
    if (!useGraph) {
      return vectorResults.slice(0, limit).map((result) => ({
        chunk: {
          id: result.chunk_id,
          document_id: result.document_id,
          chunk_index: result.chunk_index,
          text: result.text,
          start_pos: result.start_pos,
          end_pos: result.end_pos
        },
        document: {
          id: result.document_id,
          content: result.doc_content,
          metadata: JSON.parse(result.doc_metadata),
          created_at: ''
        },
        entities: [],
        vector_similarity: 1 / (1 + result.distance),
        graph_boost: 0,
        hybrid_score: 1 / (1 + result.distance),
        distance: result.distance
      }));
    }
    
    // Graph enhancement
    const queryEntities = this.extractTermsFromText(query);
    const connectedEntities = new Set<string>();
    
    for (const entity of queryEntities) {
      const connected = this.db.prepare(`
        SELECT DISTINCT
          CASE 
            WHEN r.source_entity = e1.id THEN e2.name
            ELSE e1.name
          END as connected_name
        FROM entities e1
        JOIN relationships r ON (r.source_entity = e1.id OR r.target_entity = e1.id)
        JOIN entities e2 ON (e2.id = r.source_entity OR e2.id = r.target_entity)
        WHERE e1.name = ? AND e2.name != ?
      `).all(entity, entity) as { connected_name: string }[];
      
      connected.forEach((row) => connectedEntities.add(row.connected_name));
    }
    
    // Enhance results with graph information
    const enhancedResults: SearchResult[] = [];
    
    for (const result of vectorResults) {
      const chunkEntities = this.db.prepare(`
        SELECT e.name 
        FROM chunk_entities ce
        JOIN entities e ON e.id = ce.entity_id
        WHERE ce.chunk_rowid = ?
      `).all(result.rowid).map((row: any) => row.name);
      
      let graphBoost = 0;
      for (const entity of chunkEntities) {
        if (queryEntities.some(qe => qe.toLowerCase() === entity.toLowerCase())) {
          graphBoost += 0.3;
        }
        if (connectedEntities.has(entity)) {
          graphBoost += 0.1;
        }
      }
      
      const vectorSimilarity = 1 / (1 + result.distance);
      const hybridScore = vectorSimilarity + graphBoost;
      
      enhancedResults.push({
        chunk: {
          id: result.chunk_id,
          document_id: result.document_id,
          chunk_index: result.chunk_index,
          text: result.text,
          start_pos: result.start_pos,
          end_pos: result.end_pos
        },
        document: {
          id: result.document_id,
          content: result.doc_content,
          metadata: JSON.parse(result.doc_metadata),
          created_at: ''
        },
        entities: chunkEntities,
        vector_similarity: vectorSimilarity,
        graph_boost: graphBoost,
        hybrid_score: hybridScore,
        distance: result.distance
      });
    }
    
    return enhancedResults
      .sort((a, b) => b.hybrid_score - a.hybrid_score)
      .slice(0, limit);
  }

  async getKnowledgeGraphStats(): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');
    
    const entityStats = this.db.prepare(`
      SELECT entityType, COUNT(*) as count
      FROM entities
      GROUP BY entityType
    `).all() as { entityType: string; count: number }[];
    
    const relationshipStats = this.db.prepare(`
      SELECT relationType, COUNT(*) as count
      FROM relationships
      GROUP BY relationType
    `).all() as { relationType: string; count: number }[];
    
    const documentCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM documents
    `).get() as { count: number };
    
    const chunkCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM chunk_metadata
    `).get() as { count: number };
    
    return {
      entities: {
        total: entityStats.reduce((sum, stat) => sum + stat.count, 0),
        by_type: Object.fromEntries(entityStats.map(s => [s.entityType, s.count]))
      },
      relationships: {
        total: relationshipStats.reduce((sum, stat) => sum + stat.count, 0),
        by_type: Object.fromEntries(relationshipStats.map(s => [s.relationType, s.count]))
      },
      documents: documentCount.count,
      chunks: chunkCount.count
    };
  }
}

// Initialize the manager
const ragKgManager = new RAGKnowledgeGraphManager();

// MCP Server setup
const server = new Server({
  name: "rag-memory-server",
  version: "1.0.0",
}, {
    capabilities: {
      tools: {},
    },
});

// Use our new structured tool system for listing tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = getAllMCPTools();
  console.error(`📋 Serving ${tools.length} tools with comprehensive documentation`);
  return { tools };
});

// Enhanced tool call handler with validation
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  try {
    // Validate arguments using our structured schema
    const validatedArgs = validateToolArgs(name, args);
    
    switch (name) {
      // Original MCP tools
      case "createEntities":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.createEntities((validatedArgs as any).entities as Entity[]), null, 2) }] };
      case "createRelations":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.createRelations((validatedArgs as any).relations as Relation[]), null, 2) }] };
      case "addObservations":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.addObservations((validatedArgs as any).observations as { entityName: string; contents: string[] }[]), null, 2) }] };
      case "deleteEntities":
        await ragKgManager.deleteEntities((validatedArgs as any).entityNames as string[]);
        return { content: [{ type: "text", text: "Entities deleted successfully" }] };
      case "deleteObservations":
        await ragKgManager.deleteObservations((validatedArgs as any).deletions as { entityName: string; observations: string[] }[]);
        return { content: [{ type: "text", text: "Observations deleted successfully" }] };
      case "deleteRelations":
        await ragKgManager.deleteRelations((validatedArgs as any).relations as Relation[]);
        return { content: [{ type: "text", text: "Relations deleted successfully" }] };
      case "readGraph":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.readGraph(), null, 2) }] };
      case "searchNodes":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.searchNodes((validatedArgs as any).query as string), null, 2) }] };
      case "openNodes":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.openNodes((validatedArgs as any).names as string[]), null, 2) }] };
      
      // New RAG tools
      case "storeDocument":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.storeDocument((validatedArgs as any).id as string, (validatedArgs as any).content as string, (validatedArgs as any).metadata || {}), null, 2) }] };
      case "chunkDocument":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.chunkDocument((validatedArgs as any).documentId as string, { maxTokens: (validatedArgs as any).maxTokens, overlap: (validatedArgs as any).overlap }), null, 2) }] };
      case "embedChunks":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.embedChunks((validatedArgs as any).documentId as string), null, 2) }] };
      case "extractTerms":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.extractTerms((validatedArgs as any).documentId as string, { minLength: (validatedArgs as any).minLength, includeCapitalized: (validatedArgs as any).includeCapitalized, customPatterns: (validatedArgs as any).customPatterns }), null, 2) }] };
      case "linkEntitiesToDocument":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.linkEntitiesToDocument((validatedArgs as any).documentId as string, (validatedArgs as any).entityNames as string[]), null, 2) }] };
      case "hybridSearch":
        const limit = typeof (validatedArgs as any).limit === 'number' ? (validatedArgs as any).limit : 5;
        const useGraph = (validatedArgs as any).useGraph !== false;
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.hybridSearch((validatedArgs as any).query as string, limit, useGraph), null, 2) }] };
      case "getKnowledgeGraphStats":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.getKnowledgeGraphStats(), null, 2) }] };
      case "deleteDocuments":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.deleteDocuments((validatedArgs as any).documentIds as string | string[]), null, 2) }] };
      case "listDocuments":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.listDocuments((validatedArgs as any).includeMetadata !== false), null, 2) }] };
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Tool execution error for ${name}:`, error.message);
      return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    }
    throw error;
  }
});

async function main() {
  try {
    await ragKgManager.initialize();
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🚀 Enhanced RAG Knowledge Graph MCP Server running on stdio");
    
    // Cleanup on exit
    process.on('SIGINT', () => {
      console.error('\n🧹 Cleaning up...');
      ragKgManager.cleanup();
      process.exit(0);
    });
    
  } catch (error) {
    console.error("Failed to initialize server:", error);
    ragKgManager.cleanup();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  ragKgManager.cleanup();
  process.exit(1);
});
