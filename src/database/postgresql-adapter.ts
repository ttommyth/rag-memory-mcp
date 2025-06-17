/**
 * PostgreSQL Database Adapter Implementation
 * 
 * This adapter implements the DatabaseAdapter interface for PostgreSQL databases
 * with pgvector extension support for vector operations.
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { pipeline } from '@huggingface/transformers';
import { get_encoding } from 'tiktoken';

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
  isPostgreSQLConfig,
  DatabaseLogger,
  PoolStats
} from './interfaces.js';

import { DatabaseLogger as Logger } from './logger.js';
import { ConnectionPoolManager } from './connection-pool-manager.js';
import { ConnectionHealthMonitor } from './connection-health-monitor.js';

/**
 * PostgreSQL-specific transaction implementation
 */
class PostgreSQLTransaction implements Transaction {
  private client: PoolClient;
  private transactionId: string;
  private isActiveFlag: boolean = true;
  private logger: DatabaseLogger;

  constructor(client: PoolClient, logger: DatabaseLogger) {
    this.client = client;
    this.transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.logger = logger;
  }

  async execute<T = any>(sql: string, params: any[] = []): Promise<T> {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    try {
      const result = await this.client.query(sql, params);
      return result.rows as T;
    } catch (error) {
      this.logger.error(`Transaction execute error: ${error}`, error as Error, { sql, params });
      throw error;
    }
  }

  prepare<T = any>(sql: string) {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    const client = this.client;
    return {
      async run(...params: any[]): Promise<RunResult> {
        const result = await client.query(sql, params);
        return {
          changes: result.rowCount || 0,
          lastInsertRowid: result.rows[0]?.id || undefined
        };
      },
      async get(...params: any[]): Promise<T | undefined> {
        const result = await client.query(sql, params);
        return result.rows[0] as T | undefined;
      },
      async all(...params: any[]): Promise<T[]> {
        const result = await client.query(sql, params);
        return result.rows as T[];
      },
      async finalize(): Promise<void> {
        // PostgreSQL doesn't require explicit statement finalization
      }
    };
  }

  async commit(): Promise<void> {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    try {
      await this.client.query('COMMIT');
      this.isActiveFlag = false;
      this.logger.debug(`Transaction committed: ${this.transactionId}`);
    } catch (error) {
      this.logger.error(`Transaction commit error: ${error}`, error as Error);
      throw error;
    } finally {
      this.client.release();
    }
  }

  async rollback(): Promise<void> {
    if (!this.isActiveFlag) {
      return; // Already rolled back or committed
    }

    try {
      await this.client.query('ROLLBACK');
      this.isActiveFlag = false;
      this.logger.debug(`Transaction rolled back: ${this.transactionId}`);
    } catch (error) {
      this.logger.error(`Transaction rollback error: ${error}`, error as Error);
      throw error;
    } finally {
      this.client.release();
    }
  }

  async savepoint(name: string): Promise<void> {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    await this.client.query(`SAVEPOINT ${name}`);
    this.logger.debug(`Savepoint created: ${name} in transaction ${this.transactionId}`);
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    this.logger.debug(`Rolled back to savepoint: ${name} in transaction ${this.transactionId}`);
  }

  async releaseSavepoint(name: string): Promise<void> {
    if (!this.isActiveFlag) {
      throw new Error('Transaction is not active');
    }

    await this.client.query(`RELEASE SAVEPOINT ${name}`);
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
 * PostgreSQL Database Adapter
 */
export class PostgreSQLAdapter implements DatabaseAdapter {
  private pool: Pool | null = null;
  private config: DatabaseConfig | null = null;
  private logger: DatabaseLogger;
  private connectionManager: ConnectionPoolManager | null = null;
  private healthMonitor: ConnectionHealthMonitor | null = null;
  private embeddingModel: any = null;
  private encoding: any = null;
  private isInitialized: boolean = false;
  private performanceMetrics: PerformanceMetrics;

  constructor(logger?: DatabaseLogger) {
    this.logger = logger || new Logger();
    this.performanceMetrics = {
      queryLatency: { avg: 0, p50: 0, p95: 0, p99: 0 },
      connectionPool: { active: 0, idle: 0, waiting: 0, total: 0 },
      vectorSearch: { avgLatency: 0, totalQueries: 0 },
      memoryUsage: { heapUsed: 0, heapTotal: 0, external: 0 }
    };
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async initialize(config: DatabaseConfig): Promise<void> {
    if (!isPostgreSQLConfig(config)) {
      throw new Error('Invalid PostgreSQL configuration provided');
    }

    this.config = config;
    this.logger.info('Initializing PostgreSQL adapter', { 
      host: config.postgresql.host,
      port: config.postgresql.port,
      database: config.postgresql.database
    });

    try {
      // Create connection pool configuration
      const poolConfig: PoolConfig = {
        host: config.postgresql.host,
        port: config.postgresql.port,
        database: config.postgresql.database,
        user: config.postgresql.username,
        password: config.postgresql.password,
        ssl: config.postgresql.ssl,
        min: config.postgresql.pool?.min || 2,
        max: config.postgresql.pool?.max || 20,
        idleTimeoutMillis: config.postgresql.pool?.idleTimeoutMillis || 30000,
        connectionTimeoutMillis: config.postgresql.pool?.connectionTimeoutMillis || 5000,
        statement_timeout: config.queryTimeout || 30000
      };

      // Initialize connection pool manager
      this.connectionManager = new ConnectionPoolManager(this.logger);
      
      // Create managed pool
      this.pool = await this.connectionManager.createPool('default', config);
      
      // Initialize health monitoring
      this.healthMonitor = new ConnectionHealthMonitor(this.pool, this.logger, {
        checkIntervalMs: 30000, // Check every 30 seconds
        maxRetries: 3,
        retryDelayMs: 5000,
        healthCheckTimeoutMs: 10000
      });

      // Test connection and ensure pgvector extension
      await this.ensurePgvectorExtension();

      // Deploy full PostgreSQL schema
      await this.deployFullSchema();

      // Initialize tiktoken encoding
      this.encoding = get_encoding("cl100k_base");

      // Initialize embedding model
      await this.initializeEmbeddingModel();

      this.isInitialized = true;
      
      // Start health monitoring
      if (this.healthMonitor) {
        this.healthMonitor.startMonitoring();
      }
      
      this.logger.info('PostgreSQL adapter initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize PostgreSQL adapter', error as Error);
      throw error;
    }
  }

  private parseObservations(observations: any): string[] {
    try {
      if (typeof observations === 'string') {
        return JSON.parse(observations);
      } else if (Array.isArray(observations)) {
        return observations;
      } else {
        return [];
      }
    } catch (error) {
      // If parsing fails, treat as single observation
      return typeof observations === 'string' ? [observations] : [];
    }
  }

  async query(sql: string, params?: any[]): Promise<any[]> {
    if (!this.pool) throw new Error('Database not initialized');
    
    // Use connection manager with retry logic if available
    let client: PoolClient;
    if (this.connectionManager) {
      client = await this.connectionManager.getClientWithRetry('default');
    } else {
      client = await this.pool.connect();
    }
    
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } catch (error) {
      // Log query errors with context
      this.logger.error('Query execution failed', error as Error, { sql: sql.substring(0, 100), params });
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    // Stop health monitoring
    if (this.healthMonitor) {
      this.healthMonitor.stopMonitoring();
      this.healthMonitor = null;
    }
    
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connectionManager = null;
      this.isInitialized = false;
      this.logger.info('PostgreSQL adapter closed');
    }
  }

  isConnected(): boolean {
    return this.isInitialized && this.pool !== null;
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
      // Health check query with pgvector test
      const client = await this.pool!.connect();
      try {
        await client.query('SELECT 1');
        await client.query("SELECT '[1,2,3]'::vector(3)"); // Test pgvector
        
        const latency = Date.now() - startTime;
        const poolStats = this.connectionManager!.getStats();

        return {
          status: latency < 100 ? 'healthy' : 'degraded',
          latency,
          connections: {
            active: poolStats.totalCount - poolStats.idleCount,
            idle: poolStats.idleCount,
            total: poolStats.totalCount
          },
          lastCheck: new Date(),
          errors: []
        };
      } finally {
        client.release();
      }
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

    const client = await this.pool!.connect();
    await client.query('BEGIN');
    return new PostgreSQLTransaction(client, this.logger);
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

  private async createBasicEntitiesTable(client: any): Promise<void> {
    try {
      // Create basic entities table for MVP
      await client.query(`
        CREATE TABLE IF NOT EXISTS entities (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          entity_type VARCHAR(100) DEFAULT 'CONCEPT',
          observations JSONB DEFAULT '[]'::jsonb,
          mentions INTEGER DEFAULT 0,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create basic indexes
      await client.query('CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type)');

      this.logger.info('Basic entities table created for MVP');
    } catch (error) {
      this.logger.error('Failed to create basic entities table', error as Error);
      throw error;
    }
  }

  private async deployFullSchema(): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    try {
      this.logger.info('Deploying full PostgreSQL schema...');
      
      // Use inline schema for MVP (more reliable than file-based schema)
      const schemaSQL = this.getInlineSchema();
      
      // Split schema into individual statements and execute one by one
      const statements = schemaSQL
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => {
          // Remove empty statements and pure comment lines
          if (stmt.length === 0) return false;
          if (stmt.startsWith('--') && !stmt.includes('CREATE')) return false;
          return true;
        });
      
      this.logger.info(`Executing ${statements.length} schema statements...`);
      
      // Execute each statement individually (no transaction to avoid rollbacks)
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (statement.trim()) {
          try {
            await client.query(statement);
            this.logger.info(`✅ Statement ${i + 1}/${statements.length}: ${statement.substring(0, 50)}...`);
          } catch (error) {
            // Log but continue for statements that might already exist
            if ((error as any).message?.includes('already exists')) {
              this.logger.info(`ℹ️  Statement ${i + 1}/${statements.length} already exists: ${statement.substring(0, 50)}...`);
            } else {
              this.logger.error(`❌ Statement ${i + 1}/${statements.length} failed: ${statement}`, error as Error);
              // Don't throw, just continue with next statement
            }
          }
        }
      }
      
      // Create indexes separately (they can fail without breaking core functionality)
      this.logger.info('Creating indexes...');
      await this.createPostgreSQLIndexes(client);
      
      // Ensure chunk_entities constraint exists (for existing deployments)
      try {
        await client.query(`
          DO $$
          BEGIN
              IF NOT EXISTS (
                  SELECT 1 FROM pg_constraint 
                  WHERE conname = 'chunk_entities_chunk_metadata_id_entity_id_key'
              ) THEN
                  ALTER TABLE chunk_entities 
                  ADD CONSTRAINT chunk_entities_chunk_metadata_id_entity_id_key 
                  UNIQUE (chunk_metadata_id, entity_id);
              END IF;
          END $$;
        `);
        this.logger.info('chunk_entities constraint verified/added');
      } catch (error) {
        this.logger.warn('Failed to add/verify chunk_entities constraint:', error);
      }
      
      this.logger.info('Full PostgreSQL schema deployed successfully');
    } finally {
      client.release();
    }
  }

  private getInlineSchema(): string {
    // Inline schema for MVP deployment - Step by step approach
    return `
      -- Enable pgvector extension
      CREATE EXTENSION IF NOT EXISTS vector;
      
      -- Core entities table (no foreign keys initially)
      CREATE TABLE IF NOT EXISTS entities (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        entity_type VARCHAR(100) DEFAULT 'CONCEPT',
        observations JSONB DEFAULT '[]'::jsonb,
        mentions INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Documents table (no foreign keys)
      CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(255) PRIMARY KEY,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Relationships table (basic structure, no foreign keys initially)
      CREATE TABLE IF NOT EXISTS relationships (
        id VARCHAR(255) PRIMARY KEY,
        source_entity VARCHAR(255) NOT NULL,
        target_entity VARCHAR(255) NOT NULL,
        relation_type VARCHAR(100) NOT NULL,
        confidence REAL DEFAULT 1.0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Chunk metadata table (minimal foreign keys)
      CREATE TABLE IF NOT EXISTS chunk_metadata (
        id SERIAL PRIMARY KEY,
        chunk_id VARCHAR(255) NOT NULL UNIQUE,
        chunk_type VARCHAR(50) DEFAULT 'document',
        document_id VARCHAR(255),
        entity_id VARCHAR(255),
        relationship_id VARCHAR(255),
        chunk_index INTEGER DEFAULT 0,
        text TEXT NOT NULL,
        start_pos INTEGER DEFAULT 0,
        end_pos INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Vector embeddings for chunks
      CREATE TABLE IF NOT EXISTS chunks (
        id SERIAL PRIMARY KEY,
        chunk_metadata_id INTEGER NOT NULL,
        embedding vector(384) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Vector embeddings for entities
      CREATE TABLE IF NOT EXISTS entity_embeddings (
        id SERIAL PRIMARY KEY,
        entity_id VARCHAR(255) NOT NULL UNIQUE,
        embedding vector(384) NOT NULL,
        embedding_text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Chunk-entity associations
      CREATE TABLE IF NOT EXISTS chunk_entities (
        id SERIAL PRIMARY KEY,
        chunk_metadata_id INTEGER NOT NULL,
        entity_id VARCHAR(255) NOT NULL,
        relevance_score REAL DEFAULT 1.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (chunk_metadata_id, entity_id)
      );
      
      -- Schema migrations tracking
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
  }

  private async createPostgreSQLIndexes(client: any): Promise<void> {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)',
      'CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity)', 
      'CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(relation_type)',
      'CREATE INDEX IF NOT EXISTS idx_chunk_metadata_document ON chunk_metadata(document_id)',
      'CREATE INDEX IF NOT EXISTS idx_chunk_metadata_entity ON chunk_metadata(entity_id)',
      'CREATE INDEX IF NOT EXISTS idx_chunks_metadata_id ON chunks(chunk_metadata_id)',
      'CREATE INDEX IF NOT EXISTS idx_entity_embeddings_entity ON entity_embeddings(entity_id)',
      'CREATE INDEX IF NOT EXISTS idx_chunk_entities_chunk ON chunk_entities(chunk_metadata_id)',
      'CREATE INDEX IF NOT EXISTS idx_chunk_entities_entity ON chunk_entities(entity_id)'
    ];

    for (const indexSQL of indexes) {
      try {
        await client.query(indexSQL);
        this.logger.debug(`Index created: ${indexSQL.substring(0, 50)}...`);
      } catch (error) {
        if ((error as any).message?.includes('already exists')) {
          this.logger.debug(`Index already exists: ${indexSQL.substring(0, 50)}...`);
        } else {
          this.logger.warn(`Index creation failed: ${indexSQL}`, error as Error);
        }
      }
    }
  }

  private async ensurePgvectorExtension(): Promise<void> {
    const client = await this.pool!.connect();
    try {
      // Check if pgvector extension exists
      const result = await client.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
      );

      if (result.rows.length === 0) {
        // Try to create the extension
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
        this.logger.info('pgvector extension created');
      } else {
        this.logger.info('pgvector extension already exists');
      }

      // Test halfvec support
      await client.query("SELECT '[1,2,3]'::halfvec(3)");
      this.logger.info('halfvec data type confirmed working');

    } catch (error) {
      this.logger.error('Failed to ensure pgvector extension', error as Error);
      throw new Error(`pgvector extension not available: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

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

  private convertToHalfvec(embedding: Float32Array): string {
    // Convert Float32Array to halfvec format string
    return `[${Array.from(embedding).join(',')}]`;
  }

  // ============================================================================
  // Placeholder Methods (to be implemented)
  // ============================================================================

  async runMigrations(migrations: Migration[]): Promise<MigrationResult> {
    if (!this.pool) throw new Error('Database not initialized');
    
    this.logger.info('Running PostgreSQL migrations...');
    
    return this.executeInTransaction(async (tx) => {
      // Ensure schema_migrations table exists first
      await tx.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          description TEXT NOT NULL,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Get current version
      const currentVersionResult = await tx.execute('SELECT MAX(version) as version FROM schema_migrations');
      const currentVersion = Array.isArray(currentVersionResult) && currentVersionResult.length > 0 
        ? (currentVersionResult[0].version || 0) 
        : 0;
      
      // Filter pending migrations
      const pendingMigrations = migrations
        .filter(m => m.version > currentVersion)
        .sort((a, b) => a.version - b.version);
      
      if (pendingMigrations.length === 0) {
        this.logger.info('Database schema is up to date', { currentVersion });
        return {
          applied: 0,
          currentVersion,
          appliedMigrations: []
        };
      }
      
      this.logger.info(`Running ${pendingMigrations.length} pending migrations...`);
      
      const appliedMigrations: Array<{ version: number; description: string }> = [];
      
      for (const migration of pendingMigrations) {
        try {
          this.logger.info(`Applying migration ${migration.version}: ${migration.description}`);
          
          // For PostgreSQL, execute specific PostgreSQL-compatible migration SQL
          await this.executePostgreSQLMigration(tx, migration);
          
          // Record the migration as applied
          await tx.execute(
            'INSERT INTO schema_migrations (version, description) VALUES ($1, $2)',
            [migration.version, migration.description]
          );
          
          appliedMigrations.push({
            version: migration.version,
            description: migration.description
          });
          
          this.logger.info(`Migration ${migration.version} applied successfully`);
          
        } catch (error) {
          this.logger.error(`Migration ${migration.version} failed`, error as Error);
          throw new Error(`Migration ${migration.version} failed: ${(error as Error).message}`);
        }
      }
      
      // Get final version
      const finalVersionResult = await tx.execute('SELECT MAX(version) as version FROM schema_migrations');
      const newCurrentVersion = Array.isArray(finalVersionResult) && finalVersionResult.length > 0 
        ? (finalVersionResult[0].version || 0) 
        : 0;
      
      this.logger.info(`Migrations completed: ${appliedMigrations.length} applied, current version: ${newCurrentVersion}`);
      
      return {
        applied: appliedMigrations.length,
        currentVersion: newCurrentVersion,
        appliedMigrations
      };
    });
  }

  private async executePostgreSQLMigration(tx: Transaction, migration: Migration): Promise<void> {
    // Execute PostgreSQL-specific migrations based on version
    switch (migration.version) {
      case 1:
        // Migration 1: Complete RAG Knowledge Graph schema
        await this.executePostgreSQLMigration1(tx);
        break;
      case 2:
        // Migration 2: Enhanced hybrid search - add chunk_type support
        await this.executePostgreSQLMigration2(tx);
        break;
      default:
        this.logger.warn(`No PostgreSQL migration defined for version ${migration.version}, skipping SQL execution`);
    }
  }

  private async executePostgreSQLMigration1(tx: Transaction): Promise<void> {
    // This migration ensures all core tables exist with proper PostgreSQL schema
    // Note: This is mostly already handled by deployFullSchema(), but we ensure consistency
    
    const migration1SQL = [
      // Ensure pgvector extension
      `CREATE EXTENSION IF NOT EXISTS vector;`,
      
      // Core entities table
      `CREATE TABLE IF NOT EXISTS entities (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        entity_type VARCHAR(100) DEFAULT 'CONCEPT',
        observations JSONB DEFAULT '[]'::jsonb,
        mentions INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`,
      
      // Documents table
      `CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(255) PRIMARY KEY,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`,
      
      // Relationships table
      `CREATE TABLE IF NOT EXISTS relationships (
        id VARCHAR(255) PRIMARY KEY,
        source_entity VARCHAR(255) NOT NULL,
        target_entity VARCHAR(255) NOT NULL,
        relation_type VARCHAR(100) NOT NULL,
        confidence REAL DEFAULT 1.0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`,
      
      // Chunk metadata table
      `CREATE TABLE IF NOT EXISTS chunk_metadata (
        id SERIAL PRIMARY KEY,
        chunk_id VARCHAR(255) NOT NULL UNIQUE,
        chunk_type VARCHAR(50) DEFAULT 'document',
        document_id VARCHAR(255),
        entity_id VARCHAR(255),
        relationship_id VARCHAR(255),
        chunk_index INTEGER DEFAULT 0,
        text TEXT NOT NULL,
        start_pos INTEGER DEFAULT 0,
        end_pos INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`,
      
      // Vector embeddings for chunks
      `CREATE TABLE IF NOT EXISTS chunks (
        id SERIAL PRIMARY KEY,
        chunk_metadata_id INTEGER NOT NULL,
        embedding vector(384) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`,
      
      // Vector embeddings for entities
      `CREATE TABLE IF NOT EXISTS entity_embeddings (
        id SERIAL PRIMARY KEY,
        entity_id VARCHAR(255) NOT NULL UNIQUE,
        embedding vector(384) NOT NULL,
        embedding_text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`,
      
      // Chunk-entity associations with proper constraint
      `CREATE TABLE IF NOT EXISTS chunk_entities (
        id SERIAL PRIMARY KEY,
        chunk_metadata_id INTEGER NOT NULL,
        entity_id VARCHAR(255) NOT NULL,
        relevance_score REAL DEFAULT 1.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (chunk_metadata_id, entity_id)
      );`
    ];
    
    // Execute each statement
    for (const sql of migration1SQL) {
      try {
        await tx.execute(sql.trim());
      } catch (error) {
        // Log but continue if table already exists
        if ((error as any).message?.includes('already exists')) {
          this.logger.debug(`Object already exists: ${sql.substring(0, 50)}...`);
        } else {
          throw error;
        }
      }
    }
  }

  private async executePostgreSQLMigration2(tx: Transaction): Promise<void> {
    // Migration 2: Enhanced hybrid search features
    // The chunk_type, entity_id, and relationship_id columns should already exist from migration 1
    // This migration ensures they have proper values and indexes
    
    const migration2SQL = [
      // Ensure chunk_type column exists and has default values
      `UPDATE chunk_metadata SET chunk_type = 'document' WHERE chunk_type IS NULL;`,
      
      // Create indexes for new columns if they don't exist
      `CREATE INDEX IF NOT EXISTS idx_chunk_metadata_type ON chunk_metadata(chunk_type);`,
      `CREATE INDEX IF NOT EXISTS idx_chunk_metadata_entity ON chunk_metadata(entity_id);`,
      `CREATE INDEX IF NOT EXISTS idx_chunk_metadata_relationship ON chunk_metadata(relationship_id);`,
      
      // Ensure unique constraint exists for chunk_entities
      `DO $$
       BEGIN
           IF NOT EXISTS (
               SELECT 1 FROM pg_constraint 
               WHERE conname = 'chunk_entities_chunk_metadata_id_entity_id_key'
           ) THEN
               ALTER TABLE chunk_entities 
               ADD CONSTRAINT chunk_entities_chunk_metadata_id_entity_id_key 
               UNIQUE (chunk_metadata_id, entity_id);
           END IF;
       END $$;`
    ];
    
    // Execute each statement
    for (const sql of migration2SQL) {
      try {
        await tx.execute(sql.trim());
      } catch (error) {
        this.logger.warn(`Migration 2 statement warning: ${(error as Error).message}`);
        // Continue with other statements
      }
    }
  }

  async getCurrentVersion(): Promise<number> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    try {
      // Ensure schema_migrations table exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          description TEXT NOT NULL,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      const result = await client.query('SELECT MAX(version) as version FROM schema_migrations');
      return result.rows[0]?.version || 0;
    } catch (error) {
      this.logger.error('Failed to get current version', error as Error);
      return 0;
    } finally {
      client.release();
    }
  }

  async rollbackMigration(targetVersion: number): Promise<RollbackResult> {
    if (!this.pool) throw new Error('Database not initialized');
    
    this.logger.info('Rolling back PostgreSQL migrations...', { targetVersion });
    
    return this.executeInTransaction(async (tx) => {
      // Ensure schema_migrations table exists
      await tx.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          description TEXT NOT NULL,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Get current version
      const currentVersionResult = await tx.execute('SELECT MAX(version) as version FROM schema_migrations');
      const currentVersion = Array.isArray(currentVersionResult) && currentVersionResult.length > 0 
        ? (currentVersionResult[0].version || 0) 
        : 0;
      
      if (targetVersion >= currentVersion) {
        this.logger.info('Target version is not lower than current version', { targetVersion, currentVersion });
        return {
          rolledBack: 0,
          currentVersion,
          rolledBackMigrations: []
        };
      }
      
      // Get migrations to rollback
      const migrationsToRollback = await tx.execute(
        'SELECT version, description FROM schema_migrations WHERE version > $1 AND version <= $2 ORDER BY version DESC',
        [targetVersion, currentVersion]
      );
      
      const rolledBackMigrations: Array<{ version: number; description: string }> = [];
      
      if (Array.isArray(migrationsToRollback)) {
        for (const migration of migrationsToRollback) {
          try {
            this.logger.info(`Rolling back migration ${migration.version}: ${migration.description}`);
            
            // Note: PostgreSQL rollback is limited for MVP since schema is deployed inline
            // We remove the migration record but don't execute rollback SQL
            // This is because the Migration interface expects SQLite Database, not PostgreSQL client
            
            // Remove migration record
            await tx.execute(
              'DELETE FROM schema_migrations WHERE version = $1',
              [migration.version]
            );
            
            rolledBackMigrations.push({
              version: migration.version,
              description: migration.description
            });
            
            this.logger.info(`Migration ${migration.version} rolled back successfully`);
            
          } catch (error) {
            this.logger.error(`Rollback ${migration.version} failed`, error as Error);
            throw new Error(`Rollback ${migration.version} failed: ${(error as Error).message}`);
          }
        }
      }
      
      // Get final version
      const finalVersionResult = await tx.execute('SELECT MAX(version) as version FROM schema_migrations');
      const newCurrentVersion = Array.isArray(finalVersionResult) && finalVersionResult.length > 0 
        ? (finalVersionResult[0].version || 0) 
        : 0;
      
      this.logger.info(`Rollback completed: ${rolledBackMigrations.length} rolled back, current version: ${newCurrentVersion}`);
      
      return {
        rolledBack: rolledBackMigrations.length,
        currentVersion: newCurrentVersion,
        rolledBackMigrations
      };
    });
  }


  async createEntities(entities: Entity[]): Promise<Entity[]> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    try {
      const createdEntities: Entity[] = [];
      
      for (const entity of entities) {
        // Generate entity ID
        const entityId = `entity_${entity.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        
        // Insert entity (ignore if exists) - basic version without full schema
        const insertQuery = `
          INSERT INTO entities (id, name, entity_type, observations, metadata)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (name) DO NOTHING
          RETURNING *
        `;
        
        const result = await client.query(insertQuery, [
          entityId,
          entity.name,
          entity.entityType || 'CONCEPT',
          JSON.stringify(entity.observations || []),
          JSON.stringify({}) // Empty metadata for MVP
        ]);
        
        if (result.rows.length > 0) {
          const row = result.rows[0];
          createdEntities.push({
            name: row.name,
            entityType: row.entity_type,
            observations: this.parseObservations(row.observations)
          });
        } else {
          // Entity already exists, add it to results
          createdEntities.push(entity);
        }
      }
      
      return createdEntities;
    } catch (error) {
      // If table doesn't exist, create basic entities table
      if ((error as any).code === '42P01') { // Table does not exist
        await this.createBasicEntitiesTable(client);
        // Retry the operation
        return this.createEntities(entities);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');
    if (entityNames.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const entityName of entityNames) {
        // Get entity ID first
        const entityQuery = `SELECT id FROM entities WHERE name = $1`;
        const entityResult = await client.query(entityQuery, [entityName]);

        if (entityResult.rows.length === 0) {
          this.logger.warn(`Entity not found: ${entityName}`);
          continue;
        }

        const entityId = entityResult.rows[0].id;

        // Delete in order: embeddings, chunk associations, relationships, entity
        // 1. Delete entity embeddings
        await client.query('DELETE FROM entity_embeddings WHERE entity_id = $1', [entityId]);

        // 2. Delete chunk-entity associations  
        await client.query('DELETE FROM chunk_entities WHERE entity_id = $1', [entityId]);

        // 3. Delete relationships (both as source and target)
        await client.query(
          'DELETE FROM relationships WHERE source_entity = $1 OR target_entity = $1', 
          [entityId]
        );

        // 4. Delete the entity itself
        await client.query('DELETE FROM entities WHERE id = $1', [entityId]);

        this.logger.debug(`Successfully deleted entity: ${entityName}`);
      }

      await client.query('COMMIT');
      this.logger.info(`Successfully deleted ${entityNames.length} entities`);

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to delete entities', error as Error);
      throw new Error(`Failed to delete entities: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  async addObservations(observations: ObservationAddition[]): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');
    if (observations.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const obs of observations) {
        // Get current observations for the entity
        const entityQuery = `
          SELECT name, observations 
          FROM entities 
          WHERE name = $1
        `;
        const entityResult = await client.query(entityQuery, [obs.entityName]);

        if (entityResult.rows.length === 0) {
          this.logger.warn(`Entity not found: ${obs.entityName}`);
          continue;
        }

        const entity = entityResult.rows[0];
        const existingObs = Array.isArray(entity.observations) ? entity.observations : [];
        
        // Filter out duplicate observations
        const newObs = obs.contents.filter(content => !existingObs.includes(content));
        
        if (newObs.length > 0) {
          // Merge existing and new observations
          const updatedObs = [...existingObs, ...newObs];
          
          // Update entity with new observations using JSONB
          const updateQuery = `
            UPDATE entities 
            SET observations = $1::jsonb 
            WHERE name = $2
          `;
          await client.query(updateQuery, [JSON.stringify(updatedObs), obs.entityName]);
          
          this.logger.debug(`Added ${newObs.length} new observations to entity: ${obs.entityName}`);
        } else {
          this.logger.debug(`No new observations to add for entity: ${obs.entityName}`);
        }
      }

      await client.query('COMMIT');
      this.logger.info(`Successfully processed observations for ${observations.length} entities`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to add observations', error as Error);
      throw new Error(`Failed to add observations: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  async deleteObservations(deletions: ObservationDeletion[]): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');
    if (deletions.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const deletion of deletions) {
        // Get current observations for the entity
        const entityQuery = `
          SELECT name, observations 
          FROM entities 
          WHERE name = $1
        `;
        const entityResult = await client.query(entityQuery, [deletion.entityName]);

        if (entityResult.rows.length === 0) {
          this.logger.warn(`Entity not found: ${deletion.entityName}`);
          continue;
        }

        const entity = entityResult.rows[0];
        const existingObs = Array.isArray(entity.observations) ? entity.observations : [];
        
        // Filter out observations to be deleted
        const updatedObs = existingObs.filter((obs: string) => !deletion.observations.includes(obs));
        
        // Only update if there are changes
        if (updatedObs.length !== existingObs.length) {
          // Update entity with filtered observations using JSONB
          const updateQuery = `
            UPDATE entities 
            SET observations = $1::jsonb 
            WHERE name = $2
          `;
          await client.query(updateQuery, [JSON.stringify(updatedObs), deletion.entityName]);
          
          const deletedCount = existingObs.length - updatedObs.length;
          this.logger.debug(`Deleted ${deletedCount} observations from entity: ${deletion.entityName}`);
        } else {
          this.logger.debug(`No observations to delete for entity: ${deletion.entityName}`);
        }
      }

      await client.query('COMMIT');
      this.logger.info(`Successfully processed observation deletions for ${deletions.length} entities`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to delete observations', error as Error);
      throw new Error(`Failed to delete observations: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  async searchNodes(
    query: string, 
    limit = 10, 
    nodeTypesToSearch: Array<'entity' | 'documentChunk'> = ['entity', 'documentChunk']
  ): Promise<KnowledgeGraph & { documentChunks?: any[] }> {
    if (!this.pool) throw new Error('Database not initialized');
    
    this.logger.info(`Semantic node search: "${query}", types: ${nodeTypesToSearch.join(', ')}`);
    
    const client = await this.pool.connect();
    try {
      const results: KnowledgeGraph & { documentChunks?: any[] } = { 
        entities: [], 
        relations: [], 
        documentChunks: [] 
      };

      // Generate query embedding for vector searches
      let queryEmbedding: Float32Array | null = null;
      try {
        queryEmbedding = await this.generateEmbedding(query);
      } catch (error) {
        this.logger.warn('Failed to generate query embedding, using text search only', error as Error);
      }

      // Search entities if requested
      if (nodeTypesToSearch.includes('entity')) {
        let entities: Entity[] = [];
        
        // Try vector search first if embeddings available
        if (queryEmbedding) {
          try {
            const embeddingArray = Array.from(queryEmbedding);
            
            const vectorSearchQuery = `
              SELECT e.name, e.entity_type, e.observations,
                     (1 - (ee.embedding <=> $1::vector)) as similarity
              FROM entities e
              JOIN entity_embeddings ee ON e.id = ee.entity_id
              ORDER BY ee.embedding <=> $1::vector
              LIMIT $2
            `;
            
            const vectorResult = await client.query(vectorSearchQuery, [
              JSON.stringify(embeddingArray),
              limit
            ]);
            
            if (vectorResult.rows.length > 0) {
              entities = vectorResult.rows.map(row => ({
                name: row.name,
                entityType: row.entity_type,
                observations: this.parseObservations(row.observations),
                similarity: parseFloat(row.similarity) || 0
              }));
            }
          } catch (vectorError) {
            this.logger.warn('Vector search failed, falling back to text search', vectorError as Error);
          }
        }
        
        // Fallback: Basic text search on entity names and observations
        if (entities.length === 0) {
          const textSearchQuery = `
            SELECT e.name, e.entity_type, e.observations,
                   ts_rank(to_tsvector('english', e.name || ' ' || array_to_string(
                     ARRAY(SELECT jsonb_array_elements_text(e.observations)), ' '
                   )), plainto_tsquery('english', $1)) as rank
            FROM entities e
            WHERE to_tsvector('english', e.name || ' ' || array_to_string(
              ARRAY(SELECT jsonb_array_elements_text(e.observations)), ' '
            )) @@ plainto_tsquery('english', $1)
            ORDER BY rank DESC, e.mentions DESC
            LIMIT $2
          `;
          
          const result = await client.query(textSearchQuery, [query, limit]);
          
          entities = result.rows.map(row => ({
            name: row.name,
            entityType: row.entity_type,
            observations: this.parseObservations(row.observations),
            similarity: parseFloat(row.rank) || 0
          }));
        }
        
        results.entities = entities;

        // Get relationships between found entities
        if (entities.length > 0) {
          const entityNames = entities.map(e => e.name);
          const relationPlaceholders1 = entityNames.map((_, i) => `$${i + 1}`).join(', ');
          const relationPlaceholders2 = entityNames.map((_, i) => `$${i + entityNames.length + 1}`).join(', ');
          
          const relationsQuery = `
            SELECT 
              e1.name as from_name,
              e2.name as to_name,
              r.relation_type as "relationType"
            FROM relationships r
            JOIN entities e1 ON r.source_entity = e1.id
            JOIN entities e2 ON r.target_entity = e2.id
            WHERE e1.name IN (${relationPlaceholders1})
              AND e2.name IN (${relationPlaceholders2})
            ORDER BY e1.name, e2.name
          `;
          
          const relationsResult = await client.query(relationsQuery, [...entityNames, ...entityNames]);
          
          results.relations = relationsResult.rows.map(row => ({
            from: row.from_name,
            to: row.to_name,
            relationType: row.relationType
          }));
        }
        
        this.logger.info(`Found ${results.entities.length} entities and ${results.relations.length} related relations`);
      }

      // Search document chunks if requested
      if (nodeTypesToSearch.includes('documentChunk')) {
        const chunkLimit = limit - (results.entities.length); // Adjust limit if entities were found
        if (chunkLimit > 0) {
          let documentChunks: any[] = [];
          
          // Try vector search first if embeddings available
          if (queryEmbedding) {
            try {
              const embeddingArray = Array.from(queryEmbedding);
              
              const chunkVectorQuery = `
                SELECT 
                  cm.chunk_id,
                  cm.document_id,
                  cm.text,
                  cm.chunk_type,
                  (1 - (c.embedding::vector <=> $1::vector)) as similarity,
                  d.metadata as document_metadata_json
                FROM chunk_metadata cm
                JOIN chunks c ON cm.id = c.chunk_metadata_id
                LEFT JOIN documents d ON cm.document_id = d.id
                WHERE cm.chunk_type = 'document'
                ORDER BY c.embedding::vector <=> $1::vector
                LIMIT $2
              `;
              
              const chunkResult = await client.query(chunkVectorQuery, [
                JSON.stringify(embeddingArray),
                chunkLimit
              ]);
              
              if (chunkResult.rows.length > 0) {
                documentChunks = chunkResult.rows.map(row => ({
                  chunk_id: row.chunk_id,
                  document_id: row.document_id,
                  text: row.text,
                  similarity: parseFloat(row.similarity) || 0,
                  document_metadata: row.document_metadata_json ? JSON.parse(row.document_metadata_json) : {}
                }));
              }
            } catch (vectorError) {
              this.logger.warn('Chunk vector search failed, falling back to text search', vectorError as Error);
            }
          }
          
          // Fallback: Basic text search on chunk content
          if (documentChunks.length === 0) {
            const chunkTextQuery = `
              SELECT 
                cm.chunk_id,
                cm.document_id,
                cm.text,
                cm.chunk_type,
                ts_rank(to_tsvector('english', cm.text), plainto_tsquery('english', $1)) as rank,
                d.metadata as document_metadata_json
              FROM chunk_metadata cm
              LEFT JOIN documents d ON cm.document_id = d.id
              WHERE cm.chunk_type = 'document'
                AND to_tsvector('english', cm.text) @@ plainto_tsquery('english', $1)
              ORDER BY rank DESC
              LIMIT $2
            `;
            
            const chunkResult = await client.query(chunkTextQuery, [query, chunkLimit]);
            
            documentChunks = chunkResult.rows.map(row => ({
              chunk_id: row.chunk_id,
              document_id: row.document_id,
              text: row.text,
              similarity: parseFloat(row.rank) || 0,
              document_metadata: row.document_metadata_json ? JSON.parse(row.document_metadata_json) : {}
            }));
          }
          
          results.documentChunks = documentChunks;
          this.logger.info(`Found ${documentChunks.length} document chunks`);
        }
      }
      
      return results;
    } finally {
      client.release();
    }
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    if (!this.pool) throw new Error('Database not initialized');
    
    // Return empty graph if no names provided
    if (!names || names.length === 0) {
      return { entities: [], relations: [] };
    }
    
    const client = await this.pool.connect();
    try {
      // Build dynamic query for entities with IN clause
      const entityPlaceholders = names.map((_, i) => `$${i + 1}`).join(', ');
      const entitiesQuery = `
        SELECT name, entity_type as "entityType", observations 
        FROM entities
        WHERE name IN (${entityPlaceholders})
        ORDER BY name
      `;
      const entitiesResult = await client.query(entitiesQuery, names);
      
      // Build dynamic query for relationships between specified entities
      const relationPlaceholders1 = names.map((_, i) => `$${i + 1}`).join(', ');
      const relationPlaceholders2 = names.map((_, i) => `$${i + names.length + 1}`).join(', ');
      const relationsQuery = `
        SELECT 
          e1.name as from_name,
          e2.name as to_name,
          r.relation_type as "relationType"
        FROM relationships r
        JOIN entities e1 ON r.source_entity = e1.id
        JOIN entities e2 ON r.target_entity = e2.id
        WHERE e1.name IN (${relationPlaceholders1})
          AND e2.name IN (${relationPlaceholders2})
        ORDER BY e1.name, e2.name
      `;
      // Provide names twice - once for source entities, once for target entities
      const relationsResult = await client.query(relationsQuery, [...names, ...names]);
      
      // Process entities
      const entities: Entity[] = entitiesResult.rows.map(row => ({
        name: row.name,
        entityType: row.entityType || 'CONCEPT',
        observations: Array.isArray(row.observations) ? row.observations : []
      }));
      
      // Process relations
      const relations: Relation[] = relationsResult.rows.map(row => ({
        from: row.from_name,
        to: row.to_name,
        relationType: row.relationType
      }));
      
      return {
        entities,
        relations
      };
      
    } catch (error) {
      this.logger.error('Open nodes failed', error as Error);
      throw new Error(`Open nodes failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  async readGraph(): Promise<KnowledgeGraph> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    try {
      // Get all entities
      const entitiesQuery = `
        SELECT name, entity_type as "entityType", observations 
        FROM entities
        ORDER BY name
      `;
      const entitiesResult = await client.query(entitiesQuery);
      
      // Get all relationships with entity names
      const relationsQuery = `
        SELECT 
          e1.name as from_name,
          e2.name as to_name,
          r.relation_type as "relationType"
        FROM relationships r
        JOIN entities e1 ON r.source_entity = e1.id
        JOIN entities e2 ON r.target_entity = e2.id
        ORDER BY e1.name, e2.name
      `;
      const relationsResult = await client.query(relationsQuery);
      
      // Process entities
      const entities: Entity[] = entitiesResult.rows.map(row => ({
        name: row.name,
        entityType: row.entityType || 'CONCEPT',
        observations: Array.isArray(row.observations) ? row.observations : []
      }));
      
      // Process relations
      const relations: Relation[] = relationsResult.rows.map(row => ({
        from: row.from_name,
        to: row.to_name,
        relationType: row.relationType
      }));
      
      return {
        entities,
        relations
      };
      
    } catch (error) {
      this.logger.error('Read graph failed', error as Error);
      throw new Error(`Read graph failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  async embedAllEntities(): Promise<EmbeddingResult> {
    if (!this.pool) throw new Error('Database not initialized');
    
    // Ensure embedding model is initialized
    if (!this.embeddingModel) {
      this.logger.warn('Embedding model not initialized, attempting to initialize...');
      await this.initializeEmbeddingModel();
    }
    
    const client = await this.pool.connect();
    try {
      // Get all entities that don't have embeddings yet
      const entitiesQuery = `
        SELECT e.id, e.name, e.entity_type, e.observations
        FROM entities e
        LEFT JOIN entity_embeddings ee ON e.id = ee.entity_id
        WHERE ee.entity_id IS NULL
      `;
      
      const entitiesResult = await client.query(entitiesQuery);
      const entities = entitiesResult.rows;
      
      if (entities.length === 0) {
        return {
          totalEntities: 0,
          embeddedEntities: 0
        };
      }
      
      let successful = 0;
      let failed = 0;
      const errors: string[] = [];
      
      // Process entities in batches
      for (const entity of entities) {
        try {
          // Create embedding text from entity name, type, and observations
          const observations = this.parseObservations(entity.observations || '[]');
          const embeddingText = `${entity.name} ${entity.entity_type} ${observations.join(' ')}`;
          
          // Generate embedding
          const embedding = await this.generateEmbedding(embeddingText);
          
          // Convert Float32Array to regular array for PostgreSQL
          const embeddingArray = Array.from(embedding);
          
          // Insert embedding
          const insertQuery = `
            INSERT INTO entity_embeddings (entity_id, embedding, embedding_text)
            VALUES ($1, $2, $3)
            ON CONFLICT (entity_id) DO UPDATE SET
              embedding = EXCLUDED.embedding,
              embedding_text = EXCLUDED.embedding_text,
              updated_at = CURRENT_TIMESTAMP
          `;
          
          await client.query(insertQuery, [
            entity.id,
            JSON.stringify(embeddingArray), // pgvector accepts JSON array format
            embeddingText
          ]);
          
          successful++;
        } catch (error) {
          failed++;
          errors.push(`Entity ${entity.name}: ${(error as Error).message}`);
        }
      }
      
      return {
        totalEntities: entities.length,
        embeddedEntities: successful
      };
      
    } finally {
      client.release();
    }
  }

  async createRelations(relations: Relation[]): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');
    if (relations.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const relation of relations) {
        // Check if both entities exist, create if missing
        const fromExists = await client.query(
          'SELECT 1 FROM entities WHERE name = $1',
          [relation.from]
        );
        if (fromExists.rowCount === 0) {
          await client.query(
            'INSERT INTO entities (id, name, entity_type, observations, metadata) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING',
            [relation.from, relation.from, 'UNKNOWN', [], {}]
          );
        }

        const toExists = await client.query(
          'SELECT 1 FROM entities WHERE name = $1',
          [relation.to]
        );
        if (toExists.rowCount === 0) {
          await client.query(
            'INSERT INTO entities (id, name, entity_type, observations, metadata) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING',
            [relation.to, relation.to, 'UNKNOWN', [], {}]
          );
        }

        // Get entity IDs for foreign key references
        const fromIdResult = await client.query(
          'SELECT id FROM entities WHERE name = $1',
          [relation.from]
        );
        const toIdResult = await client.query(
          'SELECT id FROM entities WHERE name = $1',
          [relation.to]
        );

        if (fromIdResult.rowCount === 0 || toIdResult.rowCount === 0) {
          throw new Error(`Entity not found: ${relation.from} or ${relation.to}`);
        }

        const fromId = fromIdResult.rows[0].id;
        const toId = toIdResult.rows[0].id;

        // Generate unique relationship ID in the same format as existing relationships
        const relationshipId = `rel_${fromId}_${relation.relationType.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${toId}`;
        
        // Insert relationship (ignore duplicates)
        await client.query(
          `INSERT INTO relationships (id, source_entity, target_entity, relation_type) 
           VALUES ($1, $2, $3, $4) 
           ON CONFLICT (id) DO NOTHING`,
          [relationshipId, fromId, toId, relation.relationType]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Failed to create relations: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');
    if (relations.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const relation of relations) {
        // Get entity IDs
        const fromIdResult = await client.query(
          'SELECT id FROM entities WHERE name = $1',
          [relation.from]
        );
        const toIdResult = await client.query(
          'SELECT id FROM entities WHERE name = $1',
          [relation.to]
        );

        if (fromIdResult.rowCount && fromIdResult.rowCount > 0 && toIdResult.rowCount && toIdResult.rowCount > 0) {
          const fromId = fromIdResult.rows[0].id;
          const toId = toIdResult.rows[0].id;
          
          await client.query(
            'DELETE FROM relationships WHERE source_entity = $1 AND target_entity = $2 AND relation_type = $3',
            [fromId, toId, relation.relationType]
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Failed to delete relations: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  async storeDocument(id: string, content: string, metadata?: Record<string, any>): Promise<StoreDocumentResult> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    try {
      this.logger.debug(`Storing document: ${id}`);
      
      // Clean up existing document data (including old chunks and their embeddings)
      await this.cleanupDocument(client, id);
      
      // Store the document
      const insertQuery = `
        INSERT INTO documents (id, content, metadata)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          metadata = EXCLUDED.metadata
      `;
      
      await client.query(insertQuery, [
        id,
        content,
        JSON.stringify(metadata || {})
      ]);
      
      this.logger.debug(`Document stored: ${id}`);
      
      // Automatically chunk and embed the document (matching SQLite behavior)
      let chunksCreated = 0;
      let chunksEmbedded = 0;
      
      try {
        this.logger.debug(`Starting automatic chunking for document: ${id}`);
        const chunkResult = await this.chunkDocument(id);
        chunksCreated = chunkResult.chunks.length;
        this.logger.debug(`Document ${id} chunked: ${chunksCreated} chunks created`);
        
        if (chunksCreated > 0) {
          this.logger.debug(`Starting automatic embedding for document: ${id}`);
          const embedResult = await this.embedChunks(id);
          chunksEmbedded = embedResult.embeddedChunks || 0;
          this.logger.debug(`Document ${id} chunks embedded: ${chunksEmbedded} embeddings created`);
        }
      } catch (error) {
        this.logger.warn(`Error during automatic chunking/embedding for document ${id}:`, error as Error);
        // Document storage was successful, but chunking/embedding failed. Return partial success.
      }
      
      return {
        id,
        stored: true,
        chunksCreated,
        chunksEmbedded
      };
      
    } catch (error) {
      this.logger.error(`Failed to store document: ${id}`, error as Error);
      throw error;
    } finally {
      client.release();
    }
  }

  async chunkDocument(documentId: string, options?: ChunkOptions): Promise<ChunkResult> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    try {
      // Get the document
      const docQuery = 'SELECT content FROM documents WHERE id = $1';
      const docResult = await client.query(docQuery, [documentId]);
      
      if (docResult.rows.length === 0) {
        throw new Error(`Document not found: ${documentId}`);
      }
      
      const content = docResult.rows[0].content;
      const maxTokens = options?.maxTokens || 200;
      const overlap = options?.overlap || 20;
      
      this.logger.debug(`Chunking document: ${documentId} (maxTokens: ${maxTokens}, overlap: ${overlap})`);
      
      // Clean up existing chunks (matching SQLite behavior)
      await this.cleanupDocument(client, documentId);
      
      // Enhanced chunking with position tracking
      const chunks = this.chunkTextWithPositions(content, maxTokens, overlap);
      
      // Store chunks in database
      const createdChunks: string[] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = `${documentId}_chunk_${i}`;
        
        // Insert chunk metadata WITH position information
        const insertMetadataQuery = `
          INSERT INTO chunk_metadata (
            chunk_id, document_id, chunk_index, text, chunk_type, start_pos, end_pos
          )
          VALUES ($1, $2, $3, $4, 'document', $5, $6)
        `;
        
        await client.query(insertMetadataQuery, [
          chunkId,
          documentId,
          i,
          chunk.text,
          chunk.startPos,
          chunk.endPos
        ]);
        
        createdChunks.push(chunkId);
      }
      
      this.logger.debug(`Document chunked: ${documentId} -> ${createdChunks.length} chunks`);
      
      return {
        documentId,
        chunks: createdChunks.map((chunkId, index) => ({
          id: chunkId,
          text: chunks[index].text,
          startPos: chunks[index].startPos,
          endPos: chunks[index].endPos
        }))
      };
      
    } catch (error) {
      this.logger.error(`Failed to chunk document: ${documentId}`, error as Error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  private chunkTextWithPositions(text: string, maxTokens: number, overlap: number): Array<{
    text: string, 
    tokens: number, 
    startPos: number, 
    endPos: number
  }> {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: Array<{text: string, tokens: number, startPos: number, endPos: number}> = [];
    
    let currentChunk = '';
    let currentTokens = 0;
    let currentStartPos = 0;
    let textPosition = 0;
    
    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence);
      
      if (currentTokens + sentenceTokens > maxTokens && currentChunk) {
        // Calculate end position for current chunk
        const chunkEndPos = textPosition;
        
        // Save current chunk with actual positions
        chunks.push({
          text: currentChunk.trim(),
          tokens: currentTokens,
          startPos: currentStartPos,
          endPos: chunkEndPos
        });
        
        // Calculate overlap for next chunk
        const overlapText = this.getLastSentences(currentChunk, overlap);
        const overlapLength = overlapText.length;
        
        // Start new chunk with overlap
        currentStartPos = Math.max(0, chunkEndPos - overlapLength);
        currentChunk = overlapText + (overlapText ? ' ' : '') + sentence;
        currentTokens = this.estimateTokens(currentChunk);
      } else {
        if (!currentChunk) {
          currentStartPos = textPosition;
        }
        currentChunk += (currentChunk ? ' ' : '') + sentence;
        currentTokens += sentenceTokens;
      }
      
      textPosition += sentence.length + 1; // +1 for space between sentences
    }
    
    // Add final chunk
    if (currentChunk.trim()) {
      chunks.push({
        text: currentChunk.trim(),
        tokens: currentTokens,
        startPos: currentStartPos,
        endPos: text.length
      });
    }
    
    return chunks;
  }
  
  private estimateTokens(text: string): number {
    // Simple token estimation (roughly 4 characters per token)
    return Math.ceil(text.length / 4);
  }
  
  private getLastSentences(text: string, maxTokens: number): string {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    let result = '';
    let tokens = 0;
    
    for (let i = sentences.length - 1; i >= 0; i--) {
      const sentenceTokens = this.estimateTokens(sentences[i]);
      if (tokens + sentenceTokens > maxTokens) break;
      
      result = sentences[i] + '. ' + result;
      tokens += sentenceTokens;
    }
    
    return result.trim();
  }

  async embedChunks(documentId: string): Promise<EmbeddingResult> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    try {
      // First check if embedding model is initialized
      if (!this.embeddingModel) {
        this.logger.warn('Embedding model not initialized, attempting to initialize...');
        await this.initializeEmbeddingModel();
      }
      
      // Get all chunks for the document
      const chunksQuery = `
        SELECT cm.id as metadata_id, cm.chunk_id, cm.text
        FROM chunk_metadata cm
        WHERE cm.document_id = $1
      `;
      
      const chunksResult = await client.query(chunksQuery, [documentId]);
      const chunks = chunksResult.rows;
      
      if (chunks.length === 0) {
        return {
          totalChunks: 0,
          embeddedChunks: 0
        };
      }
      
      let successful = 0;
      let failed = 0;
      const errors: string[] = [];
      
      // Process chunks in batches
      for (const chunk of chunks) {
        try {
          // Generate embedding for chunk text
          const embedding = await this.generateEmbedding(chunk.text);
          const embeddingArray = Array.from(embedding);
          
          // Check if chunk embedding already exists
          const existsQuery = `
            SELECT id FROM chunks WHERE chunk_metadata_id = $1
          `;
          const existsResult = await client.query(existsQuery, [chunk.metadata_id]);
          
          if (existsResult.rows.length === 0) {
            // Insert new embedding
            const insertQuery = `
              INSERT INTO chunks (chunk_metadata_id, embedding)
              VALUES ($1, $2)
            `;
            
            await client.query(insertQuery, [
              chunk.metadata_id,
              JSON.stringify(embeddingArray)
            ]);
          } else {
            // Update existing embedding
            const updateQuery = `
              UPDATE chunks 
              SET embedding = $2
              WHERE chunk_metadata_id = $1
            `;
            
            await client.query(updateQuery, [
              chunk.metadata_id,
              JSON.stringify(embeddingArray)
            ]);
          }
          
          successful++;
        } catch (error) {
          failed++;
          errors.push(`Chunk ${chunk.chunk_id}: ${(error as Error).message}`);
          this.logger.error(`Failed to embed chunk ${chunk.chunk_id}`, error as Error);
        }
      }
      
      this.logger.debug(`Embedded chunks for document ${documentId}: ${successful}/${chunks.length}`);
      
      return {
        totalChunks: chunks.length,
        embeddedChunks: successful
      };
      
    } catch (error) {
      this.logger.error(`Failed to embed chunks for document: ${documentId}`, error as Error);
      throw error;
    } finally {
      client.release();
    }
  }

  async extractTerms(documentId: string, options?: ExtractOptions): Promise<TermResult> {
    if (!this.pool) throw new Error('Database not initialized');

    const {
      minLength = 3,
      includeCapitalized = true,
      customPatterns = []
    } = options || {};

    const client = await this.pool.connect();
    try {
      // Get document content
      const documentQuery = `SELECT content FROM documents WHERE id = $1`;
      const documentResult = await client.query(documentQuery, [documentId]);

      if (documentResult.rows.length === 0) {
        throw new Error(`Document with ID ${documentId} not found`);
      }

      const content = documentResult.rows[0].content;
      const extractedTerms = new Set<string>();

      // Extract capitalized words/phrases if enabled
      if (includeCapitalized) {
        const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
        const matches = content.match(capitalizedPattern) || [];
        matches.forEach((match: string) => {
          if (match.length >= minLength) {
            extractedTerms.add(match.trim());
          }
        });
      }

      // Apply custom patterns
      for (const pattern of customPatterns) {
        try {
          const regex = new RegExp(pattern, 'g');
          const matches = content.match(regex) || [];
          matches.forEach((match: string) => {
            if (match.length >= minLength) {
              extractedTerms.add(match.trim());
            }
          });
        } catch (error) {
          this.logger.warn(`Invalid regex pattern: ${pattern}`, error as Error);
        }
      }

      // Convert Set to Array and sort
      const terms = Array.from(extractedTerms).sort();

      this.logger.debug(`Extracted ${terms.length} terms from document: ${documentId}`);

      return {
        documentId,
        terms
      };

    } catch (error) {
      this.logger.error('Failed to extract terms', error as Error);
      throw new Error(`Failed to extract terms: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  async linkEntitiesToDocument(documentId: string, entityNames: string[]): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');
    if (entityNames.length === 0) return;

    return this.executeInTransaction(async (tx) => {
      // 1. Verify document exists
      const documentQuery = `SELECT id FROM documents WHERE id = $1`;
      const documentResult = await tx.execute(documentQuery, [documentId]);

      if (!Array.isArray(documentResult) || documentResult.length === 0) {
        throw new Error(`Document with ID ${documentId} not found`);
      }

      // 2. Get all chunks for the document
      const chunksQuery = `SELECT id FROM chunk_metadata WHERE document_id = $1`;
      const chunksResult = await tx.execute(chunksQuery, [documentId]);

      if (!Array.isArray(chunksResult) || chunksResult.length === 0) {
        this.logger.warn(`No chunks found for document: ${documentId}`);
        return;
      }

      const chunkIds = chunksResult.map((row: any) => row.id);
      let linkedEntities = 0;
      const errors: string[] = [];

      // 3. Process entities in smaller batches to avoid transaction timeout
      const batchSize = 5; // Process 5 entities at a time
      for (let i = 0; i < entityNames.length; i += batchSize) {
        const batch = entityNames.slice(i, i + batchSize);
        
        for (const entityName of batch) {
          try {
            // Get entity ID by name
            const entityQuery = `SELECT id FROM entities WHERE name = $1`;
            const entityResult = await tx.execute(entityQuery, [entityName]);

            let entityId: string;

            if (!Array.isArray(entityResult) || entityResult.length === 0) {
              this.logger.debug(`Entity not found: ${entityName}. Creating it...`);
              
              // Create the entity if it doesn't exist
              entityId = `entity_${entityName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
              
              try {
                await tx.execute(
                  `INSERT INTO entities (id, name, entity_type, observations) 
                   VALUES ($1, $2, 'CONCEPT', $3)
                   ON CONFLICT (name) DO UPDATE SET entity_type = EXCLUDED.entity_type`,
                  [entityId, entityName, JSON.stringify([`Referenced in document ${documentId}`])]
                );
                
                // Get the entity ID after creation
                const createdEntityResult = await tx.execute(entityQuery, [entityName]);
                if (!Array.isArray(createdEntityResult) || createdEntityResult.length === 0) {
                  throw new Error(`Failed to create or find entity: ${entityName}`);
                }
                entityId = createdEntityResult[0].id;
              } catch (createError) {
                this.logger.error(`Failed to create entity ${entityName}:`, createError as Error);
                errors.push(`Failed to create entity ${entityName}: ${(createError as Error).message}`);
                continue;
              }
            } else {
              entityId = entityResult[0].id;
            }

            // 4. Link entity to all document chunks using batch insert
            if (chunkIds.length > 0) {
              try {
                // Use a more efficient batch insert approach
                const values = chunkIds.map(chunkId => `(${chunkId}, '${entityId}')`).join(', ');
                const batchInsertQuery = `
                  INSERT INTO chunk_entities (chunk_metadata_id, entity_id) 
                  VALUES ${values}
                  ON CONFLICT (chunk_metadata_id, entity_id) DO NOTHING
                `;
                
                await tx.execute(batchInsertQuery);
                linkedEntities++;
                this.logger.debug(`Linked entity ${entityName} to ${chunkIds.length} chunks of document ${documentId}`);
              } catch (linkError) {
                // Fallback to individual inserts if batch fails
                this.logger.warn(`Batch insert failed for ${entityName}, trying individual inserts:`, linkError as Error);
                
                let individualSuccess = 0;
                for (const chunkId of chunkIds) {
                  try {
                    await tx.execute(
                      `INSERT INTO chunk_entities (chunk_metadata_id, entity_id) 
                       VALUES ($1, $2) 
                       ON CONFLICT (chunk_metadata_id, entity_id) DO NOTHING`,
                      [chunkId, entityId]
                    );
                    individualSuccess++;
                  } catch (individualError) {
                    this.logger.debug(`Individual insert failed for chunk ${chunkId} and entity ${entityId}:`, individualError as Error);
                  }
                }
                
                if (individualSuccess > 0) {
                  linkedEntities++;
                  this.logger.debug(`Linked entity ${entityName} to ${individualSuccess}/${chunkIds.length} chunks using individual inserts`);
                } else {
                  errors.push(`Failed to link entity ${entityName} to any chunks`);
                }
              }
            }
          } catch (entityError) {
            this.logger.error(`Error processing entity ${entityName}:`, entityError as Error);
            errors.push(`Error processing entity ${entityName}: ${(entityError as Error).message}`);
          }
        }
      }

      this.logger.info(`Successfully linked ${linkedEntities} entities to document ${documentId}${errors.length > 0 ? ` (${errors.length} errors)` : ''}`);
      
      if (errors.length > 0) {
        this.logger.warn('Entity linking errors:', errors);
      }
    });
  }

  async deleteDocuments(documentIds: string | string[]): Promise<DeletionResult> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const idsArray = Array.isArray(documentIds) ? documentIds : [documentIds];
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      let deleted = 0;
      const errors: string[] = [];
      
      for (const docId of idsArray) {
        try {
          // Check if document exists first
          const checkQuery = `SELECT id FROM documents WHERE id = $1`;
          const checkResult = await client.query(checkQuery, [docId]);
          
          if (checkResult.rows.length === 0) {
            errors.push(`Document not found: ${docId}`);
            continue;
          }
          
          // Delete in correct dependency order with proper error handling
          
          // 1. Delete chunk embeddings first (chunks table references chunk_metadata)
          const deleteChunksQuery = `
            DELETE FROM chunks 
            WHERE chunk_metadata_id IN (
              SELECT id FROM chunk_metadata WHERE document_id = $1
            )
          `;
          await client.query(deleteChunksQuery, [docId]);
          
          // 2. Delete chunk entity associations (references chunk_metadata)
          const deleteChunkEntitiesQuery = `
            DELETE FROM chunk_entities 
            WHERE chunk_metadata_id IN (
              SELECT id FROM chunk_metadata WHERE document_id = $1
            )
          `;
          await client.query(deleteChunkEntitiesQuery, [docId]);
          
          // 3. Delete chunk metadata (references documents)
          const deleteChunkMetadataQuery = `DELETE FROM chunk_metadata WHERE document_id = $1`;
          await client.query(deleteChunkMetadataQuery, [docId]);
          
          // 4. Delete the document itself
          const deleteDocumentQuery = `DELETE FROM documents WHERE id = $1`;
          const result = await client.query(deleteDocumentQuery, [docId]);
          
          if (result.rowCount && result.rowCount > 0) {
            deleted++;
            this.logger.debug(`Successfully deleted document: ${docId}`);
          } else {
            errors.push(`Document deletion failed: ${docId}`);
          }
          
        } catch (error) {
          this.logger.error(`Failed to delete document ${docId}`, error as Error);
          errors.push(`Failed to delete ${docId}: ${(error as Error).message}`);
        }
      }
      
      await client.query('COMMIT');
      
            // Return accurate result based on actual deletions
      const result = {
        deleted,
        failed: errors.length,
        errors
      };
      
      this.logger.info(`Document deletion completed: ${deleted} deleted, ${errors.length} failed`);
      
      // Don't throw error if some succeeded - return the result instead
      return result;
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to delete documents', error as Error);
      throw error;
    } finally {
      client.release();
    }
  }

  async listDocuments(includeMetadata?: boolean): Promise<DocumentInfo[]> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    
    try {
      let query: string;
      if (includeMetadata === false) {
        query = 'SELECT id, created_at FROM documents ORDER BY created_at DESC';
      } else {
        query = 'SELECT id, metadata, created_at FROM documents ORDER BY created_at DESC';
      }
      
      const result = await client.query(query);
      
      return result.rows.map(row => ({
        id: row.id,
        metadata: includeMetadata !== false ? this.parseObservations(row.metadata) : undefined,
        created_at: row.created_at
      }));
      
    } catch (error) {
      this.logger.error('Failed to list documents', error as Error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getDocumentContent(documentId: string): Promise<string> {
    this.logger.debug(`Getting document content: ${documentId}`);
    
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT content FROM documents WHERE id = $1', [documentId]);
      
      if (result.rows.length === 0) {
        throw new Error(`Document not found: ${documentId}`);
      }
      
      const content = result.rows[0].content;
      this.logger.debug(`Retrieved document content: ${documentId} (${content.length} chars)`);
      return content;
    } catch (error) {
      this.logger.error(`Failed to get document content: ${documentId}`, error as Error);
      throw error;
    } finally {
      client.release();
    }
  }

  async hybridSearch(query: string, options?: SearchOptions): Promise<EnhancedSearchResult[]> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const limit = options?.limit || 5;
    const useGraph = options?.useGraph !== false; // Default to true
    
    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);
      
      // Convert Float32Array to array for PostgreSQL
      const embeddingArray = Array.from(queryEmbedding);
      
      const client = await this.pool.connect();
      try {
        // Perform vector search across chunks
        // FIXED: Return chunk_id (string) consistently
        const vectorSearchQuery = `
          SELECT 
            m.chunk_id,
            m.chunk_type,
            m.document_id,
            m.entity_id,
            m.relationship_id,
            m.chunk_index,
            m.text,
            m.start_pos,
            m.end_pos,
            m.metadata as chunk_metadata,
            (c.embedding <=> $1::vector) as distance,
            COALESCE(d.metadata, '{}') as doc_metadata,
            COALESCE(d.id, 'unknown') as document_title
          FROM chunks c
          JOIN chunk_metadata m ON c.chunk_metadata_id = m.id
          LEFT JOIN documents d ON m.document_id = d.id
          ORDER BY c.embedding <=> $1::vector
          LIMIT $2
        `;
        
        const vectorResults = await client.query(vectorSearchQuery, [JSON.stringify(embeddingArray), limit * 2]);
        
        // Process results and generate enhanced search results
        const enhancedResults: EnhancedSearchResult[] = [];
        const processedChunks = new Set<string>();
        
        for (const row of vectorResults.rows) {
          if (processedChunks.has(row.chunk_id)) continue;
          processedChunks.add(row.chunk_id);
          
          // Calculate relevance score (convert distance to similarity)
          const vectorSimilarity = Math.max(0, 1 - row.distance);
          let graphBoost = 0;
          
          // Apply graph boost if enabled
          if (useGraph && row.entity_id) {
            // Find connected entities for graph boost
            const graphQuery = `
              SELECT COUNT(DISTINCT e2.name) as connection_count
              FROM entities e1
              JOIN relationships r ON (r.source_entity = e1.id OR r.target_entity = e1.id)
              JOIN entities e2 ON (e2.id = r.source_entity OR e2.id = r.target_entity)
              WHERE e1.id = $1 AND e2.id != $1
            `;
            const graphResult = await client.query(graphQuery, [row.entity_id]);
            const connectionCount = graphResult.rows[0]?.connection_count || 0;
            graphBoost = Math.min(0.3, connectionCount * 0.05); // Max 30% boost
          }
          
          const relevanceScore = vectorSimilarity + graphBoost;
          
          // Generate content summary and key highlight
          const text = row.text || '';
          const words = text.split(' ');
          const keyHighlight = words.slice(0, Math.min(20, words.length)).join(' ');
          const contentSummary = words.slice(0, Math.min(50, words.length)).join(' ');
          
          // Get associated entities
          // FIXED: Use chunk_metadata.id for entity associations
          const entitiesQuery = `
            SELECT e.name 
            FROM chunk_entities ce
            JOIN entities e ON e.id = ce.entity_id
            JOIN chunk_metadata m ON ce.chunk_metadata_id = m.id
            WHERE m.chunk_id = $1
          `;
          const entitiesResult = await client.query(entitiesQuery, [row.chunk_id]);
          const entities = entitiesResult.rows.map(e => e.name);
          
          enhancedResults.push({
            relevance_score: relevanceScore,
            key_highlight: keyHighlight,
            content_summary: contentSummary,
            chunk_id: row.chunk_id,
            document_title: row.document_title,
            entities: entities,
            vector_similarity: vectorSimilarity,
            graph_boost: graphBoost,
            full_context_available: true,
            chunk_type: row.chunk_type || 'document',
            source_id: row.document_id || row.entity_id || row.relationship_id || 'unknown'
          });
        }
        
        // Sort by relevance score and return top results
        return enhancedResults
          .sort((a, b) => b.relevance_score - a.relevance_score)
          .slice(0, limit);
        
      } finally {
        client.release();
      }
    } catch (error) {
      this.logger.error('Hybrid search failed', error as Error);
      throw new Error(`Hybrid search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getDetailedContext(chunkId: string, includeSurrounding: boolean = true): Promise<DetailedContext> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    try {
      // Get main chunk details
      // FIXED: Use chunk_id (string) instead of id (numeric)
      // The search returns chunk_metadata.chunk_id, not chunk_metadata.id
      const mainChunkQuery = `
        SELECT 
          m.chunk_id,
          m.id as metadata_id,
          m.document_id,
          m.chunk_index,
          m.text,
          m.metadata,
          d.content as doc_content,
          d.metadata as doc_metadata,
          COALESCE(d.id, 'unknown') as document_title
        FROM chunk_metadata m
        LEFT JOIN documents d ON m.document_id = d.id
        WHERE m.chunk_id = $1
      `;
      
      const mainResult = await client.query(mainChunkQuery, [chunkId]);
      
      if (mainResult.rows.length === 0) {
        throw new Error(`Chunk with ID ${chunkId} not found`);
      }
      
      const mainChunk = mainResult.rows[0];
      
      // Get associated entities
      // FIXED: Use metadata_id (numeric) for entity associations
      const entitiesQuery = `
        SELECT e.name 
        FROM chunk_entities ce
        JOIN entities e ON e.id = ce.entity_id
        WHERE ce.chunk_metadata_id = $1
      `;
      const entitiesResult = await client.query(entitiesQuery, [mainChunk.metadata_id]);
      const entities = entitiesResult.rows.map(e => e.name);
      
      // Get surrounding chunks if requested
      let surroundingChunks: Array<{ chunk_id: string; text: string; position: 'before' | 'after' }> = [];
      
      if (includeSurrounding && mainChunk.document_id && mainChunk.chunk_index !== null) {
        const surroundingQuery = `
          SELECT 
            chunk_id,
            text,
            chunk_index,
            CASE 
              WHEN chunk_index < $2 THEN 'before'
              WHEN chunk_index > $2 THEN 'after'
            END as position
          FROM chunk_metadata
          WHERE document_id = $1 
            AND chunk_index IN ($2 - 1, $2 + 1)
            AND chunk_id != $3
          ORDER BY chunk_index
        `;
        
        const surroundingResult = await client.query(surroundingQuery, [
          mainChunk.document_id,
          mainChunk.chunk_index,
          chunkId
        ]);
        
        surroundingChunks = surroundingResult.rows.map(row => ({
          chunk_id: row.chunk_id,
          text: row.text || '',
          position: row.position as 'before' | 'after'
        }));
      }
      
      return {
        chunk_id: mainChunk.chunk_id,
        document_id: mainChunk.document_id,
        full_text: mainChunk.text || '',
        document_title: mainChunk.document_title,
        entities: entities,
        surrounding_chunks: surroundingChunks,
        metadata: {
          chunk_index: mainChunk.chunk_index,
          chunk_metadata: mainChunk.metadata || {},
          doc_metadata: mainChunk.doc_metadata || {}
        }
      };
      
    } catch (error) {
      this.logger.error('Get detailed context failed', error as Error);
      throw new Error(`Get detailed context failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  async getKnowledgeGraphStats(): Promise<KnowledgeGraphStats> {
    if (!this.pool) throw new Error('Database not initialized');
    
    const client = await this.pool.connect();
    try {
      // Get entity counts by type
      const entityStatsQuery = `
        SELECT entity_type, COUNT(*) as count
        FROM entities
        GROUP BY entity_type
      `;
      const entityResult = await client.query(entityStatsQuery);
      
      // Get relationship counts by type (if table exists)
      let relationResult = { rows: [] };
      try {
        const relationStatsQuery = `
          SELECT relation_type, COUNT(*) as count
          FROM relationships
          GROUP BY relation_type
        `;
        relationResult = await client.query(relationStatsQuery);
      } catch (error) {
        // Relationships table might not exist yet
      }
      
      // Get document and chunk counts (if tables exist)
      let docCount = 0;
      let chunkCount = 0;
      try {
        const docResult = await client.query('SELECT COUNT(*) as count FROM documents');
        docCount = parseInt(docResult.rows[0].count);
      } catch (error) {
        // Documents table might not exist yet
      }
      
      // Count chunks with multiple fallback strategies
      try {
        // Try chunk_metadata table first
        const chunkResult = await client.query('SELECT COUNT(*) as count FROM chunk_metadata');
        chunkCount = parseInt(chunkResult.rows[0].count);
      } catch (error) {
        // Try chunks table as fallback
        try {
          const chunkResult = await client.query('SELECT COUNT(*) as count FROM chunks');
          chunkCount = parseInt(chunkResult.rows[0].count);
        } catch (altError) {
          // Chunks tables might not exist yet
          this.logger.debug('Could not count chunks - tables may not exist yet');
        }
      }
      
      // Build stats object
      const entityStats: Record<string, number> = {};
      let totalEntities = 0;
      for (const row of entityResult.rows) {
        entityStats[row.entity_type] = parseInt(row.count);
        totalEntities += parseInt(row.count);
      }
      
      const relationStats: Record<string, number> = {};
      let totalRelations = 0;
      for (const row of relationResult.rows) {
        const relationRow = row as any; // Type assertion for MVP
        relationStats[relationRow.relation_type] = parseInt(relationRow.count);
        totalRelations += parseInt(relationRow.count);
      }
      
      return {
        entities: {
          total: totalEntities,
          byType: entityStats
        },
        relationships: {
          total: totalRelations,
          byType: relationStats
        },
        documents: {
          total: docCount
        },
        chunks: {
          total: chunkCount,
          embedded: await this.countEmbeddedChunks(client)
        }
      };
    } finally {
      client.release();
    }
  }

  private async countEmbeddedChunks(client: any): Promise<number> {
    // The correct approach based on the schema:
    // - chunk_metadata table has the chunk info
    // - chunks table has the embeddings
    // - They're linked by chunks.chunk_metadata_id = chunk_metadata.id
    
    const strategies = [
      // Strategy 1: Count chunks that have embeddings (CORRECT for current schema)
      `SELECT COUNT(*) as count 
       FROM chunk_metadata cm
       INNER JOIN chunks c ON cm.id = c.chunk_metadata_id
       WHERE c.embedding IS NOT NULL`,
      
      // Strategy 2: Direct count from chunks table
      `SELECT COUNT(*) as count 
       FROM chunks 
       WHERE embedding IS NOT NULL`,
       
      // Strategy 3: Alternative join approach
      `SELECT COUNT(DISTINCT cm.id) as count
       FROM chunk_metadata cm
       WHERE EXISTS (
         SELECT 1 FROM chunks c 
         WHERE c.chunk_metadata_id = cm.id 
         AND c.embedding IS NOT NULL
       )`
    ];
    
    for (const query of strategies) {
      try {
        const result = await client.query(query);
        const count = parseInt(result.rows[0].count);
        if (!isNaN(count)) {
          this.logger.debug(`Embedded chunks count: ${count} (using strategy)`);
          return count;
        }
      } catch (error) {
        this.logger.debug(`Strategy failed: ${(error as Error).message}`);
        continue;
      }
    }
    
    this.logger.debug('No embedded chunks counting strategy worked');
    return 0;
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    // Update connection pool metrics
    if (this.connectionManager) {
      const poolStats = this.connectionManager.getStats();
      this.performanceMetrics.connectionPool = {
        active: poolStats.totalCount - poolStats.idleCount,
        idle: poolStats.idleCount,
        waiting: poolStats.waitingCount,
        total: poolStats.totalCount
      };
    }

    return this.performanceMetrics;
  }

  async reEmbedEverything(): Promise<ReEmbedResult> {
    if (!this.pool) throw new Error('Database not initialized');
    
    this.logger.info('Starting full re-embedding process...');

    let totalEntitiesReEmbedded = 0;
    let totalDocumentsProcessed = 0;
    let totalDocumentChunksReEmbedded = 0;
    let totalKnowledgeGraphChunksReEmbedded = 0;

    try {
      // 1. Re-embed all entities
      this.logger.info('Re-embedding all entities...');
      const entityEmbeddingResult = await this.embedAllEntities();
      totalEntitiesReEmbedded = entityEmbeddingResult.embeddedEntities || 0;
      this.logger.info(`Entities re-embedded: ${totalEntitiesReEmbedded}/${entityEmbeddingResult.totalEntities || 0}`);

      // 2. Re-embed all document chunks
      this.logger.info('Re-embedding all document chunks...');
      const documentsResult = await this.listDocuments(false);
      const documentIds = documentsResult.map(doc => doc.id);
      
      for (const docId of documentIds) {
        try {
          this.logger.debug(`Processing document: ${docId}`);
          const chunkEmbedResult = await this.embedChunks(docId);
          totalDocumentChunksReEmbedded += chunkEmbedResult.embeddedChunks || 0;
          totalDocumentsProcessed++;
        } catch (error) {
          this.logger.error(`Error re-embedding document ${docId}`, error as Error);
        }
      }
      this.logger.info(`Document chunks re-embedded: ${totalDocumentChunksReEmbedded} chunks across ${totalDocumentsProcessed} documents`);

      // 3. Re-embed knowledge graph chunks (if implemented)
      if (this.generateKnowledgeGraphChunks && this.embedKnowledgeGraphChunks) {
        this.logger.info('Generating and re-embedding knowledge graph chunks...');
        await this.generateKnowledgeGraphChunks();
        const kgChunkEmbedResult = await this.embedKnowledgeGraphChunks();
        totalKnowledgeGraphChunksReEmbedded = kgChunkEmbedResult.embeddedChunks || 0;
        this.logger.info(`Knowledge graph chunks re-embedded: ${totalKnowledgeGraphChunksReEmbedded}`);
      } else {
        this.logger.info('Knowledge graph chunk operations not implemented - skipping');
      }

      this.logger.info('Full re-embedding process completed');
      return {
        totalEntitiesReEmbedded,
        totalDocumentsProcessed,
        totalDocumentChunksReEmbedded,
        totalKnowledgeGraphChunksReEmbedded,
      };

    } catch (error) {
      this.logger.error('Failed to complete re-embedding process', error as Error);
      throw error;
    }
  }

  async generateKnowledgeGraphChunks(): Promise<KnowledgeGraphChunkResult> {
    if (!this.pool) throw new Error('Database not initialized');
    
    this.logger.info('Generating knowledge graph chunks...');
    
    const client = await this.pool.connect();
    try {
      // Clean up existing knowledge graph chunks
      await this.cleanupKnowledgeGraphChunks(client);
      
      let entityChunks = 0;
      let relationshipChunks = 0;
      
      // Generate entity chunks
      const entitiesQuery = `
        SELECT id, name, entity_type, observations 
        FROM entities
      `;
      const entitiesResult = await client.query(entitiesQuery);
      
      for (const entity of entitiesResult.rows) {
        const observations = Array.isArray(entity.observations) ? entity.observations : 
                           (typeof entity.observations === 'string' ? JSON.parse(entity.observations) : []);
        const chunkText = this.generateEntityChunkText(entity.name, entity.entity_type, observations);
        const chunkId = `kg_entity_${entity.id}`;
        
        // Store chunk metadata
        await client.query(`
          INSERT INTO chunk_metadata (
            chunk_id, chunk_type, entity_id, chunk_index, text, start_pos, end_pos, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          chunkId, 
          'entity', 
          entity.id, 
          0, 
          chunkText, 
          0, 
          chunkText.length, 
          JSON.stringify({
            entity_name: entity.name,
            entity_type: entity.entity_type
          })
        ]);
        
        entityChunks++;
      }
      
      // Generate relationship chunks
      const relationshipsQuery = `
        SELECT 
          r.id,
          r.relation_type,
          e1.name as source_name,
          e2.name as target_name,
          r.confidence
        FROM relationships r
        JOIN entities e1 ON r.source_entity = e1.id
        JOIN entities e2 ON r.target_entity = e2.id
      `;
      const relationshipsResult = await client.query(relationshipsQuery);
      
      for (const rel of relationshipsResult.rows) {
        const chunkText = this.generateRelationshipChunkText(rel.source_name, rel.target_name, rel.relation_type);
        const chunkId = `kg_relationship_${rel.id}`;
        
        // Store chunk metadata
        await client.query(`
          INSERT INTO chunk_metadata (
            chunk_id, chunk_type, relationship_id, chunk_index, text, start_pos, end_pos, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          chunkId, 
          'relationship', 
          rel.id, 
          0, 
          chunkText, 
          0, 
          chunkText.length, 
          JSON.stringify({
            source_entity: rel.source_name,
            target_entity: rel.target_name,
            relation_type: rel.relation_type,
            confidence: rel.confidence
          })
        ]);
        
        relationshipChunks++;
      }
      
      this.logger.info(`Knowledge graph chunks generated: ${entityChunks} entities, ${relationshipChunks} relationships`);
      
      return { entityChunks, relationshipChunks };
      
    } catch (error) {
      this.logger.error('Failed to generate knowledge graph chunks', error as Error);
      throw error;
    } finally {
      client.release();
    }
  }

  async embedKnowledgeGraphChunks(): Promise<EmbeddingResult> {
    if (!this.pool) throw new Error('Database not initialized');
    
    if (!this.embeddingModel) {
      this.logger.warn('Embedding model not initialized. Skipping KG chunk embedding.');
      return { embeddedChunks: 0 };
    }

    this.logger.info('Embedding knowledge graph chunks...');
    
    const client = await this.pool.connect();
    try {
      // Get all knowledge graph chunks
      const chunksQuery = `
        SELECT cm.id as metadata_id, cm.chunk_id, cm.text
        FROM chunk_metadata cm
        WHERE cm.chunk_type IN ('entity', 'relationship')
      `;
      
      const chunksResult = await client.query(chunksQuery);
      const chunks = chunksResult.rows;
      
      if (chunks.length === 0) {
        return { embeddedChunks: 0 };
      }
      
      let successful = 0;
      
      // Process chunks
      for (const chunk of chunks) {
        try {
          // Generate embedding for chunk text
          const embedding = await this.generateEmbedding(chunk.text);
          const embeddingArray = Array.from(embedding);
          
          // Check if chunk embedding already exists
          const existsQuery = `
            SELECT id FROM chunks WHERE chunk_metadata_id = $1
          `;
          const existsResult = await client.query(existsQuery, [chunk.metadata_id]);
          
          if (existsResult.rows.length === 0) {
            // Insert new embedding
            await client.query(`
              INSERT INTO chunks (chunk_metadata_id, embedding)
              VALUES ($1, $2)
            `, [chunk.metadata_id, JSON.stringify(embeddingArray)]);
          } else {
            // Update existing embedding
            await client.query(`
              UPDATE chunks 
              SET embedding = $2
              WHERE chunk_metadata_id = $1
            `, [chunk.metadata_id, JSON.stringify(embeddingArray)]);
          }
          
          successful++;
        } catch (error) {
          this.logger.error(`Failed to embed KG chunk ${chunk.chunk_id}`, error as Error);
        }
      }
      
      this.logger.info(`Embedded knowledge graph chunks: ${successful}/${chunks.length}`);
      
      return { embeddedChunks: successful };
      
    } catch (error) {
      this.logger.error('Failed to embed knowledge graph chunks', error as Error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async cleanupKnowledgeGraphChunks(client: any): Promise<void> {
    try {
      // Delete existing knowledge graph chunk embeddings first
      await client.query(`
        DELETE FROM chunks 
        WHERE chunk_metadata_id IN (
          SELECT id FROM chunk_metadata 
          WHERE chunk_type IN ('entity', 'relationship')
        )
      `);
      
      // Delete existing knowledge graph chunk metadata
      await client.query(`
        DELETE FROM chunk_metadata 
        WHERE chunk_type IN ('entity', 'relationship')
      `);
      
      this.logger.debug('Cleaned up existing knowledge graph chunks');
    } catch (error) {
      this.logger.error('Failed to cleanup knowledge graph chunks', error as Error);
      throw error;
    }
  }

  private generateEntityChunkText(name: string, entityType: string, observations: string[]): string {
    const obsText = observations.length > 0 ? observations.join('. ') : 'No observations recorded.';
    return `Entity: ${name} (Type: ${entityType})\nObservations: ${obsText}`;
  }

  private generateRelationshipChunkText(source: string, target: string, relationType: string): string {
    return `Relationship: ${source} --[${relationType}]--> ${target}`;
  }

  private async cleanupDocument(client: any, documentId: string): Promise<void> {
    try {
      this.logger.debug(`Cleaning up document: ${documentId}`);
      
      // Delete existing chunk embeddings first (to maintain referential integrity)
      await client.query(`
        DELETE FROM chunks 
        WHERE chunk_metadata_id IN (
          SELECT id FROM chunk_metadata 
          WHERE document_id = $1
        )
      `, [documentId]);
      
      // Delete existing chunk metadata
      await client.query(`
        DELETE FROM chunk_metadata 
        WHERE document_id = $1
      `, [documentId]);
      
      this.logger.debug(`Cleaned up existing chunks for document: ${documentId}`);
    } catch (error) {
      this.logger.error(`Failed to cleanup document: ${documentId}`, error as Error);
      throw error;
    }
  }
}
