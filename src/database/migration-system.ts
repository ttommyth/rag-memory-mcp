/**
 * Migration System - Main Export
 * 
 * Comprehensive migration and data transfer system for RAG Memory MCP.
 * Supports both SQLite and PostgreSQL with unified migration management.
 */

// Core Migration System
export { MultiDbMigrationManager } from './multi-db-migration-manager.js';
export { multiDbMigrations, getMigrationsForDatabase, validateMigrationsForDatabase } from './multi-db-migrations.js';

// Data Transfer Operations
export {
  EntityTransferOperation,
  RelationshipTransferOperation,
  DocumentTransferOperation,
  VectorTransferOperation,
  createStandardDataTransferOperations,
  executeCompleteDataMigration
} from './data-transfer-operations.js';

// CLI Tool
export { MigrationCli } from './migration-cli.js';

// Types and Interfaces
export type {
  MultiDbMigration,
  MigrationStatus,
  DataTransferOperation,
  DataTransferResult,
  ValidationResult
} from './multi-db-migration-manager.js';

/**
 * Quick start function to create a migration manager for a database adapter
 */
export async function createMigrationManager(adapter: any, logger?: any): Promise<any> {
  const { MultiDbMigrationManager } = await import('./multi-db-migration-manager.js');
  const { multiDbMigrations } = await import('./multi-db-migrations.js');
  
  const manager = new MultiDbMigrationManager(adapter, logger);
  manager.addMigrations(multiDbMigrations);
  
  return manager;
}

/**
 * Quick start function to execute a complete SQLite to PostgreSQL migration
 */
export async function migrateFromSQLiteToPostgreSQL(
  sqliteAdapter: any,
  postgresAdapter: any,
  logger?: any
): Promise<any[]> {
  const { executeCompleteDataMigration } = await import('./data-transfer-operations.js');
  return executeCompleteDataMigration(sqliteAdapter, postgresAdapter, logger);
}

/**
 * Validate that a database has all required migrations applied
 */
export async function validateDatabaseMigrations(adapter: any, logger?: any): Promise<boolean> {
  const manager = await createMigrationManager(adapter, logger);
  const pendingMigrations = await manager.getPendingMigrations();
  return pendingMigrations.length === 0;
}

/**
 * Get migration status for a database
 */
export async function getDatabaseMigrationStatus(adapter: any, logger?: any): Promise<any[]> {
  const manager = await createMigrationManager(adapter, logger);
  return manager.getMigrationStatus();
}

/**
 * Run all pending migrations for a database
 */
export async function runPendingMigrations(adapter: any, logger?: any): Promise<any> {
  const manager = await createMigrationManager(adapter, logger);
  return manager.runMigrations();
}

// Version information
export const MIGRATION_SYSTEM_VERSION = '1.0.0';
export const SUPPORTED_DATABASES = ['sqlite', 'postgresql'] as const;
export const LATEST_MIGRATION_VERSION = 4;
