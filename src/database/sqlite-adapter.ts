/**
 * SQLite Database Adapter Implementation
 * 
 * This adapter implements the DatabaseAdapter interface for SQLite databases
 * with sqlite-vec extension support for vector operations.
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
  isSQLiteConfig,
  DatabaseLogger
} from './interfaces.js';

import { DatabaseLogger as Logger } from './logger.js';
import { SQLiteTransactionManager } from './transaction-manager.js';
import { SQLiteAdapterCore } from './sqlite-adapter-core.js';

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
 * SQLite Database Adapter
 */
export class SQLiteAdapter implements DatabaseAdapter {
  private db: Database.Database | null = null;
  private config: DatabaseConfig | null = null;
  private logger: DatabaseLogger;
  private embeddingModel: any = null;
  private encoding: any = null;
  private isInitialized: boolean = false;
  private performanceMetrics: PerformanceMetrics;
  private core: SQLiteAdapterCore | null = null;

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

      // Initialize core operations
      this.core = new SQLiteAdapterCore(this.db, this.logger);
      
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
  // Placeholder Methods (to be implemented)
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

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.createEntities(entities);
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.deleteEntities(entityNames);
  }

  async addObservations(observations: ObservationAddition[]): Promise<void> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.addObservations(observations);
  }

  async deleteObservations(deletions: ObservationDeletion[]): Promise<void> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.deleteObservations(deletions);
  }

  async searchNodes(query: string, limit?: number): Promise<KnowledgeGraph> {
    // TODO: Implement node search in SQLite adapter core
    throw new Error('Search operations not yet implemented in SQLite adapter');
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.openNodes(names);
  }

  async readGraph(): Promise<KnowledgeGraph> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.readGraph();
  }

  async embedAllEntities(): Promise<EmbeddingResult> {
    // TODO: Implement entity embedding
    throw new Error('Embedding operations not yet implemented');
  }

  async createRelations(relations: Relation[]): Promise<void> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.createRelations(relations);
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.deleteRelations(relations);
  }

  async storeDocument(id: string, content: string, metadata?: Record<string, any>): Promise<void> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.storeDocument(id, content, metadata);
  }

  async chunkDocument(documentId: string, options?: ChunkOptions): Promise<ChunkResult> {
    // TODO: Implement document chunking
    throw new Error('Document operations not yet implemented');
  }

  async embedChunks(documentId: string): Promise<EmbeddingResult> {
    // TODO: Implement chunk embedding
    throw new Error('Document operations not yet implemented');
  }

  async extractTerms(documentId: string, options?: ExtractOptions): Promise<TermResult> {
    // TODO: Implement term extraction
    throw new Error('Document operations not yet implemented');
  }

  async linkEntitiesToDocument(documentId: string, entityNames: string[]): Promise<void> {
    // TODO: Implement entity linking
    throw new Error('Document operations not yet implemented');
  }

  async deleteDocuments(documentIds: string | string[]): Promise<DeletionResult> {
    // TODO: Implement document deletion
    throw new Error('Document operations not yet implemented');
  }

  async listDocuments(includeMetadata?: boolean): Promise<DocumentInfo[]> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.listDocuments(includeMetadata);
  }

  async hybridSearch(query: string, options?: SearchOptions): Promise<EnhancedSearchResult[]> {
    // TODO: Implement hybrid search
    throw new Error('Search operations not yet implemented');
  }

  async getDetailedContext(chunkId: string, includeSurrounding?: boolean): Promise<DetailedContext> {
    // TODO: Implement detailed context retrieval
    throw new Error('Context operations not yet implemented');
  }

  async getKnowledgeGraphStats(): Promise<KnowledgeGraphStats> {
    if (!this.core) throw new Error('Adapter not initialized');
    return this.core.getKnowledgeGraphStats();
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    return this.performanceMetrics;
  }
}
