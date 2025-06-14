/**
 * Multi-Database Migration Manager
 * 
 * Enhanced migration system that supports both SQLite and PostgreSQL databases.
 * Provides unified migration interface with database-specific implementations.
 */

import {
  DatabaseAdapter,
  Migration,
  MigrationResult,
  RollbackResult,
  DatabaseLogger
} from './interfaces.js';
import { DatabaseLogger as Logger } from './logger.js';

/**
 * Multi-database migration interface
 */
export interface MultiDbMigration {
  version: number;
  description: string;
  sqlite?: {
    up: (adapter: DatabaseAdapter) => Promise<void>;
    down?: (adapter: DatabaseAdapter) => Promise<void>;
  };
  postgresql?: {
    up: (adapter: DatabaseAdapter) => Promise<void>;
    down?: (adapter: DatabaseAdapter) => Promise<void>;
  };
  // Common migration that works for both databases
  common?: {
    up: (adapter: DatabaseAdapter) => Promise<void>;
    down?: (adapter: DatabaseAdapter) => Promise<void>;
  };
}

/**
 * Migration status information
 */
export interface MigrationStatus {
  version: number;
  description: string;
  applied: boolean;
  applied_at?: Date;
  database_type: string;
}

/**
 * Data transfer operation interface
 */
export interface DataTransferOperation {
  name: string;
  description: string;
  sourceAdapter: DatabaseAdapter;
  targetAdapter: DatabaseAdapter;
  execute: () => Promise<DataTransferResult>;
  validate?: () => Promise<ValidationResult>;
}

/**
 * Data transfer result
 */
export interface DataTransferResult {
  success: boolean;
  recordsTransferred: number;
  errors: string[];
  duration: number;
  details: Record<string, any>;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  details: Record<string, any>;
}

/**
 * Multi-Database Migration Manager
 */
export class MultiDbMigrationManager {
  private adapter: DatabaseAdapter;
  private migrations: MultiDbMigration[] = [];
  private logger: DatabaseLogger;
  private databaseType: string;

  constructor(adapter: DatabaseAdapter, logger?: DatabaseLogger) {
    this.adapter = adapter;
    this.logger = logger || new Logger();
    this.databaseType = this.detectDatabaseType();
  }

  // ============================================================================
  // Migration Management
  // ============================================================================

  /**
   * Add a migration to the manager
   */
  addMigration(migration: MultiDbMigration): void {
    // Validate migration has implementation for current database type
    if (!this.hasMigrationForCurrentDb(migration)) {
      throw new Error(
        `Migration ${migration.version} does not have implementation for ${this.databaseType}`
      );
    }

    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.version - b.version);
    
    this.logger.debug(`Added migration ${migration.version}: ${migration.description}`);
  }

  /**
   * Add multiple migrations
   */
  addMigrations(migrations: MultiDbMigration[]): void {
    migrations.forEach(migration => this.addMigration(migration));
  }

  /**
   * Get current database schema version
   */
  async getCurrentVersion(): Promise<number> {
    return this.adapter.getCurrentVersion();
  }

  /**
   * Get pending migrations
   */
  async getPendingMigrations(): Promise<MultiDbMigration[]> {
    const currentVersion = await this.getCurrentVersion();
    return this.migrations
      .filter(m => m.version > currentVersion)
      .sort((a, b) => a.version - b.version);
  }

  /**
   * Get migration status for all migrations
   */
  async getMigrationStatus(): Promise<MigrationStatus[]> {
    const currentVersion = await this.getCurrentVersion();
    
    return this.migrations.map(migration => ({
      version: migration.version,
      description: migration.description,
      applied: migration.version <= currentVersion,
      database_type: this.databaseType
    }));
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<MigrationResult> {
    const pendingMigrations = await this.getPendingMigrations();
    
    if (pendingMigrations.length === 0) {
      this.logger.info('Database schema is up to date');
      return {
        applied: 0,
        currentVersion: await this.getCurrentVersion(),
        appliedMigrations: []
      };
    }

    this.logger.info(`Running ${pendingMigrations.length} pending migrations`);

    const appliedMigrations: Array<{ version: number; description: string }> = [];
    
    for (const migration of pendingMigrations) {
      try {
        this.logger.info(`Applying migration ${migration.version}: ${migration.description}`);
        
        await this.runSingleMigration(migration);
        
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

    const currentVersion = await this.getCurrentVersion();
    this.logger.info(`Migrations completed: ${appliedMigrations.length} applied, current version: ${currentVersion}`);
    
    return {
      applied: appliedMigrations.length,
      currentVersion,
      appliedMigrations
    };
  }

  /**
   * Rollback to a specific version
   */
  async rollbackMigration(targetVersion: number): Promise<RollbackResult> {
    const currentVersion = await this.getCurrentVersion();
    
    if (targetVersion >= currentVersion) {
      throw new Error('Target version must be lower than current version');
    }

    const migrationsToRollback = this.migrations
      .filter(m => m.version > targetVersion && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version); // Reverse order for rollback

    this.logger.info(`Rolling back ${migrationsToRollback.length} migrations to version ${targetVersion}`);

    const rolledBackMigrations: Array<{ version: number; description: string }> = [];

    for (const migration of migrationsToRollback) {
      if (!this.hasRollbackForCurrentDb(migration)) {
        throw new Error(`Migration ${migration.version} does not support rollback for ${this.databaseType}`);
      }

      try {
        this.logger.info(`Rolling back migration ${migration.version}: ${migration.description}`);
        
        await this.rollbackSingleMigration(migration);
        
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

    const newCurrentVersion = await this.getCurrentVersion();
    this.logger.info(`Rollback completed to version ${newCurrentVersion}`);

    return {
      rolledBack: rolledBackMigrations.length,
      currentVersion: newCurrentVersion,
      rolledBackMigrations
    };
  }

  // ============================================================================
  // Data Transfer Operations
  // ============================================================================

  /**
   * Execute data transfer from SQLite to PostgreSQL
   */
  async transferData(
    sourceAdapter: DatabaseAdapter,
    targetAdapter: DatabaseAdapter,
    operations: DataTransferOperation[]
  ): Promise<DataTransferResult[]> {
    this.logger.info(`Starting data transfer: ${operations.length} operations`);

    const results: DataTransferResult[] = [];

    for (const operation of operations) {
      this.logger.info(`Executing transfer operation: ${operation.name}`);
      
      try {
        // Validate operation if validation is provided
        if (operation.validate) {
          const validation = await operation.validate();
          if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
          }
        }

        const startTime = Date.now();
        const result = await operation.execute();
        const duration = Date.now() - startTime;

        const transferResult: DataTransferResult = {
          ...result,
          duration
        };

        results.push(transferResult);
        
        if (result.success) {
          this.logger.info(`Transfer operation ${operation.name} completed: ${result.recordsTransferred} records in ${duration}ms`);
        } else {
          this.logger.error(`Transfer operation ${operation.name} failed: ${result.errors.join(', ')}`);
        }
        
      } catch (error) {
        this.logger.error(`Transfer operation ${operation.name} failed`, error as Error);
        results.push({
          success: false,
          recordsTransferred: 0,
          errors: [(error as Error).message],
          duration: 0,
          details: {}
        });
      }
    }

    const totalRecords = results.reduce((sum, r) => sum + r.recordsTransferred, 0);
    const successfulOps = results.filter(r => r.success).length;
    
    this.logger.info(`Data transfer completed: ${successfulOps}/${operations.length} operations successful, ${totalRecords} total records transferred`);

    return results;
  }

  /**
   * Validate data consistency between source and target databases
   */
  async validateDataConsistency(
    sourceAdapter: DatabaseAdapter,
    targetAdapter: DatabaseAdapter
  ): Promise<ValidationResult> {
    this.logger.info('Validating data consistency between databases');

    const errors: string[] = [];
    const warnings: string[] = [];
    const details: Record<string, any> = {};

    try {
      // Get statistics from both databases
      const sourceStats = await sourceAdapter.getKnowledgeGraphStats();
      const targetStats = await targetAdapter.getKnowledgeGraphStats();

      // Compare entity counts
      if (sourceStats.entities.total !== targetStats.entities.total) {
        errors.push(`Entity count mismatch: source=${sourceStats.entities.total}, target=${targetStats.entities.total}`);
      }

      // Compare relationship counts
      if (sourceStats.relationships.total !== targetStats.relationships.total) {
        errors.push(`Relationship count mismatch: source=${sourceStats.relationships.total}, target=${targetStats.relationships.total}`);
      }

      // Compare document counts
      if (sourceStats.documents.total !== targetStats.documents.total) {
        errors.push(`Document count mismatch: source=${sourceStats.documents.total}, target=${targetStats.documents.total}`);
      }

      // Compare chunk counts
      if (sourceStats.chunks.total !== targetStats.chunks.total) {
        errors.push(`Chunk count mismatch: source=${sourceStats.chunks.total}, target=${targetStats.chunks.total}`);
      }

      details.sourceStats = sourceStats;
      details.targetStats = targetStats;

      const isValid = errors.length === 0;
      
      if (isValid) {
        this.logger.info('Data consistency validation passed');
      } else {
        this.logger.warn(`Data consistency validation failed: ${errors.length} errors`);
      }

      return {
        valid: isValid,
        errors,
        warnings,
        details
      };

    } catch (error) {
      this.logger.error('Data consistency validation failed', error as Error);
      return {
        valid: false,
        errors: [`Validation error: ${(error as Error).message}`],
        warnings,
        details
      };
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private detectDatabaseType(): string {
    // Detect database type based on the adapter class name
    const adapterName = this.adapter.constructor.name;
    console.error(`🔍 Detecting database type from adapter: ${adapterName}`);
    
    if (adapterName.includes('SQLite')) {
      console.error('✅ Detected SQLite database type');
      return 'sqlite';
    }
    if (adapterName.includes('PostgreSQL')) {
      console.error('✅ Detected PostgreSQL database type');
      return 'postgresql';
    }
    
    console.error(`⚠️ Unknown database type from adapter: ${adapterName}, defaulting to 'unknown'`);
    return 'unknown';
  }

  private hasMigrationForCurrentDb(migration: MultiDbMigration): boolean {
    return !!(
      migration.common ||
      (this.databaseType === 'sqlite' && migration.sqlite) ||
      (this.databaseType === 'postgresql' && migration.postgresql)
    );
  }

  private hasRollbackForCurrentDb(migration: MultiDbMigration): boolean {
    return !!(
      migration.common?.down ||
      (this.databaseType === 'sqlite' && migration.sqlite?.down) ||
      (this.databaseType === 'postgresql' && migration.postgresql?.down)
    );
  }

  private async runSingleMigration(migration: MultiDbMigration): Promise<void> {
    console.error(`🚀 Running migration ${migration.version} for database type: ${this.databaseType}`);
    
    // Log what migration implementations are available
    console.error(`📋 Available implementations for migration ${migration.version}:`);
    console.error(`   - common: ${!!migration.common}`);
    console.error(`   - sqlite: ${!!migration.sqlite}`);
    console.error(`   - postgresql: ${!!migration.postgresql}`);
    
    // Convert to the interface expected by the adapter
    const adapterMigration: Migration = {
      version: migration.version,
      description: migration.description,
      up: async (adapter: DatabaseAdapter) => {
        if (migration.common) {
          console.error(`✅ Executing common migration for version ${migration.version}`);
          await migration.common.up(adapter);
        } else if (this.databaseType === 'sqlite' && migration.sqlite) {
          console.error(`✅ Executing SQLite-specific migration for version ${migration.version}`);
          await migration.sqlite.up(adapter);
        } else if (this.databaseType === 'postgresql' && migration.postgresql) {
          console.error(`✅ Executing PostgreSQL-specific migration for version ${migration.version}`);
          await migration.postgresql.up(adapter);
        } else {
          const errorMsg = `No migration implementation found for ${this.databaseType} in migration ${migration.version}`;
          console.error(`❌ ${errorMsg}`);
          throw new Error(errorMsg);
        }
      },
      down: migration.common?.down || 
            (this.databaseType === 'sqlite' ? migration.sqlite?.down : undefined) ||
            (this.databaseType === 'postgresql' ? migration.postgresql?.down : undefined)
    };

    await this.adapter.runMigrations([adapterMigration]);
  }

  private async rollbackSingleMigration(migration: MultiDbMigration): Promise<void> {
    const downFunction = migration.common?.down ||
                        (this.databaseType === 'sqlite' ? migration.sqlite?.down : undefined) ||
                        (this.databaseType === 'postgresql' ? migration.postgresql?.down : undefined);

    if (!downFunction) {
      throw new Error(`No rollback implementation found for migration ${migration.version}`);
    }

    await downFunction(this.adapter);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get database type
   */
  getDatabaseType(): string {
    return this.databaseType;
  }

  /**
   * Get all migrations
   */
  getAllMigrations(): MultiDbMigration[] {
    return [...this.migrations];
  }

  /**
   * Clear all migrations (for testing)
   */
  clearMigrations(): void {
    this.migrations = [];
  }
}
