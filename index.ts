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

    // Vector embeddings using sqlite-vec for document chunks
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING vec0(
        embedding FLOAT[384]
      )
    `);

    // NEW: Vector embeddings for entities using sqlite-vec
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entity_embeddings USING vec0(
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

    // NEW: Entity embedding metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entity_embedding_metadata (
        rowid INTEGER PRIMARY KEY,
        entity_id TEXT UNIQUE,
        embedding_text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
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
      CREATE INDEX IF NOT EXISTS idx_entity_embedding_metadata_entity ON entity_embedding_metadata(entity_id);
    `);

    console.error('🔧 Database tables created with entity vector support for semantic search');
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
        
        // Generate embedding for the new entity
        console.error(`🔮 Generating embedding for new entity: ${entity.name}`);
        await this.embedEntity(entityId);
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
        
        // Regenerate embedding for the updated entity
        console.error(`🔮 Regenerating embedding for updated entity: ${obs.entityName}`);
        await this.embedEntity(entityId);
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

  async searchNodes(query: string, limit = 10): Promise<KnowledgeGraph> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.error(`🔍 Semantic entity search: "${query}"`);
    
    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);
    
    // Perform vector similarity search on entities
    const entityResults = this.db.prepare(`
      SELECT 
        ee.rowid,
        eem.entity_id,
        eem.embedding_text,
        ee.distance,
        e.name,
        e.entityType,
        e.observations
      FROM entity_embeddings ee
      JOIN entity_embedding_metadata eem ON ee.rowid = eem.rowid
      JOIN entities e ON eem.entity_id = e.id
      WHERE ee.embedding MATCH ?
        AND k = ?
      ORDER BY ee.distance
    `).all(Buffer.from(queryEmbedding.buffer), limit) as Array<{
      rowid: number;
      entity_id: string;
      embedding_text: string;
      distance: number;
      name: string;
      entityType: string;
      observations: string;
    }>;
    
    if (entityResults.length === 0) {
      console.error(`ℹ️ No semantic matches found for "${query}"`);
      return { entities: [], relations: [] };
    }
    
    const entities = entityResults.map(result => ({
      name: result.name,
      entityType: result.entityType,
      observations: JSON.parse(result.observations),
      similarity: 1 / (1 + result.distance) // Convert distance to similarity score
    }));
    
    // Get relationships between the found entities
    const entityNames = entities.map(e => e.name);
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

    console.error(`✅ Found ${entities.length} semantically similar entities with ${relations.length} relationships`);
    
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
    
    // Get entity data
    const entity = this.db.prepare(`
      SELECT name, entityType, observations FROM entities WHERE id = ?
    `).get(entityId) as { name: string; entityType: string; observations: string } | undefined;
    
    if (!entity) {
      console.warn(`Entity ${entityId} not found for embedding`);
      return false;
    }
    
    const parsedObservations = JSON.parse(entity.observations);
    const embeddingText = this.generateEntityEmbeddingText({
      name: entity.name,
      entityType: entity.entityType,
      observations: parsedObservations
    });
    
    // Generate embedding
    const embedding = await this.generateEmbedding(embeddingText);
    
    try {
      // Delete existing embedding if any
      const existingMetadata = this.db.prepare(`
        SELECT rowid FROM entity_embedding_metadata WHERE entity_id = ?
      `).get(entityId) as { rowid: number } | undefined;
      
      if (existingMetadata) {
        this.db.prepare(`DELETE FROM entity_embeddings WHERE rowid = ?`).run(existingMetadata.rowid);
        this.db.prepare(`DELETE FROM entity_embedding_metadata WHERE entity_id = ?`).run(entityId);
      }
      
      // Insert new embedding
      const result = this.db.prepare(`
        INSERT INTO entity_embeddings (embedding) VALUES (?)
      `).run(Buffer.from(embedding.buffer));
      
      // Store metadata
      this.db.prepare(`
        INSERT INTO entity_embedding_metadata (rowid, entity_id, embedding_text)
        VALUES (?, ?, ?)
      `).run(result.lastInsertRowid, entityId, embeddingText);
      
      return true;
    } catch (error) {
      console.error(`Failed to embed entity ${entityId}:`, error);
      return false;
    }
  }

  // Embed all entities in the knowledge graph
  async embedAllEntities(): Promise<{ totalEntities: number; embeddedEntities: number }> {
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

  async hybridSearch(query: string, limit = 5, useGraph = true): Promise<EnhancedSearchResult[]> {
    if (!this.db) throw new Error('Database not initialized');
    if (!this.encoding) throw new Error('Tokenizer not initialized');
    
    console.error(`🔍 Enhanced hybrid search: "${query}"`);
    
    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);
    
    // Vector search (get more results to allow for better selection)
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
      doc_metadata: string;
    }>;
    
    if (vectorResults.length === 0) {
      console.error(`ℹ️ No vector matches found for "${query}"`);
      return [];
    }
    
    // Get entity information for graph enhancement
    let connectedEntities = new Set<string>();
    if (useGraph) {
      const queryEntities = this.extractTermsFromText(query);
      
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
    }
    
    // Process results with semantic summaries
    const enhancedResults: EnhancedSearchResult[] = [];
    
    for (const result of vectorResults) {
      // Get entities associated with this chunk
      const chunkEntities = this.db.prepare(`
        SELECT e.name 
        FROM chunk_entities ce
        JOIN entities e ON e.id = ce.entity_id
        WHERE ce.chunk_rowid = ?
      `).all(result.rowid).map((row: any) => row.name);
      
      // Calculate graph boost if using graph enhancement
      let graphBoost = 0;
      if (useGraph) {
        const queryEntities = this.extractTermsFromText(query);
        for (const entity of chunkEntities) {
          if (queryEntities.some(qe => qe.toLowerCase() === entity.toLowerCase())) {
            graphBoost += 0.2; // Exact entity match
          }
          if (connectedEntities.has(entity)) {
            graphBoost += 0.1; // Connected entity
          }
        }
      }
      
      // Generate semantic summary
      const { summary, keyHighlight, relevanceScore } = await this.generateContentSummary(
        result.text,
        queryEmbedding,
        chunkEntities,
        2 // Max 2 sentences for summary
      );
      
      const vectorSimilarity = 1 / (1 + result.distance);
      const finalScore = Math.max(vectorSimilarity, relevanceScore) + graphBoost;
      
      // Extract document title from metadata or use document ID
      const metadata = JSON.parse(result.doc_metadata);
      const documentTitle = metadata.title || metadata.name || result.document_id;
      
      enhancedResults.push({
        relevance_score: finalScore,
        key_highlight: keyHighlight,
        content_summary: summary,
        chunk_id: result.chunk_id,
        document_title: documentTitle,
        entities: chunkEntities,
        vector_similarity: vectorSimilarity,
        graph_boost: useGraph ? graphBoost : undefined,
        full_context_available: true
      });
    }
    
    // Sort by relevance and return top results
    const finalResults = enhancedResults
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, limit);
    
    console.error(`✅ Enhanced search completed: ${finalResults.length} results with semantic summaries`);
    
    return finalResults;
  }

  // NEW: Get detailed context for a specific chunk
  async getDetailedContext(chunkId: string, includeSurrounding = true): Promise<DetailedContext> {
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
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.searchNodes((validatedArgs as any).query as string, (validatedArgs as any).limit || 10), null, 2) }] };
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
      case "getDetailedContext":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.getDetailedContext((validatedArgs as any).chunkId as string, (validatedArgs as any).includeSurrounding !== false), null, 2) }] };
      case "getKnowledgeGraphStats":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.getKnowledgeGraphStats(), null, 2) }] };
      case "deleteDocuments":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.deleteDocuments((validatedArgs as any).documentIds as string | string[]), null, 2) }] };
      case "listDocuments":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.listDocuments((validatedArgs as any).includeMetadata !== false), null, 2) }] };
      
      // NEW: Entity embedding tools
      case "embedAllEntities":
        return { content: [{ type: "text", text: JSON.stringify(await ragKgManager.embedAllEntities(), null, 2) }] };
      
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
