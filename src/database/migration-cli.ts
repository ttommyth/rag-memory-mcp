#!/usr/bin/env node

/**
 * Migration CLI Tool
 * 
 * Command-line interface for managing database migrations and data transfers.
 * Supports both SQLite and PostgreSQL databases with comprehensive migration operations.
 */

import { DatabaseManager } from './database-manager.js';
import { MultiDbMigrationManager } from './multi-db-migration-manager.js';
import { multiDbMigrations } from './multi-db-migrations.js';
import { executeCompleteDataMigration } from './data-transfer-operations.js';
import { DatabaseConfig } from './interfaces.js';
import { DatabaseLogger } from './logger.js';

/**
 * CLI Command interface
 */
interface CliCommand {
  name: string;
  description: string;
  execute: (args: string[]) => Promise<void>;
}

/**
 * Migration CLI class
 */
class MigrationCli {
  private logger: DatabaseLogger;
  private commands: Map<string, CliCommand> = new Map();

  constructor() {
    this.logger = new DatabaseLogger({
      level: 1, // INFO level
      prefix: '[MIGRATION-CLI]',
      colorize: true,
      includeTimestamp: true
    });

    this.registerCommands();
  }

  /**
   * Register all available commands
   */
  private registerCommands(): void {
    const commands: CliCommand[] = [
      {
        name: 'status',
        description: 'Show migration status for a database',
        execute: this.statusCommand.bind(this)
      },
      {
        name: 'migrate',
        description: 'Run pending migrations',
        execute: this.migrateCommand.bind(this)
      },
      {
        name: 'rollback',
        description: 'Rollback migrations to a specific version',
        execute: this.rollbackCommand.bind(this)
      },
      {
        name: 'transfer',
        description: 'Transfer data from SQLite to PostgreSQL',
        execute: this.transferCommand.bind(this)
      },
      {
        name: 'validate',
        description: 'Validate data consistency between databases',
        execute: this.validateCommand.bind(this)
      },
      {
        name: 'help',
        description: 'Show help information',
        execute: this.helpCommand.bind(this)
      }
    ];

    commands.forEach(cmd => this.commands.set(cmd.name, cmd));
  }

  /**
   * Parse command line arguments and execute command
   */
  async run(args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.helpCommand([]);
      return;
    }

    const commandName = args[0];
    const commandArgs = args.slice(1);

    const command = this.commands.get(commandName);
    if (!command) {
      this.logger.error(`Unknown command: ${commandName}`);
      await this.helpCommand([]);
      process.exit(1);
    }

    try {
      await command.execute(commandArgs);
    } catch (error) {
      this.logger.error(`Command failed: ${commandName}`, error as Error);
      process.exit(1);
    }
  }

  /**
   * Show migration status
   */
  private async statusCommand(args: string[]): Promise<void> {
    const config = this.parseConfigFromArgs(args);
    const manager = new DatabaseManager();
    
    try {
      await manager.initialize(config);
      const adapter = manager.getAdapter();
      
      if (!adapter) {
        throw new Error('Failed to initialize database adapter');
      }

      const migrationManager = new MultiDbMigrationManager(adapter, this.logger);
      migrationManager.addMigrations(multiDbMigrations);

      const status = await migrationManager.getMigrationStatus();
      const currentVersion = await migrationManager.getCurrentVersion();

      console.log('\n📊 Migration Status');
      console.log('==================');
      console.log(`Database Type: ${migrationManager.getDatabaseType()}`);
      console.log(`Current Version: ${currentVersion}`);
      console.log(`Total Migrations: ${status.length}`);
      console.log(`Applied: ${status.filter(s => s.applied).length}`);
      console.log(`Pending: ${status.filter(s => !s.applied).length}`);

      console.log('\n📋 Migration Details:');
      status.forEach(migration => {
        const statusIcon = migration.applied ? '✅' : '⏳';
        console.log(`  ${statusIcon} v${migration.version}: ${migration.description}`);
      });

    } finally {
      await manager.close();
    }
  }

  /**
   * Run pending migrations
   */
  private async migrateCommand(args: string[]): Promise<void> {
    const config = this.parseConfigFromArgs(args);
    const manager = new DatabaseManager();
    
    try {
      await manager.initialize(config);
      const adapter = manager.getAdapter();
      
      if (!adapter) {
        throw new Error('Failed to initialize database adapter');
      }

      const migrationManager = new MultiDbMigrationManager(adapter, this.logger);
      migrationManager.addMigrations(multiDbMigrations);

      console.log('\n🔄 Running Migrations');
      console.log('====================');

      const result = await migrationManager.runMigrations();

      console.log(`\n✅ Migration completed:`);
      console.log(`  Applied: ${result.applied} migrations`);
      console.log(`  Current Version: ${result.currentVersion}`);

      if (result.appliedMigrations.length > 0) {
        console.log('\n📋 Applied Migrations:');
        result.appliedMigrations.forEach(migration => {
          console.log(`  ✅ v${migration.version}: ${migration.description}`);
        });
      }

    } finally {
      await manager.close();
    }
  }

  /**
   * Rollback migrations
   */
  private async rollbackCommand(args: string[]): Promise<void> {
    if (args.length < 2) {
      console.error('Usage: rollback <config-args> <target-version>');
      return;
    }

    const targetVersion = parseInt(args[args.length - 1]);
    const configArgs = args.slice(0, -1);

    if (isNaN(targetVersion)) {
      console.error('Target version must be a number');
      return;
    }

    const config = this.parseConfigFromArgs(configArgs);
    const manager = new DatabaseManager();
    
    try {
      await manager.initialize(config);
      const adapter = manager.getAdapter();
      
      if (!adapter) {
        throw new Error('Failed to initialize database adapter');
      }

      const migrationManager = new MultiDbMigrationManager(adapter, this.logger);
      migrationManager.addMigrations(multiDbMigrations);

      console.log(`\n🔄 Rolling back to version ${targetVersion}`);
      console.log('=====================================');

      const result = await migrationManager.rollbackMigration(targetVersion);

      console.log(`\n✅ Rollback completed:`);
      console.log(`  Rolled back: ${result.rolledBack} migrations`);
      console.log(`  Current Version: ${result.currentVersion}`);

      if (result.rolledBackMigrations.length > 0) {
        console.log('\n📋 Rolled Back Migrations:');
        result.rolledBackMigrations.forEach(migration => {
          console.log(`  ↩️ v${migration.version}: ${migration.description}`);
        });
      }

    } finally {
      await manager.close();
    }
  }

  /**
   * Transfer data from SQLite to PostgreSQL
   */
  private async transferCommand(args: string[]): Promise<void> {
    if (args.length < 2) {
      console.error('Usage: transfer <sqlite-config> <postgresql-config>');
      console.error('Example: transfer --sqlite-file=./data.db --pg-host=localhost --pg-port=5432 --pg-db=rag_memory --pg-user=rag_user --pg-pass=password');
      return;
    }

    // Parse source and target configurations
    const sqliteConfig = this.parseSQLiteConfig(args);
    const postgresConfig = this.parsePostgreSQLConfig(args);

    const sourceManager = new DatabaseManager();
    const targetManager = new DatabaseManager();

    try {
      console.log('\n🔄 Starting Data Transfer');
      console.log('=========================');

      // Initialize source (SQLite) and target (PostgreSQL) databases
      await sourceManager.initialize(sqliteConfig);
      await targetManager.initialize(postgresConfig);

      const sourceAdapter = sourceManager.getAdapter();
      const targetAdapter = targetManager.getAdapter();

      if (!sourceAdapter || !targetAdapter) {
        throw new Error('Failed to initialize database adapters');
      }

      // Execute complete data migration
      const results = await executeCompleteDataMigration(
        sourceAdapter,
        targetAdapter,
        this.logger
      );

      // Display results
      console.log('\n📊 Transfer Results');
      console.log('==================');

      let totalRecords = 0;
      let successfulOps = 0;

      results.forEach(result => {
        const statusIcon = result.success ? '✅' : '❌';
        console.log(`${statusIcon} ${result.details?.operation || 'Unknown'}: ${result.recordsTransferred} records`);
        
        if (result.errors.length > 0) {
          result.errors.forEach(error => {
            console.log(`   ⚠️ ${error}`);
          });
        }

        totalRecords += result.recordsTransferred;
        if (result.success) successfulOps++;
      });

      console.log(`\n📈 Summary:`);
      console.log(`  Successful Operations: ${successfulOps}/${results.length}`);
      console.log(`  Total Records Transferred: ${totalRecords}`);

    } finally {
      await sourceManager.close();
      await targetManager.close();
    }
  }

  /**
   * Validate data consistency
   */
  private async validateCommand(args: string[]): Promise<void> {
    if (args.length < 2) {
      console.error('Usage: validate <sqlite-config> <postgresql-config>');
      return;
    }

    const sqliteConfig = this.parseSQLiteConfig(args);
    const postgresConfig = this.parsePostgreSQLConfig(args);

    const sourceManager = new DatabaseManager();
    const targetManager = new DatabaseManager();

    try {
      console.log('\n🔍 Validating Data Consistency');
      console.log('==============================');

      await sourceManager.initialize(sqliteConfig);
      await targetManager.initialize(postgresConfig);

      const sourceAdapter = sourceManager.getAdapter();
      const targetAdapter = targetManager.getAdapter();

      if (!sourceAdapter || !targetAdapter) {
        throw new Error('Failed to initialize database adapters');
      }

      const migrationManager = new MultiDbMigrationManager(sourceAdapter, this.logger);
      const validation = await migrationManager.validateDataConsistency(sourceAdapter, targetAdapter);

      if (validation.valid) {
        console.log('✅ Data consistency validation passed');
      } else {
        console.log('❌ Data consistency validation failed');
        validation.errors.forEach(error => {
          console.log(`   ⚠️ ${error}`);
        });
      }

      if (validation.warnings.length > 0) {
        console.log('\n⚠️ Warnings:');
        validation.warnings.forEach(warning => {
          console.log(`   ${warning}`);
        });
      }

      if (validation.details.sourceStats && validation.details.targetStats) {
        console.log('\n📊 Statistics Comparison:');
        console.log(`  Entities: ${validation.details.sourceStats.entities.total} → ${validation.details.targetStats.entities.total}`);
        console.log(`  Relationships: ${validation.details.sourceStats.relationships.total} → ${validation.details.targetStats.relationships.total}`);
        console.log(`  Documents: ${validation.details.sourceStats.documents.total} → ${validation.details.targetStats.documents.total}`);
        console.log(`  Chunks: ${validation.details.sourceStats.chunks.total} → ${validation.details.targetStats.chunks.total}`);
      }

    } finally {
      await sourceManager.close();
      await targetManager.close();
    }
  }

  /**
   * Show help information
   */
  private async helpCommand(args: string[]): Promise<void> {
    console.log('\n🛠️ RAG Memory MCP - Migration CLI');
    console.log('==================================');
    console.log('Manage database migrations and data transfers\n');

    console.log('Commands:');
    this.commands.forEach(command => {
      console.log(`  ${command.name.padEnd(12)} ${command.description}`);
    });

    console.log('\nConfiguration Arguments:');
    console.log('  SQLite:');
    console.log('    --sqlite-file=<path>     Path to SQLite database file');
    console.log('  PostgreSQL:');
    console.log('    --pg-host=<host>         PostgreSQL host');
    console.log('    --pg-port=<port>         PostgreSQL port');
    console.log('    --pg-db=<database>       PostgreSQL database name');
    console.log('    --pg-user=<username>     PostgreSQL username');
    console.log('    --pg-pass=<password>     PostgreSQL password');
    console.log('    --pg-ssl=<true/false>    Enable SSL connection (default: false)');

    console.log('\nExamples:');
    console.log('  migration-cli status --sqlite-file=./memory.db');
    console.log('  migration-cli migrate --pg-host=localhost --pg-port=5432 --pg-db=rag_memory --pg-user=rag_user --pg-pass=password');
    console.log('  migration-cli transfer --sqlite-file=./memory.db --pg-host=localhost --pg-port=5432 --pg-db=rag_memory --pg-user=rag_user --pg-pass=password');
  }

  /**
   * Parse configuration from command line arguments
   */
  private parseConfigFromArgs(args: string[]): DatabaseConfig {
    const sqliteFile = this.getArgValue(args, '--sqlite-file');
    const pgHost = this.getArgValue(args, '--pg-host');

    if (sqliteFile) {
      return this.parseSQLiteConfig(args);
    } else if (pgHost) {
      return this.parsePostgreSQLConfig(args);
    } else {
      throw new Error('Must specify either SQLite (--sqlite-file) or PostgreSQL (--pg-host) configuration');
    }
  }

  /**
   * Parse SQLite configuration
   */
  private parseSQLiteConfig(args: string[]): DatabaseConfig {
    const filePath = this.getArgValue(args, '--sqlite-file');
    if (!filePath) {
      throw new Error('SQLite file path is required (--sqlite-file)');
    }

    return {
      type: 'sqlite',
      vectorDimensions: 384,
      sqlite: {
        filePath,
        enableWAL: true
      }
    };
  }

  /**
   * Parse PostgreSQL configuration
   */
  private parsePostgreSQLConfig(args: string[]): DatabaseConfig {
    const host = this.getArgValue(args, '--pg-host');
    const port = this.getArgValue(args, '--pg-port');
    const database = this.getArgValue(args, '--pg-db');
    const username = this.getArgValue(args, '--pg-user');
    const password = this.getArgValue(args, '--pg-pass');
    const ssl = this.getArgValue(args, '--pg-ssl');

    if (!host || !port || !database || !username || !password) {
      throw new Error('PostgreSQL configuration requires: --pg-host, --pg-port, --pg-db, --pg-user, --pg-pass');
    }

    return {
      type: 'postgresql',
      vectorDimensions: 384,
      postgresql: {
        host,
        port: parseInt(port),
        database,
        username,
        password,
        ssl: ssl === 'true' || ssl === '1' ? { rejectUnauthorized: false } : false,
        pool: {
          min: 2,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000
        }
      }
    };
  }

  /**
   * Get argument value from command line args
   */
  private getArgValue(args: string[], argName: string): string | undefined {
    const arg = args.find(a => a.startsWith(`${argName}=`));
    return arg ? arg.split('=')[1] : undefined;
  }
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const cli = new MigrationCli();
  const args = process.argv.slice(2);
  await cli.run(args);
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('CLI Error:', error);
    process.exit(1);
  });
}

export { MigrationCli };
