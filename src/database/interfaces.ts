/**
 * Database Abstraction Layer - Interface Definitions
 * 
 * This file contains all TypeScript interfaces and types for the Database Abstraction Layer.
 * These interfaces ensure type safety and consistency across all database adapters.
 */

// ============================================================================
// Core Database Interfaces
// ============================================================================

/**
 * Main database adapter interface that all database implementations must follow
 */
export interface DatabaseAdapter {
  // Connection Management
  initialize(config: DatabaseConfig): Promise<void>;
  close(): Promise<void>;
  isConnected(): boolean;
  getHealth(): Promise<DatabaseHealth>;

  // Transaction Management
  beginTransaction(): Promise<Transaction>;
  executeInTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;

  // Schema Management
  runMigrations(migrations: Migration[]): Promise<MigrationResult>;
  getCurrentVersion(): Promise<number>;
  rollbackMigration(targetVersion: number): Promise<RollbackResult>;

  // Entity Operations
  createEntities(entities: Entity[]): Promise<Entity[]>;
  deleteEntities(entityNames: string[]): Promise<void>;
  addObservations(observations: ObservationAddition[]): Promise<void>;
  deleteObservations(deletions: ObservationDeletion[]): Promise<void>;
  searchNodes(query: string, limit?: number): Promise<KnowledgeGraph>;
  openNodes(names: string[]): Promise<KnowledgeGraph>;
  readGraph(): Promise<KnowledgeGraph>;
  embedAllEntities(): Promise<EmbeddingResult>;

  // Relationship Operations
  createRelations(relations: Relation[]): Promise<void>;
  deleteRelations(relations: Relation[]): Promise<void>;

  // Document Operations
  storeDocument(id: string, content: string, metadata?: Record<string, any>): Promise<StoreDocumentResult>;
  chunkDocument(documentId: string, options?: ChunkOptions): Promise<ChunkResult>;
  embedChunks(documentId: string): Promise<EmbeddingResult>;
  extractTerms(documentId: string, options?: ExtractOptions): Promise<TermResult>;
  linkEntitiesToDocument(documentId: string, entityNames: string[]): Promise<void>;
  deleteDocuments(documentIds: string | string[]): Promise<DeletionResult>;
  listDocuments(includeMetadata?: boolean): Promise<DocumentInfo[]>;
  getDocumentContent(documentId: string): Promise<string>;

  // Search Operations
  hybridSearch(query: string, options?: SearchOptions): Promise<EnhancedSearchResult[]>;
  getDetailedContext(chunkId: string, includeSurrounding?: boolean): Promise<DetailedContext>;

  // Statistics and Monitoring
  getKnowledgeGraphStats(): Promise<KnowledgeGraphStats>;
  getPerformanceMetrics(): Promise<PerformanceMetrics>;

  // Re-embedding Operations
  reEmbedEverything?(): Promise<ReEmbedResult>;
  generateKnowledgeGraphChunks?(): Promise<KnowledgeGraphChunkResult>;
  embedKnowledgeGraphChunks?(): Promise<EmbeddingResult>;
}

/**
 * Transaction interface for database operations
 */
export interface Transaction {
  // Basic Operations
  execute<T = any>(sql: string, params?: any[]): Promise<T>;
  prepare<T = any>(sql: string): PreparedStatement<T>;
  
  // Transaction Control
  commit(): Promise<void>;
  rollback(): Promise<void>;
  savepoint(name: string): Promise<void>;
  rollbackToSavepoint(name: string): Promise<void>;
  releaseSavepoint(name: string): Promise<void>;
  
  // State
  isActive(): boolean;
  getId(): string;
}

/**
 * Prepared statement interface
 */
export interface PreparedStatement<T = any> {
  run(...params: any[]): Promise<RunResult>;
  get(...params: any[]): Promise<T | undefined>;
  all(...params: any[]): Promise<T[]>;
  finalize(): Promise<void>;
}

// ============================================================================
// Configuration Interfaces
// ============================================================================

/**
 * Database configuration interface
 */
export interface DatabaseConfig {
  type: 'sqlite' | 'postgresql';
  
  // SQLite Configuration
  sqlite?: {
    filePath: string;
    enableWAL?: boolean;
    pragmas?: Record<string, string | number>;
  };
  
  // PostgreSQL Configuration
  postgresql?: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: boolean | object;
    pool?: {
      min: number;
      max: number;
      idleTimeoutMillis: number;
      connectionTimeoutMillis: number;
    };
  };
  
  // Common Configuration
  vectorDimensions: number;
  enableLogging?: boolean;
  queryTimeout?: number;
}

/**
 * Database health status
 */
export interface DatabaseHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  connections: {
    active: number;
    idle: number;
    total: number;
  };
  lastCheck: Date;
  errors: string[];
}

// ============================================================================
// Entity and Knowledge Graph Interfaces
// ============================================================================

/**
 * Entity interface
 */
export interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

/**
 * Relation interface
 */
export interface Relation {
  from: string;
  to: string;
  relationType: string;
}

/**
 * Knowledge graph interface
 */
export interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

/**
 * Entity search result
 */
export interface EntitySearchResult {
  entity: Entity;
  similarity: number;
  relationships: Relation[];
}

/**
 * Observation addition interface
 */
export interface ObservationAddition {
  entityName: string;
  contents: string[];
}

/**
 * Observation deletion interface
 */
export interface ObservationDeletion {
  entityName: string;
  observations: string[];
}

// ============================================================================
// Document and RAG Interfaces
// ============================================================================

/**
 * Document interface
 */
export interface Document {
  id: string;
  content: string;
  metadata: Record<string, any>;
  created_at: string;
}

/**
 * Document info interface (for listing)
 */
export interface DocumentInfo {
  id: string;
  metadata?: Record<string, any>;
  created_at: string;
}

/**
 * Chunk interface
 */
export interface Chunk {
  id: string;
  document_id: string;
  chunk_index: number;
  text: string;
  start_pos: number;
  end_pos: number;
  embedding?: Float32Array;
}

/**
 * Chunk options for document chunking
 */
export interface ChunkOptions {
  maxTokens?: number;
  overlap?: number;
}

/**
 * Chunk result interface
 */
export interface ChunkResult {
  documentId: string;
  chunks: Array<{
    id: string;
    text: string;
    startPos: number;
    endPos: number;
  }>;
}

/**
 * Extract options for term extraction
 */
export interface ExtractOptions {
  minLength?: number;
  includeCapitalized?: boolean;
  customPatterns?: string[];
}

/**
 * Term extraction result
 */
export interface TermResult {
  documentId: string;
  terms: string[];
}

/**
 * Store document result interface
 */
export interface StoreDocumentResult {
  id: string;
  stored: boolean;
  chunksCreated?: number;
  chunksEmbedded?: number;
}

// ============================================================================
// Search Interfaces
// ============================================================================

/**
 * Search options
 */
export interface SearchOptions {
  limit?: number;
  useGraph?: boolean;
}

/**
 * Enhanced search result
 */
export interface EnhancedSearchResult {
  relevance_score: number;
  key_highlight: string;
  content_summary: string;
  chunk_id: string;
  document_title: string;
  entities: string[];
  vector_similarity: number;
  graph_boost?: number;
  full_context_available: boolean;
  chunk_type: 'document' | 'entity' | 'relationship';
  source_id?: string;
}

/**
 * Detailed context interface
 */
export interface DetailedContext {
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

// ============================================================================
// Migration Interfaces
// ============================================================================

/**
 * Migration interface
 */
export interface Migration {
  version: number;
  description: string;
  up: (adapter: DatabaseAdapter) => Promise<void>;
  down?: (adapter: DatabaseAdapter) => Promise<void>;
}

/**
 * Migration result
 */
export interface MigrationResult {
  applied: number;
  currentVersion: number;
  appliedMigrations: Array<{
    version: number;
    description: string;
  }>;
}

/**
 * Rollback result
 */
export interface RollbackResult {
  rolledBack: number;
  currentVersion: number;
  rolledBackMigrations: Array<{
    version: number;
    description: string;
  }>;
}

// ============================================================================
// Performance and Statistics Interfaces
// ============================================================================

/**
 * Embedding result
 */
export interface EmbeddingResult {
  totalEntities?: number;
  embeddedEntities?: number;
  totalChunks?: number;
  embeddedChunks?: number;
}

/**
 * Deletion result
 */
export interface DeletionResult {
  deleted: number;
  failed: number;
  errors: string[];
}

/**
 * Knowledge graph statistics
 */
export interface KnowledgeGraphStats {
  entities: {
    total: number;
    byType: Record<string, number>;
  };
  relationships: {
    total: number;
    byType: Record<string, number>;
  };
  documents: {
    total: number;
  };
  chunks: {
    total: number;
    embedded: number;
  };
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  queryLatency: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  connectionPool?: {
    active: number;
    idle: number;
    waiting: number;
    total: number;
  };
  vectorSearch: {
    avgLatency: number;
    totalQueries: number;
  };
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
}

/**
 * Pool statistics
 */
export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

/**
 * Re-embedding result interface
 */
export interface ReEmbedResult {
  totalEntitiesReEmbedded: number;
  totalDocumentsProcessed: number;
  totalDocumentChunksReEmbedded: number;
  totalKnowledgeGraphChunksReEmbedded: number;
}

/**
 * Knowledge graph chunk generation result
 */
export interface KnowledgeGraphChunkResult {
  entityChunks: number;
  relationshipChunks: number;
}

/**
 * Run result interface
 */
export interface RunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

// ============================================================================
// Error Interfaces
// ============================================================================

/**
 * Database error interface
 */
export interface DatabaseErrorInfo {
  code: string;
  message: string;
  sql?: string;
  params?: any[];
  originalError?: Error;
}

// ============================================================================
// Logger Interface
// ============================================================================

/**
 * Database logger interface
 */
export interface DatabaseLogger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, error?: Error, meta?: any): void;
}

// ============================================================================
// Type Guards and Utilities
// ============================================================================

/**
 * Type guard for SQLite configuration
 */
export function isSQLiteConfig(config: DatabaseConfig): config is DatabaseConfig & { sqlite: NonNullable<DatabaseConfig['sqlite']> } {
  return config.type === 'sqlite' && config.sqlite !== undefined;
}

/**
 * Type guard for PostgreSQL configuration
 */
export function isPostgreSQLConfig(config: DatabaseConfig): config is DatabaseConfig & { postgresql: NonNullable<DatabaseConfig['postgresql']> } {
  return config.type === 'postgresql' && config.postgresql !== undefined;
}

/**
 * Default SQLite configuration
 */
export const DEFAULT_SQLITE_CONFIG: Omit<DatabaseConfig, 'sqlite'> & { sqlite: Omit<NonNullable<DatabaseConfig['sqlite']>, 'filePath'> } = {
  type: 'sqlite',
  vectorDimensions: 384,
  enableLogging: false,
  queryTimeout: 30000,
  sqlite: {
    enableWAL: true,
    pragmas: {
      'cache_size': -64000,
      'temp_store': 'memory',
      'synchronous': 'normal',
      'mmap_size': 268435456
    }
  }
};

/**
 * Default PostgreSQL configuration
 */
export const DEFAULT_POSTGRESQL_CONFIG: Omit<DatabaseConfig, 'postgresql'> & { postgresql: Omit<NonNullable<DatabaseConfig['postgresql']>, 'host' | 'port' | 'database' | 'username' | 'password'> } = {
  type: 'postgresql',
  vectorDimensions: 384,
  enableLogging: false,
  queryTimeout: 30000,
  postgresql: {
    pool: {
      min: 2,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    }
  }
};
