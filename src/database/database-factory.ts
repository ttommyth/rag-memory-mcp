/**
 * Database Factory
 * 
 * Factory class for creating database adapters based on configuration.
 * Provides a unified interface for database adapter creation and management.
 */

import {
  DatabaseAdapter,
  DatabaseConfig,
  DatabaseLogger,
  isSQLiteConfig,
  isPostgreSQLConfig,
  DEFAULT_SQLITE_CONFIG,
  DEFAULT_POSTGRESQL_CONFIG
} from './interfaces.js';

import { SQLiteAdapter } from './sqlite-adapter.js';
import { PostgreSQLAdapter } from './postgresql-adapter.js';
import { DatabaseLogger as Logger } from './logger.js';

/**
 * Database Factory Class
 */
export class DatabaseFactory {
  private static instance: DatabaseFactory | null = null;
  private logger: DatabaseLogger;
  private activeAdapter: DatabaseAdapter | null = null;

  private constructor(logger?: DatabaseLogger) {
    this.logger = logger || new Logger();
  }

  /**
   * Get singleton instance of DatabaseFactory
   */
  static getInstance(logger?: DatabaseLogger): DatabaseFactory {
    if (!DatabaseFactory.instance) {
      DatabaseFactory.instance = new DatabaseFactory(logger);
    }
    return DatabaseFactory.instance;
  }

  /**
   * Create a database adapter based on configuration
   */
  async createAdapter(config: DatabaseConfig): Promise<DatabaseAdapter> {
    this.logger.info('Creating database adapter', { type: config.type });

    let adapter: DatabaseAdapter;

    switch (config.type) {
      case 'sqlite':
        if (!isSQLiteConfig(config)) {
          throw new Error('Invalid SQLite configuration');
        }
        adapter = new SQLiteAdapter(this.logger);
        break;

      case 'postgresql':
        if (!isPostgreSQLConfig(config)) {
          throw new Error('Invalid PostgreSQL configuration');
        }
        adapter = new PostgreSQLAdapter(this.logger);
        break;

      default:
        throw new Error(`Unsupported database type: ${(config as any).type}`);
    }

    // Initialize the adapter
    await adapter.initialize(config);

    // Store reference to active adapter
    this.activeAdapter = adapter;

    this.logger.info('Database adapter created and initialized', { type: config.type });
    return adapter;
  }

  /**
   * Create SQLite adapter with default configuration
   */
  async createSQLiteAdapter(filePath: string, overrides?: Partial<DatabaseConfig>): Promise<DatabaseAdapter> {
    const config: DatabaseConfig = {
      ...DEFAULT_SQLITE_CONFIG,
      ...overrides,
      type: 'sqlite',
      sqlite: {
        ...DEFAULT_SQLITE_CONFIG.sqlite!,
        ...overrides?.sqlite,
        filePath
      }
    } as DatabaseConfig;

    return this.createAdapter(config);
  }

  /**
   * Create PostgreSQL adapter with default configuration
   */
  async createPostgreSQLAdapter(
    connectionParams: {
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
    },
    overrides?: Partial<DatabaseConfig>
  ): Promise<DatabaseAdapter> {
    const config: DatabaseConfig = {
      ...DEFAULT_POSTGRESQL_CONFIG,
      ...overrides,
      type: 'postgresql',
      postgresql: {
        ...DEFAULT_POSTGRESQL_CONFIG.postgresql!,
        ...overrides?.postgresql,
        ...connectionParams
      }
    } as DatabaseConfig;

    return this.createAdapter(config);
  }

  /**
   * Create adapter from environment variables
   */
  async createFromEnvironment(): Promise<DatabaseAdapter> {
    const dbType = process.env.DB_TYPE?.toLowerCase() as 'sqlite' | 'postgresql';

    if (!dbType) {
      throw new Error('DB_TYPE environment variable is required');
    }

    switch (dbType) {
      case 'sqlite':
        return this.createSQLiteAdapterFromEnv();

      case 'postgresql':
        return this.createPostgreSQLAdapterFromEnv();

      default:
        throw new Error(`Unsupported DB_TYPE: ${dbType}`);
    }
  }

  /**
   * Create SQLite adapter from environment variables
   */
  private async createSQLiteAdapterFromEnv(): Promise<DatabaseAdapter> {
    const filePath = process.env.SQLITE_FILE_PATH;
    if (!filePath) {
      throw new Error('SQLITE_FILE_PATH environment variable is required for SQLite');
    }

    const config: DatabaseConfig = {
      ...DEFAULT_SQLITE_CONFIG,
      type: 'sqlite',
      vectorDimensions: parseInt(process.env.VECTOR_DIMENSIONS || '384'),
      enableLogging: process.env.ENABLE_DB_LOGGING === 'true',
      queryTimeout: parseInt(process.env.QUERY_TIMEOUT || '30000'),
      sqlite: {
        filePath,
        enableWAL: process.env.SQLITE_ENABLE_WAL !== 'false',
        pragmas: {
          'cache_size': parseInt(process.env.SQLITE_CACHE_SIZE || '-64000'),
          'temp_store': process.env.SQLITE_TEMP_STORE || 'memory',
          'synchronous': process.env.SQLITE_SYNCHRONOUS || 'normal',
          'mmap_size': parseInt(process.env.SQLITE_MMAP_SIZE || '268435456')
        }
      }
    } as DatabaseConfig;

    return this.createAdapter(config);
  }

  /**
   * Create PostgreSQL adapter from environment variables
   */
  private async createPostgreSQLAdapterFromEnv(): Promise<DatabaseAdapter> {
    const requiredEnvVars = ['PG_HOST', 'PG_PORT', 'PG_DATABASE', 'PG_USERNAME', 'PG_PASSWORD'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    const config: DatabaseConfig = {
      ...DEFAULT_POSTGRESQL_CONFIG,
      type: 'postgresql',
      vectorDimensions: parseInt(process.env.VECTOR_DIMENSIONS || '384'),
      enableLogging: process.env.ENABLE_DB_LOGGING === 'true',
      queryTimeout: parseInt(process.env.QUERY_TIMEOUT || '30000'),
      postgresql: {
        host: process.env.PG_HOST!,
        port: parseInt(process.env.PG_PORT!),
        database: process.env.PG_DATABASE!,
        username: process.env.PG_USERNAME!,
        password: process.env.PG_PASSWORD!,
        ssl: process.env.PG_SSL === 'true' ? true : process.env.PG_SSL === 'false' ? false : undefined,
        pool: {
          min: parseInt(process.env.PG_POOL_MIN || '2'),
          max: parseInt(process.env.PG_POOL_MAX || '20'),
          idleTimeoutMillis: parseInt(process.env.PG_POOL_IDLE_TIMEOUT || '30000'),
          connectionTimeoutMillis: parseInt(process.env.PG_POOL_CONNECTION_TIMEOUT || '5000')
        }
      }
    } as DatabaseConfig;

    return this.createAdapter(config);
  }

  /**
   * Get the currently active adapter
   */
  getActiveAdapter(): DatabaseAdapter | null {
    return this.activeAdapter;
  }

  /**
   * Close the active adapter
   */
  async closeActiveAdapter(): Promise<void> {
    if (this.activeAdapter) {
      await this.activeAdapter.close();
      this.activeAdapter = null;
      this.logger.info('Active database adapter closed');
    }
  }

  /**
   * Validate database configuration
   */
  static validateConfig(config: DatabaseConfig): void {
    if (!config.type) {
      throw new Error('Database type is required');
    }

    if (!['sqlite', 'postgresql'].includes(config.type)) {
      throw new Error(`Unsupported database type: ${config.type}`);
    }

    if (!config.vectorDimensions || config.vectorDimensions <= 0) {
      throw new Error('Vector dimensions must be a positive number');
    }

    switch (config.type) {
      case 'sqlite':
        if (!config.sqlite?.filePath) {
          throw new Error('SQLite file path is required');
        }
        break;

      case 'postgresql':
        const pg = config.postgresql;
        if (!pg?.host || !pg?.port || !pg?.database || !pg?.username || !pg?.password) {
          throw new Error('PostgreSQL connection parameters are required');
        }
        break;
    }
  }

  /**
   * Create configuration from connection string
   */
  static createConfigFromConnectionString(connectionString: string): DatabaseConfig {
    try {
      const url = new URL(connectionString);
      
      switch (url.protocol) {
        case 'sqlite:':
          return {
            type: 'sqlite',
            vectorDimensions: 384,
            sqlite: {
              filePath: url.pathname,
              enableWAL: true
            }
          } as DatabaseConfig;

        case 'postgresql:':
        case 'postgres:':
          return {
            type: 'postgresql',
            vectorDimensions: 384,
            postgresql: {
              host: url.hostname,
              port: parseInt(url.port) || 5432,
              database: url.pathname.slice(1), // Remove leading slash
              username: url.username,
              password: url.password,
              ssl: url.searchParams.get('ssl') === 'true'
            }
          } as DatabaseConfig;

        default:
          throw new Error(`Unsupported protocol: ${url.protocol}`);
      }
    } catch (error) {
      throw new Error(`Invalid connection string: ${(error as Error).message}`);
    }
  }

  /**
   * Test database connection
   */
  static async testConnection(config: DatabaseConfig): Promise<boolean> {
    const factory = DatabaseFactory.getInstance();
    try {
      const adapter = await factory.createAdapter(config);
      const health = await adapter.getHealth();
      await adapter.close();
      return health.status !== 'unhealthy';
    } catch (error) {
      return false;
    }
  }
}

/**
 * Convenience function to create database adapter
 */
export async function createDatabaseAdapter(config: DatabaseConfig): Promise<DatabaseAdapter> {
  const factory = DatabaseFactory.getInstance();
  return factory.createAdapter(config);
}

/**
 * Convenience function to create adapter from environment
 */
export async function createDatabaseAdapterFromEnv(): Promise<DatabaseAdapter> {
  const factory = DatabaseFactory.getInstance();
  return factory.createFromEnvironment();
}
