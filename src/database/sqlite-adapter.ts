/**
 * SQLite Database Adapter Implementation (Consolidated)
 * 
 * This adapter implements the DatabaseAdapter interface for SQLite databases
 * with sqlite-vec extension support for vector operations.
 * 
 * Consolidated from sqlite-adapter.ts and sqlite-adapter-core.ts
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { pipeline } from '@huggingface/transformers';
import { get_encoding } from 'tiktoken';
import path from 'path';
import { promises as fs } from 'fs';

import {
  DatabaseAdapter,
  DatabaseConfig,
  DatabaseHealth,
  Transaction,
  Entity,
  Relation,
  KnowledgeGraph,
  EntitySearchResult,
  ObservationAddition,
  ObservationDeletion,
  ChunkOptions,
  ChunkResult,
  ExtractOptions,
  TermResult,
  StoreDocumentResult,
  SearchOptions,
  EnhancedSearchResult,
  DetailedContext,
  DocumentInfo,
  KnowledgeGraphStats,
  PerformanceMetrics,
  Migration,
  MigrationResult,
  RollbackResult,
  EmbeddingResult,
  DeletionResult,
  RunResult,
  ReEmbedResult,
  KnowledgeGraphChunkResult,
  isSQLiteConfig,
  DatabaseLogger
} from './interfaces.js';

import { DatabaseLogger as Logger } from './logger.js';

/**
 * SQLite-specific transaction implementation
 */
class SQLiteTransaction implements Transaction {
  private db: Database.Database;
  private transactionId: string;
  private isActiveFlag: boolean = true;
  private logger: DatabaseLogger;

  constructor(db: Database.Database, logger: DatabaseLogger) {
    this.db = db;
    this.transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.logger = logger;
    
    // Begin transaction
    this.db.exec('BEGIN');
    this.logger.debug(`Transaction started: ${this.transactionId}`);
  }

  async execute<T = any>(sql: string, params: any[] = []): Promise<T> {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    try {
      const stmt = this.db.prepare(sql);
      const result = params.length > 0 ? stmt.run(...params) : stmt.run();
      return result as T;
    } catch (error) {
      this.logger.error(`Transaction execute error: ${error}`, error as Error, { sql, params });
      throw error;
    }
  }

  prepare<T = any>(sql: string) {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    const stmt = this.db.prepare(sql);
    return {
      async run(...params: any[]): Promise<RunResult> {
        const result = stmt.run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid
        };
      },
      async get(...params: any[]): Promise<T | undefined> {
        return stmt.get(...params) as T | undefined;
      },
      async all(...params: any[]): Promise<T[]> {
        return stmt.all(...params) as T[];
      },
      async finalize(): Promise<void> {
        // SQLite prepared statements don't need explicit finalization
      }
    };
  }

  async commit(): Promise<void> {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    try {
      this.db.exec('COMMIT');
      this.isActiveFlag = false;
      this.logger.debug(`Transaction committed: ${this.transactionId}`);
    } catch (error) {
      this.logger.error(`Transaction commit error: ${error}`, error as Error);
      throw error;
    }
  }

  async rollback(): Promise<void> {
    if (!this.isActiveFlag) {
      return; // Already rolled back or committed
    }

    try {
      this.db.exec('ROLLBACK');
      this.isActiveFlag = false;
      this.logger.debug(`Transaction rolled back: ${this.transactionId}`);
    } catch (error) {
      this.logger.error(`Transaction rollback error: ${error}`, error as Error);
      throw error;
    }
  }

  async savepoint(name: string): Promise<void> {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    this.db.exec(`SAVEPOINT ${name}`);
    this.logger.debug(`Savepoint created: ${name} in transaction ${this.transactionId}`);
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    this.logger.debug(`Rolled back to savepoint: ${name} in transaction ${this.transactionId}`);
  }

  async releaseSavepoint(name: string): Promise<void> {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    this.db.exec(`RELEASE SAVEPOINT ${name}`);
    this.logger.debug(`Released savepoint: ${name} in transaction ${this.transactionId}`);
  }

  isActive(): boolean {
    return this.isActiveFlag;
  }

  getId(): string {
    return this.transactionId;
  }
}

/**
 * SQLite Database Adapter (Consolidated)
 */
export class SQLiteAdapter implements DatabaseAdapter {
  private db: Database.Database | null = null;
  private config: DatabaseConfig | null = null;
  private logger: DatabaseLogger;
  private embeddingModel: any = null;
  private encoding: any = null;
  private isInitialized: boolean = false;
  private performanceMetrics: PerformanceMetrics;

  constructor(logger?: DatabaseLogger) {
    this.logger = logger || new Logger();
    this.performanceMetrics = {
      queryLatency: { avg: 0, p50: 0, p95: 0, p99: 0 },
      vectorSearch: { avgLatency: 0, totalQueries: 0 },
      memoryUsage: { heapUsed: 0, heapTotal: 0, external: 0 }
    };
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async initialize(config: DatabaseConfig): Promise<void> {
    if (!isSQLiteConfig(config)) {
      throw new Error('Invalid SQLite configuration provided');
    }

    this.config = config;
    this.logger.info('Initializing SQLite adapter', { filePath: config.sqlite.filePath });

    try {
      // Initialize database
      this.db = new Database(config.sqlite.filePath);
      
      // Load sqlite-vec extension
      sqliteVec.load(this.db);
      
      // Apply pragmas
      if (config.sqlite.pragmas) {
        for (const [key, value] of Object.entries(config.sqlite.pragmas)) {
          this.db.pragma(`${key} = ${value}`);
        }
      }

      // Enable WAL mode if requested
      if (config.sqlite.enableWAL) {
        this.db.pragma('journal_mode = WAL');
      }

      // Initialize tiktoken encoding
      this.encoding = get_encoding("cl100k_base");

      // Initialize embedding model
      await this.initializeEmbeddingModel();
      
      // Run migrations to ensure schema is up to date
      await this.runMigrations([]);
      
      this.isInitialized = true;
      this.logger.info('SQLite adapter initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize SQLite adapter', error as Error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      this.logger.info('SQLite adapter closed');
    }
  }

  isConnected(): boolean {
    return this.isInitialized && this.db !== null;
  }

  async getHealth(): Promise<DatabaseHealth> {
    if (!this.isConnected()) {
      return {
        status: 'unhealthy',
        latency: -1,
        connections: { active: 0, idle: 0, total: 0 },
        lastCheck: new Date(),
        errors: ['Database not connected']
      };
    }

    const startTime = Date.now();
    try {
      // Simple health check query
      this.db!.prepare('SELECT 1').get();
      const latency = Date.now() - startTime;

      return {
        status: latency < 100 ? 'healthy' : 'degraded',
        latency,
        connections: { active: 1, idle: 0, total: 1 }, // SQLite is single connection
        lastCheck: new Date(),
        errors: []
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        connections: { active: 0, idle: 0, total: 0 },
        lastCheck: new Date(),
        errors: [(error as Error).message]
      };
    }
  }

  // ============================================================================
  // Transaction Management
  // ============================================================================

  async beginTransaction(): Promise<Transaction> {
    if (!this.isConnected()) {
      throw new Error('Database not connected');
    }

    return new SQLiteTransaction(this.db!, this.logger);
  }

  async executeInTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = await this.beginTransaction();
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async initializeEmbeddingModel(): Promise<void> {
    try {
      this.logger.info('Initializing embedding model...');
      this.embeddingModel = await pipeline(
        'feature-extraction',
        'sentence-transformers/all-MiniLM-L12-v2',
        { revision: 'main' }
      );
      this.logger.info('Embedding model initialized successfully');
    } catch (error) {
      this.logger.warn('Failed to initialize embedding model, using fallback', error as Error);
      this.embeddingModel = null;
    }
  }

  private async generateEmbedding(text: string): Promise<Float32Array> {
    if (this.embeddingModel) {
      try {
        const result = await this.embeddingModel(text, { pooling: 'mean', normalize: true });
        return new Float32Array(result.data.slice(0, this.config!.vectorDimensions));
      } catch (error) {
        this.logger.warn('Embedding model failed, using fallback', error as Error);
      }
    }

    // Fallback embedding generation
    return this.generateFallbackEmbedding(text);
  }

  private generateFallbackEmbedding(text: string): Float32Array {
    const dimensions = this.config!.vectorDimensions;
    const embedding = new Float32Array(dimensions);
    
    // Simple hash-based embedding generation
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Generate pseudo-random values based on hash
    for (let i = 0; i < dimensions; i++) {
      hash = ((hash * 1103515245) + 12345) & 0x7fffffff;
      embedding[i] = (hash / 0x7fffffff) * 2 - 1; // Normalize to [-1, 1]
    }

    return embedding;
  }

  // ============================================================================
  // Migration Methods
  // ============================================================================

  async runMigrations(migrations: Migration[]): Promise<MigrationResult> {
    this.logger.info('Running migrations', { count: migrations.length });
    
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    try {
      // Import the existing migration system
      const { MigrationManager } = await import('../migrations/migration-manager.js');
      const { migrations: existingMigrations } = await import('../migrations/migrations.js');
      
      const migrationManager = new MigrationManager(this.db);
      
      // Add existing migrations
      for (const migration of existingMigrations) {
        migrationManager.addMigration(migration);
      }
      
      // Add any additional migrations passed as parameter
      for (const migration of migrations) {
        migrationManager.addMigration({
          version: migration.version,
          description: migration.description,
          up: (db) => {
            // Execute the migration using the adapter
            migration.up(this);
          },
          down: migration.down ? (db) => {
            migration.down!(this);
          } : undefined
        });
      }
      
      // Run migrations
      const result = await migrationManager.runMigrations();
      
      this.logger.info('Migrations completed', result);
      
      return {
        applied: result.applied,
        currentVersion: result.currentVersion,
        appliedMigrations: []
      };
    } catch (error) {
      this.logger.error('Migration failed', error as Error);
      throw error;
    }
  }

  async getCurrentVersion(): Promise<number> {
    // TODO: Implement version tracking
    return 0;
  }

  async rollbackMigration(targetVersion: number): Promise<RollbackResult> {
    this.logger.info('Rolling back migration', { targetVersion });
    
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    try {
      // Import the existing migration system
      const { MigrationManager } = await import('../migrations/migration-manager.js');
      const { migrations: existingMigrations } = await import('../migrations/migrations.js');
      
      const migrationManager = new MigrationManager(this.db);
      
      // Add existing migrations
      for (const migration of existingMigrations) {
        migrationManager.addMigration(migration);
      }
      
      const currentVersion = migrationManager.getCurrentVersion();
      
      // Perform rollback
      migrationManager.rollback(targetVersion);
      
      const newVersion = migrationManager.getCurrentVersion();
      const rolledBack = currentVersion - newVersion;
      
      this.logger.info('Migration rollback completed', { 
        rolledBack, 
        currentVersion: newVersion 
      });
      
      return {
        rolledBack,
        currentVersion: newVersion,
        rolledBackMigrations: []
      };
    } catch (error) {
      this.logger.error('Migration rollback failed', error as Error);
      throw error;
    }
  }

  // ============================================================================
  // Entity Operations (Consolidated from Core)
  // ============================================================================

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    this.logger.debug(`Creating ${entities.length} entities`);
    
    if (!this.db) throw new Error('Database not initialized');
    
    const insertEntity = this.db.prepare(`
      INSERT OR REPLACE INTO entities (id, name, entityType, observations, mentions, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((entities: Entity[]) => {
      for (const entity of entities) {
        const entityId = `entity_${entity.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
        insertEntity.run(
          entityId,
          entity.name,
          entity.entityType,
          JSON.stringify(entity.observations),
          0,
          JSON.stringify({}),
          new Date().toISOString()
        );
      }
    });

    try {
      transaction(entities);
      this.logger.info(`Successfully created ${entities.length} entities`);
      return entities;
    } catch (error) {
      this.logger.error('Failed to create entities', error as Error);
      throw error;
    }
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    this.logger.debug(`Deleting ${entityNames.length} entities`);
    
    if (!this.db) throw new Error('Database not initialized');
    
    const deleteEntity = this.db.prepare(`DELETE FROM entities WHERE name = ?`);
    const deleteRelationsBySource = this.db.prepare(`DELETE FROM relationships WHERE source_entity IN (SELECT id FROM entities WHERE name = ?)`);
    const deleteRelationsByTarget = this.db.prepare(`DELETE FROM relationships WHERE target_entity IN (SELECT id FROM entities WHERE name = ?)`);

    const transaction = this.db.transaction((entityNames: string[]) => {
      for (const entityName of entityNames) {
        // Delete relationships first
        deleteRelationsBySource.run(entityName);
        deleteRelationsByTarget.run(entityName);
        
        // Delete the entity
        deleteEntity.run(entityName);
      }
    });

    try {
      transaction(entityNames);
      this.logger.info(`Successfully deleted ${entityNames.length} entities`);
    } catch (error) {
      this.logger.error('Failed to delete entities', error as Error);
      throw error;
    }
  }

  async addObservations(observations: ObservationAddition[]): Promise<void> {
    this.logger.debug(`Adding observations to ${observations.length} entities`);
    
    if (!this.db) throw new Error('Database not initialized');
    
    const getEntity = this.db.prepare('SELECT id, observations FROM entities WHERE name = ?');
    const updateEntity = this.db.prepare('UPDATE entities SET observations = ? WHERE name = ?');

    const transaction = this.db.transaction((observations: ObservationAddition[]) => {
      for (const obs of observations) {
        const entityResult = getEntity.get(obs.entityName);
        
        if (entityResult) {
          const entity = entityResult as { id: string; observations: string };
          const existingObs = JSON.parse(entity.observations || '[]') as string[];
          const newObs = obs.contents.filter(content => !existingObs.includes(content));
          const updatedObs = [...existingObs, ...newObs];
          
          updateEntity.run(JSON.stringify(updatedObs), obs.entityName);
        } else {
          this.logger.warn(`Entity not found: ${obs.entityName}`);
        }
      }
    });

    try {
      transaction(observations);
      this.logger.info(`Successfully added observations to ${observations.length} entities`);
    } catch (error) {
      this.logger.error('Failed to add observations', error as Error);
      throw error;
    }
  }

  async deleteObservations(deletions: ObservationDeletion[]): Promise<void> {
    this.logger.debug(`Deleting observations from ${deletions.length} entities`);
    
    if (!this.db) throw new Error('Database not initialized');
    
    const getEntity = this.db.prepare('SELECT id, observations FROM entities WHERE name = ?');
    const updateEntity = this.db.prepare('UPDATE entities SET observations = ? WHERE name = ?');

    const transaction = this.db.transaction((deletions: ObservationDeletion[]) => {
      for (const deletion of deletions) {
        const entityResult = getEntity.get(deletion.entityName);
        
        if (entityResult) {
          const entity = entityResult as { id: string; observations: string };
          const existingObs = JSON.parse(entity.observations || '[]') as string[];
          const updatedObs = existingObs.filter(obs => !deletion.observations.includes(obs));
          
          updateEntity.run(JSON.stringify(updatedObs), deletion.entityName);
        } else {
          this.logger.warn(`Entity not found: ${deletion.entityName}`);
        }
      }
    });

    try {
      transaction(deletions);
      this.logger.info(`Successfully deleted observations from ${deletions.length} entities`);
    } catch (error) {
      this.logger.error('Failed to delete observations', error as Error);
      throw error;
    }
  }

  async searchNodes(query: string, limit?: number): Promise<KnowledgeGraph> {
    // TODO: Implement advanced node search with vector similarity
    throw new Error('Advanced search operations not yet implemented in SQLite adapter');
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    this.logger.debug(`Opening ${names.length} nodes`);
    
    if (!this.db) throw new Error('Database not initialized');
    
    if (names.length === 0) {
      return { entities: [], relations: [] };
    }
    
    try {
      const placeholders = names.map(() => '?').join(',');
      
      const entityRows = this.db.prepare(`
        SELECT id, name, entityType, observations, mentions, metadata, created_at 
        FROM entities 
        WHERE name IN (${placeholders})
      `).all(...names);
      
      const relationRows = this.db.prepare(`
        SELECT r.id, r.relationType, r.confidence, r.metadata, r.created_at,
               e1.name as source_name, e2.name as target_name
        FROM relationships r
        JOIN entities e1 ON r.source_entity = e1.id
        JOIN entities e2 ON r.target_entity = e2.id
        WHERE e1.name IN (${placeholders}) 
           OR e2.name IN (${placeholders})
      `).all(...names, ...names);

      const entities: Entity[] = (entityRows as any[]).map(row => ({
        name: row.name,
        entityType: row.entityType,
        observations: JSON.parse(row.observations || '[]')
      }));

      const relations: Relation[] = (relationRows as any[]).map(row => ({
        from: row.source_name,
        to: row.target_name,
        relationType: row.relationType
      }));

      this.logger.info(`Retrieved ${entities.length} entities and ${relations.length} relations`);
      
      return { entities, relations };
    } catch (error) {
      this.logger.error('Failed to open nodes', error as Error);
      throw error;
    }
  }

  async readGraph(): Promise<KnowledgeGraph> {
    this.logger.debug('Reading complete knowledge graph');
    
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const entityRows = this.db.prepare(`
        SELECT id, name, entityType, observations, mentions, metadata, created_at 
        FROM entities
      `).all();
      
      const relationRows = this.db.prepare(`
        SELECT r.id, r.relationType, r.confidence, r.metadata, r.created_at,
               e1.name as source_name, e2.name as target_name
        FROM relationships r
        JOIN entities e1 ON r.source_entity = e1.id
        JOIN entities e2 ON r.target_entity = e2.id
      `).all();

      const entities: Entity[] = (entityRows as any[]).map(row => ({
        name: row.name,
        entityType: row.entityType,
        observations: JSON.parse(row.observations || '[]')
      }));

      const relations: Relation[] = (relationRows as any[]).map(row => ({
        from: row.source_name,
        to: row.target_name,
        relationType: row.relationType
      }));

      this.logger.info(`Retrieved complete graph: ${entities.length} entities, ${relations.length} relations`);
      
      return { entities, relations };
    } catch (error) {
      this.logger.error('Failed to read graph', error as Error);
      throw error;
    }
  }

  async embedAllEntities(): Promise<EmbeddingResult> {
    // TODO: Implement entity embedding with vector storage
    throw new Error('Entity embedding operations not yet implemented');
  }

  // ============================================================================
  // Relationship Operations (Consolidated from Core)
  // ============================================================================

  async createRelations(relations: Relation[]): Promise<void> {
    this.logger.debug(`Creating ${relations.length} relations`);
    
    if (!this.db) throw new Error('Database not initialized');
    
    const insertRelation = this.db.prepare(`
      INSERT OR REPLACE INTO relationships (id, source_entity, target_entity, relationType, confidence, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const getEntityId = this.db.prepare('SELECT id FROM entities WHERE name = ?');

    const transaction = this.db.transaction((relations: Relation[]) => {
      for (const relation of relations) {
        // Get entity IDs with null checks
        const sourceResult = getEntityId.get(relation.from);
        const targetResult = getEntityId.get(relation.to);
        
        if (!sourceResult) {
          this.logger.warn(`Source entity not found: ${relation.from}`);
          continue;
        }
        
        if (!targetResult) {
          this.logger.warn(`Target entity not found: ${relation.to}`);
          continue;
        }

        const sourceEntity = sourceResult as { id: string };
        const targetEntity = targetResult as { id: string };
        const relationId = `${sourceEntity.id}-${relation.relationType}-${targetEntity.id}`;
        
        insertRelation.run(
          relationId,
          sourceEntity.id,
          targetEntity.id,
          relation.relationType,
          1.0,
          JSON.stringify({}),
          new Date().toISOString()
        );
      }
    });

    try {
      transaction(relations);
      this.logger.info(`Successfully created ${relations.length} relations`);
    } catch (error) {
      this.logger.error('Failed to create relations', error as Error);
      throw error;
    }
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    this.logger.debug(`Deleting ${relations.length} relations`);
    
    if (!this.db) throw new Error('Database not initialized');
    
    const deleteRelation = this.db.prepare(`
      DELETE FROM relationships 
      WHERE source_entity = (SELECT id FROM entities WHERE name = ?) 
        AND target_entity = (SELECT id FROM entities WHERE name = ?) 
        AND relationType = ?
    `);

    const transaction = this.db.transaction((relations: Relation[]) => {
      for (const relation of relations) {
        deleteRelation.run(relation.from, relation.to, relation.relationType);
      }
    });

    try {
      transaction(relations);
      this.logger.info(`Successfully deleted ${relations.length} relations`);
    } catch (error) {
      this.logger.error('Failed to delete relations', error as Error);
      throw error;
    }
  }

  // ============================================================================
  // Document Operations (Consolidated from Core)
  // ============================================================================

  async storeDocument(id: string, content: string, metadata?: Record<string, any>): Promise<StoreDocumentResult> {
    this.logger.debug(`Storing document: ${id}`);
    
    if (!this.db) throw new Error('Database not initialized');
    
    const insertDocument = this.db.prepare(`
      INSERT OR REPLACE INTO documents (id, content, metadata, created_at)
      VALUES (?, ?, ?, ?)
    `);

    try {
      insertDocument.run(
        id,
        content,
        JSON.stringify(metadata || {}),
        new Date().toISOString()
      );
      
      this.logger.info(`Successfully stored document: ${id}`);
      
      // Note: This basic SQLite core implementation doesn't include automatic 
      // chunking/embedding. Those features are handled by the main index.ts implementation.
      return {
        id,
        stored: true
        // chunksCreated and chunksEmbedded are undefined for basic storage
      };
    } catch (error) {
      this.logger.error(`Failed to store document: ${id}`, error as Error);
      throw error;
    }
  }

  async chunkDocument(documentId: string, options?: ChunkOptions): Promise<ChunkResult> {
    // TODO: Implement document chunking with proper position tracking
    throw new Error('Document chunking operations not yet implemented');
  }

  async embedChunks(documentId: string): Promise<EmbeddingResult> {
    // TODO: Implement chunk embedding with vector storage
    throw new Error('Document embedding operations not yet implemented');
  }

  async extractTerms(documentId: string, options?: ExtractOptions): Promise<TermResult> {
    // TODO: Implement term extraction from documents
    throw new Error('Term extraction operations not yet implemented');
  }

  async linkEntitiesToDocument(documentId: string, entityNames: string[]): Promise<void> {
    // TODO: Implement entity-document linking
    throw new Error('Entity linking operations not yet implemented');
  }

  async deleteDocuments(documentIds: string | string[]): Promise<DeletionResult> {
    // TODO: Implement document deletion with cleanup
    throw new Error('Document deletion operations not yet implemented');
  }

  async listDocuments(includeMetadata?: boolean): Promise<DocumentInfo[]> {
    this.logger.debug('Listing documents');
    
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const query = includeMetadata 
        ? 'SELECT id, metadata, created_at FROM documents'
        : 'SELECT id, created_at FROM documents';
        
      const rows = this.db.prepare(query).all() as any[];
      
      const documents: DocumentInfo[] = rows.map(row => ({
        id: row.id,
        metadata: includeMetadata ? JSON.parse(row.metadata || '{}') : undefined,
        created_at: row.created_at
      }));
      
      this.logger.info(`Retrieved ${documents.length} documents`);
      return documents;
    } catch (error) {
      this.logger.error('Failed to list documents', error as Error);
      throw error;
    }
  }

  async getDocumentContent(documentId: string): Promise<string> {
    this.logger.debug(`Getting document content: ${documentId}`);
    
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const stmt = this.db.prepare('SELECT content FROM documents WHERE id = ?');
      const row = stmt.get(documentId) as any;
      
      if (!row) {
        throw new Error(`Document not found: ${documentId}`);
      }
      
      this.logger.debug(`Retrieved document content: ${documentId} (${row.content.length} chars)`);
      return row.content;
    } catch (error) {
      this.logger.error(`Failed to get document content: ${documentId}`, error as Error);
      throw error;
    }
  }

  // ============================================================================
  // Search Operations
  // ============================================================================

  async hybridSearch(query: string, options?: SearchOptions): Promise<EnhancedSearchResult[]> {
    // TODO: Implement hybrid search combining vector and text search
    throw new Error('Hybrid search operations not yet implemented');
  }

  async getDetailedContext(chunkId: string, includeSurrounding?: boolean): Promise<DetailedContext> {
    // TODO: Implement detailed context retrieval for chunks
    throw new Error('Context retrieval operations not yet implemented');
  }

  // ============================================================================
  // Statistics and Monitoring
  // ============================================================================

  async getKnowledgeGraphStats(): Promise<KnowledgeGraphStats> {
    this.logger.debug('Getting knowledge graph statistics');
    
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      // Get counts with proper null handling
      const entityCount = this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number } | undefined;
      const relationCount = this.db.prepare('SELECT COUNT(*) as count FROM relationships').get() as { count: number } | undefined;
      const documentCount = this.db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number } | undefined;
      const chunkCount = this.db.prepare('SELECT COUNT(*) as count FROM chunk_metadata').get() as { count: number } | undefined;

      // Get type breakdowns
      const entityTypes = this.db.prepare(`
        SELECT entityType, COUNT(*) as count
        FROM entities 
        GROUP BY entityType
      `).all() as any[];

      const relationTypes = this.db.prepare(`
        SELECT relationType, COUNT(*) as count
        FROM relationships 
        GROUP BY relationType
      `).all() as any[];

      const entityTypeBreakdown: Record<string, number> = {};
      entityTypes.forEach(stat => {
        entityTypeBreakdown[stat.entityType] = stat.count;
      });

      const relationTypeBreakdown: Record<string, number> = {};
      relationTypes.forEach(stat => {
        relationTypeBreakdown[stat.relationType] = stat.count;
      });

      const stats: KnowledgeGraphStats = {
        entities: {
          total: entityCount?.count || 0,
          byType: entityTypeBreakdown
        },
        relationships: {
          total: relationCount?.count || 0,
          byType: relationTypeBreakdown
        },
        documents: {
          total: documentCount?.count || 0
        },
        chunks: {
          total: chunkCount?.count || 0,
          embedded: 0
        }
      };

      this.logger.info(`Statistics: ${stats.entities.total} entities, ${stats.relationships.total} relations`);
      
      return stats;
    } catch (error) {
      this.logger.error('Failed to get statistics', error as Error);
      throw error;
    }
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    return this.performanceMetrics;
  }

  // ============================================================================
  // Re-embedding Operations
  // ============================================================================

  async reEmbedEverything(): Promise<ReEmbedResult> {
    // TODO: Implement full re-embedding process
    throw new Error('Re-embedding operations not yet implemented');
  }

  async generateKnowledgeGraphChunks(): Promise<KnowledgeGraphChunkResult> {
    // TODO: Implement knowledge graph chunk generation
    throw new Error('Knowledge graph chunk generation not yet implemented');
  }

  async embedKnowledgeGraphChunks(): Promise<EmbeddingResult> {
    // TODO: Implement knowledge graph chunk embedding
    throw new Error('Knowledge graph chunk embedding not yet implemented');
  }
}