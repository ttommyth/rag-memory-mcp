/**
 * Database Abstraction Layer - Main Export
 * 
 * This file exports all components of the Database Abstraction Layer,
 * providing a unified interface for database operations across different backends.
 */

// Core Interfaces
export * from './interfaces.js';

// Database Adapters
export { SQLiteAdapter } from './sqlite-adapter.js';
export { PostgreSQLAdapter } from './postgresql-adapter.js';

// Factory and Management
export { DatabaseFactory, createDatabaseAdapter, createDatabaseAdapterFromEnv } from './database-factory.js';
export { ConfigManager } from './config-manager.js';

// Configuration Management
export { EnvironmentManager, type Environment } from './environment-manager.js';
export { ConfigurationFactory, type ConfigurationSource, type ConfigurationResult } from './configuration-factory.js';

// Utilities
export { DatabaseLogger } from './logger.js';
export { ConnectionPoolManager } from './connection-pool-manager.js';

// Migration System
export { MultiDbMigrationManager } from './multi-db-migration-manager.js';

// Re-export commonly used types for convenience
export type {
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
  ReEmbedResult,
  KnowledgeGraphChunkResult,
  StoreDocumentResult,
  DatabaseLogger as DatabaseLoggerInterface
} from './interfaces.js';

// Database manager functions removed - not available in this version

// Version information
export const VERSION = '1.0.0';
export const SUPPORTED_DATABASES = ['sqlite', 'postgresql'] as const;
export const DEFAULT_VECTOR_DIMENSIONS = 384;
