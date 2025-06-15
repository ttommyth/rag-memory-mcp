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

// Import migration system
import { MigrationManager } from './src/migrations/migration-manager.js';
import { migrations } from './src/migrations/migrations.js';
import { MultiDbMigrationManager } from './src/database/multi-db-migration-manager.js';
import { multiDbMigrations } from './src/database/multi-db-migrations.js';

// Import database abstraction layer
import { DatabaseFactory } from './src/database/database-factory.js';
import { ConfigManager } from './src/database/config-manager.js';
import { DatabaseAdapter, DatabaseConfig } from './src/database/interfaces.js';

// Configure Hugging Face transformers for better compatibility
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = './node_modules/@huggingface/transformers/dist/';
}

// Database configuration setup - now using database factory with environment-based selection
const configManager = new ConfigManager();
let dbConfig: DatabaseConfig;

// Enhanced DB_TYPE environment variable handling with better error messages
const dbType = process.env.DB_TYPE?.toLowerCase();
console.error(`🔧 Database Type Configuration: ${dbType || 'not set (defaulting to SQLite)'}`);  

// Load database configuration based on DB_TYPE environment variable
if (dbType && dbType !== 'sqlite') {
  // User explicitly requested a specific database type
  try {
    dbConfig = configManager.loadFromEnvironment();
    console.error(`✅ Database configuration loaded successfully: ${dbConfig.type}`);
  } catch (error) {
    console.error(`❌ Failed to load ${dbType.toUpperCase()} configuration from environment variables:`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    
    if (dbType === 'postgresql') {
      console.error(`   Required PostgreSQL environment variables:`);
      console.error(`   - PG_HOST (PostgreSQL server host)`);
      console.error(`   - PG_PORT (PostgreSQL server port, e.g., 5432)`);
      console.error(`   - PG_DATABASE (database name)`);
      console.error(`   - PG_USERNAME (database username)`);
      console.error(`   - PG_PASSWORD (database password)`);
      console.error(`   Optional: PG_SSL (SSL configuration)`);
    }
    
    console.error(`   Falling back to SQLite for compatibility`);
    dbConfig = createSQLiteFallbackConfig();
  }
} else {
  // No DB_TYPE specified or explicitly SQLite - use SQLite with environment customization
  console.error('📋 Using SQLite database (default or DB_TYPE=sqlite)');
  dbConfig = createSQLiteFallbackConfig();
}

// Helper function to create SQLite fallback configuration
function createSQLiteFallbackConfig(): DatabaseConfig {
  const defaultDbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rag-memory.db');
  const DB_FILE_PATH = process.env.DB_FILE_PATH
    ? path.isAbsolute(process.env.DB_FILE_PATH)
      ? process.env.DB_FILE_PATH
      : path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.DB_FILE_PATH)
    : defaultDbPath;
  
  console.error(`📁 SQLite database path: ${DB_FILE_PATH}`);
  
  return {
    type: 'sqlite',
    vectorDimensions: parseInt(process.env.VECTOR_DIMENSIONS || '384'),
    sqlite: {
      filePath: DB_FILE_PATH,
      enableWAL: process.env.SQLITE_ENABLE_WAL !== 'false',
      pragmas: {
        busy_timeout: parseInt(process.env.SQLITE_BUSY_TIMEOUT || '5000'),
        cache_size: parseInt(process.env.SQLITE_CACHE_SIZE || '-2000')
      }
    }
  };
}

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

// NEW: Enhanced chunk types to support knowledge graph chunks
interface KnowledgeGraphChunk {
  id: string;
  type: 'entity' | 'relationship';
  entity_id?: string;
  relationship_id?: string;
  text: string;
  metadata: Record<string, any>;
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

// NEW: Enhanced search result with semantic summaries
interface EnhancedSearchResult {
  relevance_score: number;
  key_highlight: string;
  content_summary: string;
  chunk_id: string;
  document_title: string;
  entities: string[];
  vector_similarity: number;
  graph_boost?: number;
  full_context_available: boolean;
  chunk_type: 'document' | 'entity' | 'relationship'; // NEW: Indicates the source type
  source_id?: string; // NEW: ID of the source entity/relationship if applicable
}

// NEW: Interface for detailed context retrieval
interface DetailedContext {
  chunk_id: string;
  document_id: string;
  full_text: string;
  document_title: string;
  surrounding_chunks?: Array<{
    chunk_id: string;
    text: string;
    position: 'before' | 'after';
  }>;
  entities: string[];
  metadata: Record<string, any>;
}

// Enhanced RAG-enabled Knowledge Graph Manager
class RAGKnowledgeGraphManager {
  private dbAdapter: DatabaseAdapter | null = null;
  private db: Database.Database | null = null;
  private encoding: any = null;
  private embeddingModel: any = null;
  private modelInitialized: boolean = false;

  async initialize() {
    console.error('🚀 Initializing RAG Knowledge Graph MCP Server...');
    
    try {
      // Initialize database using factory pattern for PostgreSQL only
      // SQLite adapter has incomplete implementation, so use legacy path
      if (dbConfig.type === 'postgresql') {
        console.error('🔧 Creating PostgreSQL database adapter...');
        const factory = DatabaseFactory.getInstance();
        this.dbAdapter = await factory.createAdapter(dbConfig);
        console.error(`✅ PostgreSQL database adapter created: ${!!this.dbAdapter}`);
      } else {
        console.error('🔧 Using SQLite legacy implementation (adapter not fully implemented)');
        this.dbAdapter = null;
      }
      
      // For SQLite compatibility, maintain legacy db reference
      if (dbConfig.type === 'sqlite') {
        this.db = new Database((dbConfig as any).sqlite.filePath);
        sqliteVec.load(this.db);
        console.error('✅ SQLite database with vector extension loaded');
      }
      
      console.error('✅ Database initialization completed');
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
    
    // Initialize tiktoken
    this.encoding = get_encoding("cl100k_base");
    
    // Initialize embedding model
    await this.initializeEmbeddingModel();
    
    // Run database migrations
    await this.runMigrations();
    
    console.error('✅ RAG-enabled knowledge graph initialized');
    
    // Log system info
    const systemInfo = getSystemInfo();
    console.error(`📊 System Info: ${systemInfo.toolCounts.total} tools available (${systemInfo.toolCounts.knowledgeGraph} knowledge graph, ${systemInfo.toolCounts.rag} RAG, ${systemInfo.toolCounts.graphQuery} query)`);
  }

  private async initializeEmbeddingModel() {
    try {
      console.error('🤖 Loading sentence transformer model: all-MiniLM-L12-v2...');
      
      // Configure environment to allow remote model downloads
      env.allowRemoteModels = true;
      env.allowLocalModels = true;
      
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

  async runMigrations(): Promise<{ applied: number; currentVersion: number; appliedMigrations: Array<{ version: number; description: string }> }> {
    console.error('🔄 Running database migrations...');
    
    // Use database adapter migrations if available, otherwise fallback to legacy
    if (this.dbAdapter) {
      try {
        // Use MultiDbMigrationManager for PostgreSQL
        const migrationManager = new MultiDbMigrationManager(this.dbAdapter);
        
        // Add all multi-database migrations
        multiDbMigrations.forEach(migration => {
          migrationManager.addMigration(migration);
        });
        
        const result = await migrationManager.runMigrations();
        console.error(`🔧 Database schema ready (version ${result.currentVersion}, ${result.applied} migrations applied)`);
        
        return {
          applied: result.applied,
          currentVersion: result.currentVersion,
          appliedMigrations: multiDbMigrations.slice(0, result.applied).map(m => ({
            version: m.version,
            description: m.description
          }))
        };
      } catch (error) {
        console.error('❌ PostgreSQL adapter migration failed:', error);
        throw error;
      }
    } else {
      // SQLite legacy migration system
      if (!this.db) {
        throw new Error('SQLite database not available');
      }
      
      const migrationManager = new MigrationManager(this.db);
      
      // Add all migrations
      migrations.forEach(migration => {
        migrationManager.addMigration(migration);
      });
      
      // Get pending migrations before running them
      const pendingBefore = migrationManager.getPendingMigrations();
      
      // Run pending migrations
      const result = await migrationManager.runMigrations();
      
      console.error(`🔧 Database schema ready (version ${result.currentVersion}, ${result.applied} migrations applied)`);
      
      return {
        applied: result.applied,
        currentVersion: result.currentVersion,
        appliedMigrations: pendingBefore.slice(0, result.applied).map(m => ({
          version: m.version,
          description: m.description
        }))
      };
    }
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
    if (this.dbAdapter) {
      this.dbAdapter.close();
      this.dbAdapter = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // === ORIGINAL MCP FUNCTIONALITY ===

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    // Use database adapter if available
    if (this.dbAdapter) {
      return await this.dbAdapter.createEntities(entities);
    }
    
    // SQLite implementation
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
        
        // Generate embedding for the new entity
        console.error(`🔮 Generating embedding for new entity: ${entity.name}`);
        await this.embedEntity(entityId);
      }
    }

    return newEntities;
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    // PostgreSQL database adapter fallback
    if (this.dbAdapter) {
      console.error('🐘 Using PostgreSQL adapter for createRelations');
      await this.dbAdapter.createRelations(relations);
      return relations; // Return the input relations as created
    }
    
    // SQLite implementation
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
    // PostgreSQL database adapter fallback
    if (this.dbAdapter) {
      console.error('🐘 Using PostgreSQL adapter for addObservations');
      const observationAdditions = observations.map(obs => ({
        entityName: obs.entityName,
        contents: obs.contents
      }));
      await this.dbAdapter.addObservations(observationAdditions);
      // Return expected format for compatibility
      return observations.map(obs => ({
        entityName: obs.entityName,
        addedObservations: obs.contents
      }));
    }
    
    // SQLite implementation
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
        
        // Regenerate embedding for the updated entity
        console.error(`🔮 Regenerating embedding for updated entity: ${obs.entityName}`);
        await this.embedEntity(entityId);
      }
      
      results.push({ entityName: obs.entityName, addedObservations: newObservations });
    }

    return results;
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    // PostgreSQL database adapter fallback
    if (this.dbAdapter) {
      console.error('🐘 Using PostgreSQL adapter for deleteEntities');
      return await this.dbAdapter.deleteEntities(entityNames);
    }
    
    // SQLite implementation
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
        
        // Step 0: Delete entity embeddings
        const embeddingMetadata = this.db.prepare(`
          SELECT rowid FROM entity_embedding_metadata WHERE entity_id = ?
        `).get(entityId) as { rowid: number } | undefined;
        
        if (embeddingMetadata) {
          const embeddings = this.db.prepare(`
            DELETE FROM entity_embeddings WHERE rowid = ?
          `).run(embeddingMetadata.rowid);
          
          const metadata = this.db.prepare(`
            DELETE FROM entity_embedding_metadata WHERE entity_id = ?
          `).run(entityId);
          
          if (embeddings.changes > 0 || metadata.changes > 0) {
            console.error(`  ├─ Removed entity embeddings for '${name}'`);
          }
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
    // Use database adapter if available
     if (this.dbAdapter) {
      await this.dbAdapter.deleteObservations(deletions);
      return;
    }
    
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
    // Use database adapter if available
    if (this.dbAdapter) {
      return await this.dbAdapter.deleteRelations(relations);
    }
    
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
    // PostgreSQL database adapter fallback
    if (this.dbAdapter) {
      console.error('🐘 Using PostgreSQL adapter for readGraph');
      return await this.dbAdapter.readGraph();
    }
    
    // SQLite implementation
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

  async searchNodes(
    query: string, 
    limit = 10, 
    nodeTypesToSearch: Array<'entity' | 'documentChunk'> = ['entity', 'documentChunk']
  ): Promise<KnowledgeGraph & { documentChunks?: any[] }> { // Extend return type for document chunks
    // PostgreSQL database adapter fallback
    if (this.dbAdapter) {
      return await this.dbAdapter.searchNodes(query, limit);
    }
    
    // SQLite implementation
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`🔍 Semantic node search: "${query}", types: ${nodeTypesToSearch.join(', ')}`);
    const queryEmbedding = await this.generateEmbedding(query);

    const results: KnowledgeGraph & { documentChunks?: any[] } = { entities: [], relations: [], documentChunks: [] };

    if (nodeTypesToSearch.includes('entity')) {
      const entityResults = this.db.prepare(`
        SELECT 
          eem.entity_id,
          eem.embedding_text,
          ee.distance,
          e.name,
          e.entityType,
          e.observations
        FROM entity_embeddings ee
        JOIN entity_embedding_metadata eem ON ee.entity_id = eem.entity_id
        JOIN entities e ON eem.entity_id = e.id
        WHERE ee.embedding MATCH ?
          AND k = ?
        ORDER BY ee.distance
      `).all(Buffer.from(queryEmbedding.buffer), limit) as Array<{
        entity_id: string;
        embedding_text: string;
        distance: number;
        name: string;
        entityType: string;
        observations: string;
      }>;

      if (entityResults.length > 0) {
        const foundEntities = entityResults.map(result => ({
          name: result.name,
          entityType: result.entityType,
          observations: JSON.parse(result.observations),
          similarity: 1 / (1 + result.distance) 
        }));
        results.entities.push(...foundEntities);

        const entityNames = foundEntities.map(e => e.name);
        if (entityNames.length > 0) {
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
          results.relations.push(...relations);
        }
      }
      console.error(`✅ Found ${results.entities.length} entities and ${results.relations.length} related relations.`);
    }

    if (nodeTypesToSearch.includes('documentChunk')) {
      const chunkLimit = limit - (results.entities.length); // Adjust limit if entities were found
      if (chunkLimit > 0) {
        const chunkResults = this.db.prepare(`
          SELECT 
            m.chunk_id,
            m.document_id,
            m.text,
            m.chunk_type,
            c.distance,
            d.metadata as document_metadata_json
          FROM chunks c
          JOIN chunk_metadata m ON c.chunk_id = m.chunk_id
          LEFT JOIN documents d ON m.document_id = d.id
          WHERE c.embedding MATCH ? 
            AND m.chunk_type = 'document'
            AND k = ? 
          ORDER BY c.distance
        `).all(Buffer.from(queryEmbedding.buffer), chunkLimit) as Array<{
          chunk_id: string;
          document_id: string;
          text: string;
          chunk_type: string;
          distance: number;
          document_metadata_json: string;
        }>;

        if (chunkResults.length > 0) {
          const foundChunks = chunkResults.map(r => ({
            chunk_id: r.chunk_id,
            document_id: r.document_id,
            text: r.text,
            similarity: 1 / (1 + r.distance),
            document_metadata: JSON.parse(r.document_metadata_json || '{}')
          }));
          results.documentChunks?.push(...foundChunks);
        }
        console.error(`✅ Found ${results.documentChunks?.length || 0} document chunks.`);
      }
    }
    return results;
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    // Use database adapter if available
    if (this.dbAdapter) {
      return await this.dbAdapter.openNodes(names);
    }
    
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

  // Generate embedding text for an entity (combines name, type, and observations)
  private generateEntityEmbeddingText(entity: { name: string; entityType: string; observations: string[] }): string {
    const observationsText = entity.observations.join('. ');
    return `${entity.name}. Type: ${entity.entityType}. ${observationsText}`.trim();
  }

  // NEW: Generic semantic summary generation methods
  private splitIntoSentences(text: string): string[] {
    // Split on sentence boundaries while preserving structure
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 10) // Filter out very short fragments
      .map(s => s.replace(/^\s*[-•]\s*/, '')); // Clean up list markers
  }

  private async calculateSentenceSimilarities(sentences: string[], queryEmbedding: Float32Array): Promise<number[]> {
    const similarities: number[] = [];
    
    for (const sentence of sentences) {
      const sentenceEmbedding = await this.generateEmbedding(sentence);
      const similarity = this.cosineSimilarity(queryEmbedding, sentenceEmbedding);
      similarities.push(similarity);
    }
    
    return similarities;
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private enhanceSimilarityWithContext(similarities: number[], sentences: string[], entities: string[]): number[] {
    const enhanced = [...similarities];
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].toLowerCase();
      let contextBoost = 0;
      
      // Generic boost for entity mentions (works across all domains)
      for (const entity of entities) {
        if (sentence.includes(entity.toLowerCase())) {
          contextBoost += 0.1; // Moderate boost for entity relevance
        }
      }
      
      // Generic boost for sentences with numbers (often contain key facts)
      if (/\b\d+/.test(sentence)) {
        contextBoost += 0.05;
      }
      
      // Generic boost for sentences with specific keywords that often indicate importance
      const importanceWords = ['important', 'key', 'main', 'primary', 'essential', 'critical', 'significant'];
      for (const word of importanceWords) {
        if (sentence.includes(word)) {
          contextBoost += 0.03;
          break; // Only boost once per sentence
        }
      }
      
      enhanced[i] += contextBoost;
    }
    
    return enhanced;
  }

  private async generateContentSummary(
    chunkText: string, 
    queryEmbedding: Float32Array, 
    entities: string[], 
    maxSentences = 2
  ): Promise<{ summary: string; keyHighlight: string; relevanceScore: number }> {
    
    const sentences = this.splitIntoSentences(chunkText);
    
    if (sentences.length === 0) {
      return {
        summary: chunkText.substring(0, 150) + (chunkText.length > 150 ? '...' : ''),
        keyHighlight: chunkText.substring(0, 100) + (chunkText.length > 100 ? '...' : ''),
        relevanceScore: 0.1
      };
    }
    
    // Calculate semantic similarities
    const similarities = await this.calculateSentenceSimilarities(sentences, queryEmbedding);
    
    // Apply generic context enhancement
    const enhancedSimilarities = this.enhanceSimilarityWithContext(similarities, sentences, entities);
    
    // Rank sentences by relevance
    const rankedIndices = Array.from({ length: sentences.length }, (_, i) => i)
      .sort((a, b) => enhancedSimilarities[b] - enhancedSimilarities[a]);
    
    // Select top sentences with diversity (avoid adjacent sentences)
    const selectedSentences: Array<{ text: string; score: number; index: number }> = [];
    const usedIndices = new Set<number>();
    
    for (const idx of rankedIndices) {
      if (selectedSentences.length >= maxSentences) break;
      
      // Prefer non-adjacent sentences for better coverage
      const hasAdjacent = Array.from(usedIndices).some(usedIdx => Math.abs(idx - usedIdx) <= 1);
      
      if (!hasAdjacent || selectedSentences.length === 0) {
        selectedSentences.push({
          text: sentences[idx],
          score: enhancedSimilarities[idx],
          index: idx
        });
        usedIndices.add(idx);
      }
    }
    
    // Fallback: if still empty, take the top sentence regardless of adjacency
    if (selectedSentences.length === 0) {
      selectedSentences.push({
        text: sentences[rankedIndices[0]],
        score: enhancedSimilarities[rankedIndices[0]],
        index: rankedIndices[0]
      });
    }
    
    // Create summary
    const keyHighlight = selectedSentences[0].text;
    
    let summary: string;
    if (selectedSentences.length === 1) {
      summary = selectedSentences[0].text;
    } else {
      // Sort by original order for coherent reading
      const orderedSentences = selectedSentences
        .sort((a, b) => a.index - b.index)
        .map(s => s.text);
      summary = orderedSentences.join(' [...] ');
    }
    
    const maxRelevanceScore = Math.max(...enhancedSimilarities);
    
    return {
      summary: summary,
      keyHighlight: keyHighlight,
      relevanceScore: maxRelevanceScore
    };
  }

  // Generate and store embedding for a single entity
  private async embedEntity(entityId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');
    if (!this.modelInitialized) {
      console.warn('⚠️ Embedding model not initialized. Skipping entity embedding.');
      return false;
    }

    try {
      const entityRow = this.db.prepare('SELECT name, entityType, observations FROM entities WHERE id = ?').get(entityId) as { name: string; entityType: string; observations: string };
      if (!entityRow) {
        console.warn(`Entity with ID ${entityId} not found for embedding.`);
        return false;
      }

      const observations = JSON.parse(entityRow.observations || '[]');
      const entity_embedding_text = this.generateEntityChunkText(entityRow.name, entityRow.entityType, observations);

      if (!entity_embedding_text.trim()) {
        console.warn(`🚫 No content to embed for entity: ${entityRow.name} (ID: ${entityId})`);
        return false;
      }
      
      const embedding = await this.generateEmbedding(entity_embedding_text);
      if (!embedding || embedding.length === 0) {
        console.warn(`🚫 Failed to generate embedding for entity: ${entityRow.name} (ID: ${entityId})`);
        return false;
      }

      // Store entity embedding metadata first
      const metaStmt = this.db.prepare(`
        INSERT OR REPLACE INTO entity_embedding_metadata (entity_id, embedding_text)
        VALUES (?, ?)
      `);
      metaStmt.run(entityId, entity_embedding_text);

      // Insert into the new entity_embeddings virtual table
      const vecStmt = this.db.prepare(`
        INSERT INTO entity_embeddings (entity_id, embedding) 
        VALUES (?, ?)
      `);
      vecStmt.run(entityId, embedding);

      console.error(`✅ Embedded entity: ${entityRow.name} (ID: ${entityId})`);
      return true;
    } catch (error) {
      console.error(`Error embedding entity ${entityId}:`, error);
      return false;
    }
  }

  // Embed all entities in the knowledge graph
  async embedAllEntities(): Promise<{ totalEntities: number; embeddedEntities: number }> {
    if (this.dbAdapter) {
      const result = await this.dbAdapter.embedAllEntities();
      return {
        totalEntities: result.totalEntities || 0,
        embeddedEntities: result.embeddedEntities || 0
      };
    }
    
    if (!this.db) throw new Error('Database not initialized');
    
    console.error('🔮 Generating embeddings for all entities...');
    
    const entities = this.db.prepare(`
      SELECT id FROM entities
    `).all() as Array<{ id: string }>;
    
    let embeddedCount = 0;
    
    for (const entity of entities) {
      const success = await this.embedEntity(entity.id);
      if (success) {
        embeddedCount++;
      }
    }
    
    console.error(`✅ Entity embeddings completed: ${embeddedCount}/${entities.length} entities embedded`);
    
    return {
      totalEntities: entities.length,
      embeddedEntities: embeddedCount
    };
  }

  async reEmbedEverything(): Promise<{ 
    totalEntitiesReEmbedded: number; 
    totalDocumentsProcessed: number; 
    totalDocumentChunksReEmbedded: number; 
    totalKnowledgeGraphChunksReEmbedded: number; 
  }> {
    if (this.dbAdapter) {
      console.error('🚀 Starting full re-embedding process (using database adapter)...');
      
      let totalEntitiesReEmbedded = 0;
      let totalDocumentsProcessed = 0;
      let totalDocumentChunksReEmbedded = 0;
      let totalKnowledgeGraphChunksReEmbedded = 0; // Will be 0 for non-SQLite

      // 1. Re-embed all entities
      const entityEmbeddingResult = await this.embedAllEntities();
      totalEntitiesReEmbedded = entityEmbeddingResult.embeddedEntities;
      console.error(`✅ Entities re-embedded: ${totalEntitiesReEmbedded}/${entityEmbeddingResult.totalEntities}`);

      // 2. Re-embed all document chunks
      console.error('📚 Re-embedding all document chunks...');
      const documentsResult = await this.listDocuments(false); // Get only IDs
      const documentIds = documentsResult.documents.map(doc => doc.id);
      
      for (const docId of documentIds) {
        try {
          console.error(`  📄 Processing document: ${docId}`);
          const chunkEmbedResult = await this.embedChunks(docId);
          totalDocumentChunksReEmbedded += chunkEmbedResult.embeddedChunks;
          totalDocumentsProcessed++;
        } catch (error) {
          console.error(`  ❌ Error re-embedding document ${docId}:`, error);
        }
      }
      console.error(`✅ Document chunks re-embedded: ${totalDocumentChunksReEmbedded} chunks across ${totalDocumentsProcessed} documents.`);

      // Note: Knowledge graph chunks are SQLite-specific, so they're skipped for database adapters
      console.error('ℹ️ Knowledge graph chunks are not supported with database adapters');

      console.error('🚀 Full re-embedding process completed (database adapter mode).');
      return {
        totalEntitiesReEmbedded,
        totalDocumentsProcessed,
        totalDocumentChunksReEmbedded,
        totalKnowledgeGraphChunksReEmbedded // 0 for database adapters
      };
    }
    
    if (!this.db) throw new Error('Database not initialized');
    console.error('🚀 Starting full re-embedding process...');

    let totalEntitiesReEmbedded = 0;
    let totalDocumentsProcessed = 0;
    let totalDocumentChunksReEmbedded = 0;
    let totalKnowledgeGraphChunksReEmbedded = 0;

    // 1. Re-embed all entities
    const entityEmbeddingResult = await this.embedAllEntities();
    totalEntitiesReEmbedded = entityEmbeddingResult.embeddedEntities;
    console.error(`✅ Entities re-embedded: ${totalEntitiesReEmbedded}/${entityEmbeddingResult.totalEntities}`);

    // 2. Re-embed all document chunks
    console.error('📚 Re-embedding all document chunks...');
    const documentsResult = await this.listDocuments(false); // Get only IDs
    const documentIds = documentsResult.documents.map(doc => doc.id);
    
    for (const docId of documentIds) {
      try {
        console.error(`  📄 Processing document: ${docId}`);
        // First, re-chunk the document to ensure chunks are up-to-date with current logic
        // Note: storeDocument handles chunking and then embedding.
        // To ensure re-embedding with potentially updated chunking logic, we can call storeDocument.
        // However, storeDocument also re-extracts entities, which might be too much.
        // A safer approach is to re-chunk and then re-embed existing chunk definitions.
        // For simplicity now, let's assume chunk definitions are stable and just re-embed them.
        // If chunking logic can change, storeDocument or a more complex flow would be needed.

        // Option A: Re-embed existing chunks (simpler, assumes chunk definitions are current)
        const chunkEmbedResult = await this.embedChunks(docId);
        totalDocumentChunksReEmbedded += chunkEmbedResult.embeddedChunks;
        totalDocumentsProcessed++;

        // Option B: Re-process document (more thorough, re-chunks then embeds - if storeDocument is suitable)
        // const docData = this.db.prepare('SELECT content, metadata FROM documents WHERE id = ?').get(docId) as { content: string, metadata: string };
        // if (docData) {
        //   await this.storeDocument(docId, docData.content, JSON.parse(docData.metadata));
        //   // Need a way to count chunks embedded by storeDocument if we use this.
        //   totalDocumentsProcessed++;
        // } else {
        //   console.warn(`  ⚠️ Document ${docId} not found for re-processing.`);
        // }

      } catch (error) {
        console.error(`  ❌ Error re-embedding document ${docId}:`, error);
      }
    }
    console.error(`✅ Document chunks re-embedded: ${totalDocumentChunksReEmbedded} chunks across ${totalDocumentsProcessed} documents.`);

    // 3. Re-embed all knowledge graph chunks
    // Ensure KG chunks are generated first if they can be out of sync
    console.error('🧠 Generating and re-embedding knowledge graph chunks...');
    await this.generateKnowledgeGraphChunks(); // This cleans up old KG chunks and generates new ones
    const kgChunkEmbedResult = await this.embedKnowledgeGraphChunks();
    totalKnowledgeGraphChunksReEmbedded = kgChunkEmbedResult.embeddedChunks;
    console.error(`✅ Knowledge graph chunks re-embedded: ${totalKnowledgeGraphChunksReEmbedded}`);

    console.error('🚀 Full re-embedding process completed.');
    return {
      totalEntitiesReEmbedded,
      totalDocumentsProcessed,
      totalDocumentChunksReEmbedded,
      totalKnowledgeGraphChunksReEmbedded,
    };
  }

  // NEW: Generate knowledge graph chunks for entities and relationships
  async generateKnowledgeGraphChunks(): Promise<{ entityChunks: number; relationshipChunks: number }> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.error('🧠 Generating knowledge graph chunks...');
    
    // Clean up existing knowledge graph chunks
    await this.cleanupKnowledgeGraphChunks();
    
    let entityChunks = 0;
    let relationshipChunks = 0;
    
    // Generate entity chunks
    const entities = this.db.prepare(`
      SELECT id, name, entityType, observations FROM entities
    `).all() as Array<{ id: string; name: string; entityType: string; observations: string }>;
    
    for (const entity of entities) {
      const observations = JSON.parse(entity.observations);
      const chunkText = this.generateEntityChunkText(entity.name, entity.entityType, observations);
      const chunkId = `kg_entity_${entity.id}`;
      
      // Store chunk metadata
      this.db.prepare(`
        INSERT INTO chunk_metadata (
          chunk_id, chunk_type, entity_id, chunk_index, text, start_pos, end_pos, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(chunkId, 'entity', entity.id, 0, chunkText, 0, chunkText.length, JSON.stringify({
        entity_name: entity.name,
        entity_type: entity.entityType
      }));
      
      entityChunks++;
    }
    
    // Generate relationship chunks
    const relationships = this.db.prepare(`
      SELECT 
        r.id,
        r.relationType,
        e1.name as source_name,
        e2.name as target_name,
        r.confidence
      FROM relationships r
      JOIN entities e1 ON r.source_entity = e1.id
      JOIN entities e2 ON r.target_entity = e2.id
    `).all() as Array<{ 
      id: string; 
      relationType: string; 
      source_name: string; 
      target_name: string; 
      confidence: number;
    }>;
    
    for (const rel of relationships) {
      const chunkText = this.generateRelationshipChunkText(rel.source_name, rel.target_name, rel.relationType);
      const chunkId = `kg_relationship_${rel.id}`;
      
      // Store chunk metadata
      this.db.prepare(`
        INSERT INTO chunk_metadata (
          chunk_id, chunk_type, relationship_id, chunk_index, text, start_pos, end_pos, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(chunkId, 'relationship', rel.id, 0, chunkText, 0, chunkText.length, JSON.stringify({
        source_entity: rel.source_name,
        target_entity: rel.target_name,
        relation_type: rel.relationType,
        confidence: rel.confidence
      }));
      
      relationshipChunks++;
    }
    
    console.error(`✅ Knowledge graph chunks generated: ${entityChunks} entities, ${relationshipChunks} relationships`);
    
    return { entityChunks, relationshipChunks };
  }

  // NEW: Embed knowledge graph chunks
  async embedKnowledgeGraphChunks(): Promise<{ embeddedChunks: number }> {
    if (!this.db) throw new Error('Database not initialized');
    if (!this.modelInitialized) {
      console.warn('⚠️ Embedding model not initialized. Skipping KG chunk embedding.');
      return { embeddedChunks: 0 };
    }

    let embeddedCount = 0;
    try {
      const kgChunkMetadata = this.db.prepare(`
        SELECT chunk_id, text FROM chunk_metadata 
        WHERE chunk_type = 'entity' OR chunk_type = 'relationship'
      `).all() as { chunk_id: string; text: string }[];

      if (kgChunkMetadata.length === 0) {
        console.error('No knowledge graph chunks to embed.');
        return { embeddedChunks: 0 };
      }
      
      const stmt = this.db.prepare(`
        INSERT INTO chunks (chunk_id, embedding) 
        VALUES (?, ?)
      `);

      for (const chunk of kgChunkMetadata) {
        if (!chunk.text || !chunk.text.trim()) {
          console.warn(`🚫 Skipping KG chunk ${chunk.chunk_id} due to empty text.`);
          continue;
        }
        try {
          const embedding = await this.generateEmbedding(chunk.text);
          if (embedding && embedding.length > 0) {
            stmt.run(chunk.chunk_id, embedding);
            embeddedCount++;
          } else {
            console.warn(`🚫 Failed to generate embedding for KG chunk: ${chunk.chunk_id}`);
          }
        } catch (embedError) {
          console.error(`Error embedding KG chunk ${chunk.chunk_id}:`, embedError);
        }
      }
      console.error(`✅ Embedded ${embeddedCount} knowledge graph chunks.`);
    } catch (error) {
      console.error('Error embedding knowledge graph chunks:', error);
    }
    return { embeddedChunks: embeddedCount };
  }

  // NEW: Generate textual representation for entity chunks
  private generateEntityChunkText(name: string, entityType: string, observations: string[]): string {
    const observationsText = observations.length > 0 ? observations.join('. ') : 'No additional information available.';
    return `${name} is a ${entityType}. ${observationsText}`;
  }

  // NEW: Generate textual representation for relationship chunks  
  private generateRelationshipChunkText(sourceName: string, targetName: string, relationType: string): string {
    // Convert relation type to more natural language
    const relationText = relationType.toLowerCase().replace(/_/g, ' ');
    return `${sourceName} ${relationText} ${targetName}`;
  }

  // NEW: Clean up existing knowledge graph chunks
  private async cleanupKnowledgeGraphChunks(): Promise<void> {
    if (!this.db) return;
    
    console.error('🧹 Cleaning up existing knowledge graph chunks...');
    
    // Get existing knowledge graph chunk IDs
    const kgChunkIds = this.db.prepare(`
      SELECT chunk_id FROM chunk_metadata WHERE chunk_type IN ('entity', 'relationship')
    `).all() as { chunk_id: string }[];
    
    let deletedVectors = 0;
    
    // Delete vectors by chunk_id
    for (const item of kgChunkIds) {
      const vectors = this.db.prepare(`
        DELETE FROM chunks WHERE chunk_id = ?
      `).run(item.chunk_id);
      deletedVectors += vectors.changes;
    }
    
    // Delete chunk-entity associations (this part might need review if chunk_entities uses chunk_metadata.rowid directly)
    // Assuming chunk_entities can be cleared if metadata is cleared, or it should also use chunk_id.
    // For now, let's focus on the main problem. The original code deleted chunk_entities based on chunk_metadata.rowid.
    // If chunk_entities.chunk_rowid refers to chunk_metadata.rowid, it should be fine if metadata is deleted.
    // However, if it implies a link to the old `chunks` table structure, that's more complex.
    // For simplicity of this fix, we'll assume deleting metadata handles associated table cleanup correctly or it's out of scope for this specific fix.
    // The original code did:
    // const existingChunksMetadata = this.db.prepare(`SELECT rowid FROM chunk_metadata WHERE chunk_type IN ('entity', 'relationship')`).all() as { rowid: number }[];
    // for (const chunkMeta of existingChunksMetadata) {
    //   this.db.prepare(`DELETE FROM chunk_entities WHERE chunk_rowid = ?`).run(chunkMeta.rowid);
    // }
    // This part is left as is from original logic IF chunk_entities.chunk_rowid indeed refers to chunk_metadata.rowid
    // To be safe, let's fetch rowids from chunk_metadata for chunk_entities deletion as original logic
    const existingChunksMetadataForAssociations = this.db.prepare(`
      SELECT rowid FROM chunk_metadata WHERE chunk_type IN ('entity', 'relationship')
    `).all() as { rowid: number }[];
    let deletedAssociations = 0;
    for (const chunkMeta of existingChunksMetadataForAssociations) {
      const associations = this.db.prepare(`
        DELETE FROM chunk_entities WHERE chunk_rowid = ?
      `).run(chunkMeta.rowid);
      deletedAssociations += associations.changes;
    }


    // Delete chunk metadata
    const metadata = this.db.prepare(`
      DELETE FROM chunk_metadata WHERE chunk_type IN ('entity', 'relationship')
    `).run();
    
    if (kgChunkIds.length > 0 || existingChunksMetadataForAssociations.length > 0) {
      console.error(`  ├─ Deleted ${deletedVectors} vector embeddings (by chunk_id)`);
      if (existingChunksMetadataForAssociations.length > 0) {
        console.error(`  ├─ Deleted ${deletedAssociations} entity associations (by chunk_metadata.rowid)`);
      }
      console.error(`  └─ Deleted ${metadata.changes} chunk metadata records`);
    }
  }

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
        console.error('⚠️ Embedding model failed, falling back to enhanced general semantic embedding:', error);
        // Fall through to enhanced general implementation
      }
    }
    
    // Enhanced general-purpose semantic embedding
    const embedding = new Array(dimensions).fill(0);
    
    // Normalize and tokenize text
    const normalizedText = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = normalizedText.split(' ').filter(word => word.length > 1);
    
    if (words.length === 0) {
      return new Float32Array(embedding);
    }
    
    // Enhanced word importance calculation
    const wordFreq = new Map<string, number>();
    const wordPositions = new Map<string, number[]>();
    
    words.forEach((word, position) => {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      if (!wordPositions.has(word)) {
        wordPositions.set(word, []);
      }
      wordPositions.get(word)!.push(position);
    });
    
    const totalWords = words.length;
    const uniqueWords = wordFreq.size;
    const vocabulary = Array.from(wordFreq.keys());
    
    // Create enhanced semantic features for each unique word
    vocabulary.forEach(word => {
      const freq = wordFreq.get(word) || 1;
      const positions = wordPositions.get(word) || [];
      
      // Enhanced TF-IDF calculation
      const tf = freq / totalWords;
      const idf = Math.log(totalWords / freq); // More aggressive IDF for rare words
      const tfidf = tf * idf;
      
      // Multi-position importance (average of all positions)
      const avgPosition = positions.reduce((sum, pos) => sum + pos, 0) / positions.length;
      const positionWeight = this.calculatePositionWeight(avgPosition, totalWords);
      
      // Word characteristics for semantic diversity
      const wordLength = word.length;
      const vowelCount = (word.match(/[aeiou]/g) || []).length;
      const consonantCount = wordLength - vowelCount;
      const vowelRatio = vowelCount / wordLength;
      const hasCapitals = /[A-Z]/.test(word);
      const hasNumbers = /\d/.test(word);
      
      // Word complexity indicators
      const isLongWord = wordLength > 6;
      const isRareWord = freq === 1 && wordLength > 4;
      const isCompoundWord = word.includes('_') || word.includes('-');
      
      // Multiple hash functions for better semantic distribution
      const hash1 = this.semanticHash(word, 1);
      const hash2 = this.semanticHash(word, 2);
      const hash3 = this.semanticHash(word, 3);
      const hash4 = this.semanticHash(word + '_semantic', 1);
      
      // Enhanced base weight with word importance
      let baseWeight = tfidf * positionWeight;
      
      // Boost important words
      if (isLongWord) baseWeight *= 1.3;
      if (isRareWord) baseWeight *= 1.5;
      if (isCompoundWord) baseWeight *= 1.2;
      if (hasCapitals) baseWeight *= 1.1;
      
      // Primary word representation with enhanced distribution
      embedding[hash1 % dimensions] += baseWeight * 1.2;
      embedding[hash2 % dimensions] += baseWeight * 1.0;
      embedding[hash3 % dimensions] += baseWeight * 0.8;
      
      // Character-level features
      embedding[hash4 % dimensions] += vowelRatio * baseWeight * 0.5;
      embedding[(hash1 + wordLength) % dimensions] += (wordLength / 15.0) * baseWeight * 0.4;
      
      // Structural and linguistic features
      if (hasCapitals) {
        embedding[(hash2 + 7) % dimensions] += baseWeight * 0.6;
      }
      if (hasNumbers) {
        embedding[(hash3 + 11) % dimensions] += baseWeight * 0.6;
      }
      if (wordLength > 8) {  // Complex words get special treatment
        embedding[(hash1 + 13) % dimensions] += baseWeight * 0.7;
      }
      
      // Enhanced n-gram features with better context
      positions.forEach(position => {
        // Bigram features
        if (position > 0) {
          const bigram = words[position - 1] + '_' + word;
          const bigramHash = this.semanticHash(bigram, 4);
          embedding[bigramHash % dimensions] += baseWeight * 0.5;
        }
        
        if (position < words.length - 1) {
          const nextBigram = word + '_' + words[position + 1];
          const nextBigramHash = this.semanticHash(nextBigram, 5);
          embedding[nextBigramHash % dimensions] += baseWeight * 0.5;
        }
        
        // Trigram features for important words
        if (isLongWord || isRareWord) {
          if (position > 0 && position < words.length - 1) {
            const trigram = words[position - 1] + '_' + word + '_' + words[position + 1];
            const trigramHash = this.semanticHash(trigram, 6);
            embedding[trigramHash % dimensions] += baseWeight * 0.3;
          }
        }
      });
      
      // Enhanced prefix/suffix features for morphological richness
      if (wordLength >= 3) {
        const prefix2 = word.substring(0, Math.min(2, wordLength));
        const prefix3 = word.substring(0, Math.min(3, wordLength));
        const suffix2 = word.substring(Math.max(0, wordLength - 2));
        const suffix3 = word.substring(Math.max(0, wordLength - 3));
        
        const prefix2Hash = this.semanticHash(prefix2 + '_pre2', 7);
        const prefix3Hash = this.semanticHash(prefix3 + '_pre3', 8);
        const suffix2Hash = this.semanticHash(suffix2 + '_suf2', 9);
        const suffix3Hash = this.semanticHash(suffix3 + '_suf3', 10);
        
        embedding[prefix2Hash % dimensions] += baseWeight * 0.3;
        embedding[prefix3Hash % dimensions] += baseWeight * 0.4;
        embedding[suffix2Hash % dimensions] += baseWeight * 0.3;
        embedding[suffix3Hash % dimensions] += baseWeight * 0.4;
      }
    });
    
    // Enhanced global text features
    const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    const maxWordLength = Math.max(...words.map(w => w.length));
    const textComplexity = uniqueWords / totalWords;
    const textDensity = Math.log(1 + totalWords);
    const lexicalDiversity = uniqueWords / Math.sqrt(totalWords); // Better diversity measure
    
    // Distribute enhanced global features
    const globalHash1 = this.semanticHash('_global_complexity_', 11);
    const globalHash2 = this.semanticHash('_global_density_', 12);
    const globalHash3 = this.semanticHash('_global_length_', 13);
    const globalHash4 = this.semanticHash('_global_diversity_', 14);
    const globalHash5 = this.semanticHash('_global_max_word_', 15);
    
    embedding[globalHash1 % dimensions] += textComplexity * 0.6;
    embedding[globalHash2 % dimensions] += textDensity / 8.0;
    embedding[globalHash3 % dimensions] += avgWordLength / 12.0;
    embedding[globalHash4 % dimensions] += lexicalDiversity * 0.5;
    embedding[globalHash5 % dimensions] += maxWordLength / 15.0;
    
    // Enhanced document length normalization
    const docLengthNorm = Math.log(1 + totalWords);
    for (let i = 0; i < dimensions; i++) {
      embedding[i] = embedding[i] / Math.max(docLengthNorm, 1.0);
    }
    
    // L2 normalization for cosine similarity
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    const normalizedEmbedding = magnitude > 0 ? embedding.map(val => val / magnitude) : embedding;
    
    return new Float32Array(normalizedEmbedding);
  }
  
  // Calculate position-based importance weight
  private calculatePositionWeight(position: number, totalWords: number): number {
    if (totalWords === 1) return 1.0;
    
    // Higher weight for beginning and end, lower for middle
    const relativePos = position / (totalWords - 1);
    
    // U-shaped curve: higher at start (0) and end (1), lower in middle (0.5)
    const positionWeight = 1.0 - 0.3 * Math.sin(relativePos * Math.PI);
    
    return positionWeight;
  }
  
  // General-purpose semantic hash function
  private semanticHash(str: string, seed: number): number {
    let hash = seed;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // === NEW SEPARATE TOOLS ===

  async storeDocument(id: string, content: string, metadata: Record<string, any> = {}): Promise<{ id: string; stored: boolean; chunksCreated?: number; chunksEmbedded?: number }> {
    // PostgreSQL database adapter fallback
    if (this.dbAdapter) {
      console.error('🐘 Using PostgreSQL adapter for storeDocument');
      const result = await this.dbAdapter.storeDocument(id, content, metadata);
      return {
        id: result.id,
        stored: result.stored,
        chunksCreated: result.chunksCreated,
        chunksEmbedded: result.chunksEmbedded
      };
    }
    
    // SQLite implementation
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`📄 Storing document: ${id}`);
    
    // Clean up existing document data (including old chunks and their embeddings)
    await this.cleanupDocument(id);
    
    // Store document definition
    this.db.prepare(`
      INSERT OR REPLACE INTO documents (id, content, metadata)
      VALUES (?, ?, ?)
    `).run(id, content, JSON.stringify(metadata));
    
    console.error(`✅ Document stored: ${id}`);

    // NEW: Automatically chunk and embed the document after storing
    let chunksCreated = 0;
    let chunksEmbedded = 0;

    try {
      const chunkResult = await this.chunkDocument(id);
      chunksCreated = chunkResult.chunks.length;
      console.error(`📄 Document ${id} chunked: ${chunksCreated} chunks created.`);

      if (chunksCreated > 0) {
        const embedResult = await this.embedChunks(id);
        chunksEmbedded = embedResult.embeddedChunks;
        console.error(`📄 Document ${id} chunks embedded: ${chunksEmbedded} embeddings created.`);
      }
    } catch (error) {
      console.error(`❌ Error during automatic chunking/embedding for document ${id}:`, error);
      // Storing was successful, but chunking/embedding failed. Return partial success.
    }

    return { id, stored: true, chunksCreated, chunksEmbedded };
  }

  async chunkDocument(documentId: string, options: { maxTokens?: number; overlap?: number } = {}): Promise<{ documentId: string; chunks: Array<{ id: string; text: string; startPos: number; endPos: number }> }> {
    if (this.dbAdapter) {
      return await this.dbAdapter.chunkDocument(documentId, options);
    }
    
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
          chunk_id, document_id, chunk_index, text, start_pos, end_pos, chunk_type
        ) VALUES (?, ?, ?, ?, ?, ?, 'document')
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
    // PostgreSQL database adapter fallback
    if (this.dbAdapter) {
      console.error('🐘 Using PostgreSQL adapter for embedChunks');
      const result = await this.dbAdapter.embedChunks(documentId);
      return { 
        documentId, 
        embeddedChunks: result.embeddedChunks || 0 
      };
    }
    
    // SQLite implementation
    if (!this.db) throw new Error('Database not initialized');
    if (!this.modelInitialized) {
      console.warn('⚠️ Embedding model not initialized. Skipping document chunk embedding.');
      return { documentId, embeddedChunks: 0 };
    }

    let embeddedCount = 0;
    try {
      const chunksToEmbed = this.db.prepare(`
        SELECT chunk_id, text 
        FROM chunk_metadata 
        WHERE document_id = ? AND chunk_type = 'document'
      `).all(documentId) as { chunk_id: string; text: string }[];

      if (chunksToEmbed.length === 0) {
        console.error(`No document chunks to embed for document ${documentId}.`);
        return { documentId, embeddedChunks: 0 };
      }

      const stmt = this.db.prepare('INSERT INTO chunks (chunk_id, embedding) VALUES (?, ?)');
      
      for (const chunk of chunksToEmbed) {
        if (!chunk.text || !chunk.text.trim()) {
          console.warn(`🚫 Skipping chunk ${chunk.chunk_id} for document ${documentId} due to empty text.`);
          continue;
        }
        try {
          const embedding = await this.generateEmbedding(chunk.text);
          if (embedding && embedding.length > 0) {
            stmt.run(chunk.chunk_id, embedding);
            embeddedCount++;
          } else {
            console.warn(`🚫 Failed to generate embedding for chunk: ${chunk.chunk_id} in document ${documentId}`);
          }
        } catch (embedError) {
          console.error(`Error embedding chunk ${chunk.chunk_id} for document ${documentId}:`, embedError);
        }
      }
      console.error(`✅ Embedded ${embeddedCount} chunks for document ${documentId}.`);
    } catch (error) {
      console.error(`Error embedding chunks for document ${documentId}:`, error);
    }
    return { documentId, embeddedChunks: embeddedCount };
  }

  async extractTerms(documentId: string, options: {
    minLength?: number;
    includeCapitalized?: boolean;
    customPatterns?: string[];
  } = {}): Promise<{ documentId: string; terms: string[] }> {
    if (this.dbAdapter) {
      return await this.dbAdapter.extractTerms(documentId, options);
    }
    
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
    if (this.dbAdapter) {
      await this.dbAdapter.linkEntitiesToDocument(documentId, entityNames);
      return {
        documentId,
        linkedEntities: entityNames.length
      };
    }
    
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
    
    // Get existing chunk_ids for the document
    const docChunkIds = this.db.prepare(`
      SELECT chunk_id FROM chunk_metadata WHERE document_id = ?
    `).all(documentId) as { chunk_id: string }[];
    
    let deletedVectors = 0;
    
    // Delete vectors by chunk_id
    for (const item of docChunkIds) {
      const vectors = this.db.prepare(`
        DELETE FROM chunks WHERE chunk_id = ?
      `).run(item.chunk_id);
      deletedVectors += vectors.changes;
    }

    // Delete chunk-entity associations
    // Assuming chunk_entities.chunk_rowid refers to chunk_metadata.rowid
    // Fetching rowids from chunk_metadata for these associations as per original logic
    const existingChunksMetadataForAssociations = this.db.prepare(`
      SELECT rowid FROM chunk_metadata WHERE document_id = ?
    `).all(documentId) as { rowid: number }[];
    let deletedAssociations = 0;
    for (const chunkMeta of existingChunksMetadataForAssociations) {
      const associations = this.db.prepare(`
        DELETE FROM chunk_entities WHERE chunk_rowid = ?
      `).run(chunkMeta.rowid);
      deletedAssociations += associations.changes;
    }
    
    // Delete chunk metadata
    const metadata = this.db.prepare(`
      DELETE FROM chunk_metadata WHERE document_id = ?
    `).run(documentId);
    
    if (docChunkIds.length > 0 || existingChunksMetadataForAssociations.length > 0) {
      console.error(`  ├─ Deleted ${deletedAssociations} entity associations (by chunk_metadata.rowid)`);
      console.error(`  ├─ Deleted ${deletedVectors} vector embeddings (by chunk_id)`);
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
    if (this.dbAdapter) {
      const result = await this.dbAdapter.deleteDocuments(documentIds);
      const idsArray = Array.isArray(documentIds) ? documentIds : [documentIds];
      
      return {
        results: idsArray.map(id => ({ documentId: id, deleted: true })),
        summary: {
          deleted: result.deleted,
          failed: result.failed,
          total: idsArray.length
        }
      };
    }
    
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
    if (this.dbAdapter) {
      console.error(`📋 Listing all documents (metadata: ${includeMetadata})`);
      const docs = await this.dbAdapter.listDocuments(includeMetadata);
      return { documents: docs };
    }
    
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

  async hybridSearch(query: string, limit = 5, useGraph = true): Promise<EnhancedSearchResult[]> {
    // Use database adapter if available
    if (this.dbAdapter) {
      return await this.dbAdapter.hybridSearch(query, { limit, useGraph });
    }
    
    if (!this.db) throw new Error('Database not initialized');
    if (!this.encoding) throw new Error('Tokenizer not initialized');
    
    console.error(`🔍 Enhanced hybrid search: "${query}"`);
    
    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);
    
    // Enhanced vector search across ALL chunk types (documents, entities, relationships)
    const vectorResults = this.db.prepare(`
      SELECT 
        c.rowid as chunk_embedding_rowid, -- aliasing to avoid confusion with m.rowid
        m.chunk_id,
        m.chunk_type,
        m.document_id,
        m.entity_id,
        m.relationship_id,
        m.chunk_index,
        m.text,
        m.start_pos,
        m.end_pos,
        m.metadata as chunk_metadata_json, -- renamed to avoid conflict if metadata is a keyword
        c.distance,
        COALESCE(d.metadata, '{}') as doc_metadata_json -- renamed
      FROM chunks c
      JOIN chunk_metadata m ON c.chunk_id = m.chunk_id -- JOIN ON CHUNK_ID
      LEFT JOIN documents d ON m.document_id = d.id
      WHERE c.embedding MATCH ?
        AND k = ?
      ORDER BY c.distance
    `).all(Buffer.from(queryEmbedding.buffer), limit * 3) as Array<{
      chunk_embedding_rowid: number; // rowid from chunks table
      chunk_id: string;
      chunk_type: string;
      document_id: string | null;
      entity_id: string | null;
      relationship_id: string | null;
      chunk_index: number;
      text: string;
      start_pos: number;
      end_pos: number;
      chunk_metadata_json: string; // metadata from chunk_metadata
      distance: number;
      doc_metadata_json: string;   // metadata from documents table
    }>;
    
    if (vectorResults.length === 0) {
      console.error(`ℹ️ No vector matches found for "${query}"`);
      return [];
    }
    
    // Get entity information for graph enhancement
    let connectedEntities = new Set<string>();
    if (useGraph) {
      const queryTerms = this.extractTermsFromText(query); // Using extractTermsFromText
      
      for (const term of queryTerms) { // Iterate over extracted terms
        // Check if term is an existing entity
        const entityCheck = this.db.prepare('SELECT id, name FROM entities WHERE name = ? COLLATE NOCASE').get(term) as { id: string, name: string } | undefined;
        if (entityCheck) {
          const connected = this.db.prepare(`
            SELECT DISTINCT
              CASE 
                WHEN r.source_entity = e_query.id THEN e_other.name
                ELSE e_query_linked.name
              END as connected_name
            FROM entities e_query
            JOIN relationships r ON (r.source_entity = e_query.id OR r.target_entity = e_query.id)
            JOIN entities e_other ON (e_other.id = r.target_entity AND r.source_entity = e_query.id) OR (e_other.id = r.source_entity AND r.target_entity = e_query.id)
            JOIN entities e_query_linked ON e_query_linked.id = e_query.id -- ensures e_query_linked is the same as e_query
            WHERE e_query.id = ? AND e_other.id != e_query.id
          `).all(entityCheck.id) as { connected_name: string }[];
          
          connected.forEach((row) => connectedEntities.add(row.connected_name));
        }
      }
    }
    
    // Process results with semantic summaries
    const enhancedResults: EnhancedSearchResult[] = [];
    
    for (const result of vectorResults) {
      let chunkEntities: string[] = [];
      const chunkMetadata = JSON.parse(result.chunk_metadata_json || '{}');

      if (result.chunk_type === 'document' && result.document_id) {
        // For document chunks, entities are linked via chunk_entities table using chunk_metadata.rowid
        // We need to get the chunk_metadata.rowid using the chunk_id
        const chunkMetaRow = this.db.prepare('SELECT rowid FROM chunk_metadata WHERE chunk_id = ?').get(result.chunk_id) as {rowid: number} | undefined;
        if (chunkMetaRow) {
          chunkEntities = this.db.prepare(`
            SELECT e.name 
            FROM chunk_entities ce
            JOIN entities e ON e.id = ce.entity_id
            WHERE ce.chunk_rowid = ?
          `).all(chunkMetaRow.rowid).map((row: any) => row.name);
        }
      } else if (result.chunk_type === 'entity' && result.entity_id) {
        if (chunkMetadata.entity_name) { // Use metadata stored during chunk generation
          chunkEntities = [chunkMetadata.entity_name];
        } else { // Fallback to DB lookup if not in metadata (should be in metadata)
          const entity = this.db.prepare(`SELECT name FROM entities WHERE id = ?`).get(result.entity_id) as { name: string } | undefined;
          if (entity) chunkEntities = [entity.name];
        }
      } else if (result.chunk_type === 'relationship' && result.relationship_id) {
         if (chunkMetadata.source_entity && chunkMetadata.target_entity) { // Use metadata
           chunkEntities = [chunkMetadata.source_entity, chunkMetadata.target_entity];
         } else { // Fallback
            const relEntities = this.db.prepare(`
              SELECT e1.name as source_name, e2.name as target_name
              FROM relationships r
              JOIN entities e1 ON r.source_entity = e1.id
              JOIN entities e2 ON r.target_entity = e2.id
              WHERE r.id = ?
            `).get(result.relationship_id) as { source_name: string; target_name: string } | undefined;
            if (relEntities) chunkEntities = [relEntities.source_name, relEntities.target_name];
        }
      }
      
      // Enhanced graph boost calculation
      let graphBoost = 0;
      if (useGraph) {
        const queryTerms = this.extractTermsFromText(query); // Using extractTermsFromText
        
        if (result.chunk_type === 'entity') graphBoost += 0.15;
        else if (result.chunk_type === 'relationship') graphBoost += 0.25;
        
        for (const entity of chunkEntities) {
          if (queryTerms.some(qe => qe.toLowerCase() === entity.toLowerCase())) {
            graphBoost += 0.3; 
          }
          if (connectedEntities.has(entity)) {
            graphBoost += 0.15;
          }
        }
      }
      
      const queryEmbeddingForSummary = await this.generateEmbedding(query); // Re-ensure embedding for summary context
      const { summary, keyHighlight, relevanceScore } = await this.generateContentSummary(
        result.text,
        queryEmbeddingForSummary, // Use fresh query embedding
        chunkEntities,
        result.chunk_type === 'relationship' ? 1 : 2 
      );
      
      const vectorSimilarity = 1 / (1 + result.distance);
      const finalScore = Math.max(vectorSimilarity, relevanceScore) + graphBoost;
      
      let documentTitle: string;
      let sourceId: string;
      const docMetadata = JSON.parse(result.doc_metadata_json || '{}');

      if (result.chunk_type === 'document') {
        documentTitle = docMetadata.title || docMetadata.name || result.document_id || 'Unknown Document';
        sourceId = result.document_id || '';
      } else if (result.chunk_type === 'entity') {
        documentTitle = 'Knowledge Graph Entity';
        sourceId = result.entity_id || '';
      } else if (result.chunk_type === 'relationship') {
        documentTitle = 'Knowledge Graph Relationship';
        sourceId = result.relationship_id || '';
      } else {
        documentTitle = 'Unknown Source';
        sourceId = '';
      }
      
      enhancedResults.push({
        relevance_score: finalScore,
        key_highlight: keyHighlight,
        content_summary: summary,
        chunk_id: result.chunk_id,
        document_title: documentTitle,
        entities: chunkEntities,
        vector_similarity: vectorSimilarity,
        graph_boost: useGraph ? graphBoost : undefined,
        full_context_available: true,
        chunk_type: result.chunk_type as 'document' | 'entity' | 'relationship',
        source_id: sourceId
      });
    }
    
    const finalResults = enhancedResults
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, limit);
    
    const docResults = finalResults.filter(r => r.chunk_type === 'document').length;
    const entityResults = finalResults.filter(r => r.chunk_type === 'entity').length;
    const relResults = finalResults.filter(r => r.chunk_type === 'relationship').length;
    
    console.error(`✅ Enhanced hybrid search completed: ${finalResults.length} results (${docResults} docs, ${entityResults} entities, ${relResults} relationships)`);
    
    return finalResults;
  }

  // NEW: Get detailed context for a specific chunk
  async getDetailedContext(chunkId: string, includeSurrounding = true): Promise<DetailedContext> {
    if (this.dbAdapter) {
      return await this.dbAdapter.getDetailedContext(chunkId, includeSurrounding);
    }
    
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`📖 Getting detailed context for chunk: ${chunkId}`);
    
    // Get the main chunk
    const chunk = this.db.prepare(`
      SELECT 
        m.chunk_id,
        m.document_id,
        m.chunk_index,
        m.text,
        d.content as doc_content,
        d.metadata as doc_metadata
      FROM chunk_metadata m
      JOIN documents d ON m.document_id = d.id
      WHERE m.chunk_id = ?
    `).get(chunkId) as {
      chunk_id: string;
      document_id: string;
      chunk_index: number;
      text: string;
      doc_content: string;
      doc_metadata: string;
    } | undefined;
    
    if (!chunk) {
      throw new Error(`Chunk with ID ${chunkId} not found`);
    }
    
    // Get entities for this chunk
    const entities = this.db.prepare(`
      SELECT e.name 
      FROM chunk_entities ce
      JOIN chunk_metadata m ON ce.chunk_rowid = m.rowid
      JOIN entities e ON e.id = ce.entity_id
      WHERE m.chunk_id = ?
    `).all(chunkId).map((row: any) => row.name);
    
    let surroundingChunks: Array<{ chunk_id: string; text: string; position: 'before' | 'after' }> = [];
    
    if (includeSurrounding) {
      // Get preceding and following chunks from the same document
      const beforeChunk = this.db.prepare(`
        SELECT chunk_id, text
        FROM chunk_metadata
        WHERE document_id = ? AND chunk_index = ?
      `).get(chunk.document_id, chunk.chunk_index - 1) as { chunk_id: string; text: string } | undefined;
      
      const afterChunk = this.db.prepare(`
        SELECT chunk_id, text
        FROM chunk_metadata
        WHERE document_id = ? AND chunk_index = ?
      `).get(chunk.document_id, chunk.chunk_index + 1) as { chunk_id: string; text: string } | undefined;
      
      if (beforeChunk) {
        surroundingChunks.push({
          chunk_id: beforeChunk.chunk_id,
          text: beforeChunk.text,
          position: 'before'
        });
      }
      
      if (afterChunk) {
        surroundingChunks.push({
          chunk_id: afterChunk.chunk_id,
          text: afterChunk.text,
          position: 'after'
        });
      }
    }
    
    const metadata = JSON.parse(chunk.doc_metadata);
    const documentTitle = metadata.title || metadata.name || chunk.document_id;
    
    console.error(`✅ Retrieved detailed context with ${surroundingChunks.length} surrounding chunks`);
    
    return {
      chunk_id: chunk.chunk_id,
      document_id: chunk.document_id,
      full_text: chunk.text,
      document_title: documentTitle,
      surrounding_chunks: surroundingChunks.length > 0 ? surroundingChunks : undefined,
      entities: entities,
      metadata: metadata
    };
  }

  async getKnowledgeGraphStats(): Promise<any> {
    if (this.dbAdapter) {
      return await this.dbAdapter.getKnowledgeGraphStats();
    }
    
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

  // === MIGRATION TOOLS ===

  async getMigrationStatus(): Promise<{ currentVersion: number; migrations: Array<{ version: number; description: string; applied: boolean; applied_at?: string }>; pendingCount: number }> {
    if (!this.db) throw new Error('Database not initialized');
    
    const migrationManager = new MigrationManager(this.db);
    
    // Add all migrations
    migrations.forEach(migration => {
      migrationManager.addMigration(migration);
    });
    
    const currentVersion = migrationManager.getCurrentVersion();
    const allMigrations = migrationManager.listMigrations();
    const pendingCount = allMigrations.filter(m => !m.applied).length;
    
    return {
      currentVersion,
      migrations: allMigrations,
      pendingCount
    };
  }



  async rollbackMigration(targetVersion: number): Promise<{ rolledBack: number; currentVersion: number; rolledBackMigrations: Array<{ version: number; description: string }> }> {
    if (this.dbAdapter) {
      return await this.dbAdapter.rollbackMigration(targetVersion);
    }
    
    if (!this.db) throw new Error('Database not initialized');
    
    const migrationManager = new MigrationManager(this.db);
    
    // Add all migrations
    migrations.forEach(migration => {
      migrationManager.addMigration(migration);
    });
    
    const currentVersion = migrationManager.getCurrentVersion();
    
    if (targetVersion >= currentVersion) {
      return {
        rolledBack: 0,
        currentVersion,
        rolledBackMigrations: []
      };
    }
    
    const migrationsToRollback = migrations
      .filter(m => m.version > targetVersion && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version);
    
    migrationManager.rollback(targetVersion);
    
    return {
      rolledBack: migrationsToRollback.length,
      currentVersion: migrationManager.getCurrentVersion(),
      rolledBackMigrations: migrationsToRollback.map(m => ({
        version: m.version,
        description: m.description
      }))
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
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.searchNodes((validatedArgs as any).query as string, (validatedArgs as any).limit || 10), null, 2) }] };
      case "openNodes":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.openNodes((validatedArgs as any).names as string[]), null, 2) }] };
      
      // New RAG tools
      case "storeDocument":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.storeDocument((validatedArgs as any).id as string, (validatedArgs as any).content as string, (validatedArgs as any).metadata || {}), null, 2) }] };
      // chunkDocument and embedChunks are now handled automatically by storeDocument
      case "extractTerms":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.extractTerms((validatedArgs as any).documentId as string, { minLength: (validatedArgs as any).minLength, includeCapitalized: (validatedArgs as any).includeCapitalized, customPatterns: (validatedArgs as any).customPatterns }), null, 2) }] };
      case "linkEntitiesToDocument":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.linkEntitiesToDocument((validatedArgs as any).documentId as string, (validatedArgs as any).entityNames as string[]), null, 2) }] };
      case "hybridSearch":
        const limit = typeof (validatedArgs as any).limit === 'number' ? (validatedArgs as any).limit : 5;
        const useGraph = (validatedArgs as any).useGraph !== false;
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.hybridSearch((validatedArgs as any).query as string, limit, useGraph), null, 2) }] };
      case "getDetailedContext":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.getDetailedContext((validatedArgs as any).chunkId as string, (validatedArgs as any).includeSurrounding !== false), null, 2) }] };
      case "getKnowledgeGraphStats":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.getKnowledgeGraphStats(), null, 2) }] };
      case "deleteDocuments":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.deleteDocuments((validatedArgs as any).documentIds as string | string[]), null, 2) }] };
      case "listDocuments":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.listDocuments((validatedArgs as any).includeMetadata !== false), null, 2) }] };
      
      // embedAllEntities removed - entities are now automatically embedded when created
      case "reEmbedEverything": // Added new tool handler
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.reEmbedEverything(), null, 2) }] };
      
      // NEW: Migration tools
      case "getMigrationStatus":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.getMigrationStatus(), null, 2) }] };
      case "runMigrations":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.runMigrations(), null, 2) }] };
      case "rollbackMigration":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.rollbackMigration((validatedArgs as any).targetVersion as number), null, 2) }] };
      
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
