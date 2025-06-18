/**
 * Database Configuration Manager
 * 
 * Manages database configuration loading, validation, and environment-specific settings.
 * Supports multiple configuration sources and runtime configuration switching.
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  DatabaseConfig,
  DatabaseLogger,
  DEFAULT_SQLITE_CONFIG,
  DEFAULT_POSTGRESQL_CONFIG
} from './interfaces.js';
import { DatabaseLogger as Logger } from './logger.js';

/**
 * Configuration source types
 */
export type ConfigSource = 'environment' | 'file' | 'object';

/**
 * Configuration file format
 */
export interface ConfigFile {
  default?: string; // Default configuration name
  configurations: Record<string, DatabaseConfig>;
}

/**
 * Configuration Manager Class
 */
export class ConfigManager {
  private logger: DatabaseLogger;
  private loadedConfigs: Map<string, DatabaseConfig> = new Map();
  private activeConfigName: string | null = null;

  constructor(logger?: DatabaseLogger) {
    this.logger = logger || new Logger();
  }

  // ============================================================================
  // Configuration Loading
  // ============================================================================

  /**
   * Load configuration from environment variables
   */
  loadFromEnvironment(): DatabaseConfig {
    this.logger.info('Loading database configuration from environment variables');

    const dbType = process.env.DB_TYPE?.toLowerCase() as 'sqlite' | 'postgresql';
    if (!dbType) {
      throw new Error('DB_TYPE environment variable is required');
    }

    let config: DatabaseConfig;

    switch (dbType) {
      case 'sqlite':
        config = this.loadSQLiteFromEnvironment();
        break;
      case 'postgresql':
        config = this.loadPostgreSQLFromEnvironment();
        break;
      default:
        throw new Error(`Unsupported DB_TYPE: ${dbType}`);
    }

    this.validateConfiguration(config);
    this.loadedConfigs.set('environment', config);
    this.activeConfigName = 'environment';

    this.logger.info('Configuration loaded from environment', { type: config.type });
    return config;
  }

  /**
   * Load configuration from JSON file
   */
  async loadFromFile(filePath: string, configName?: string): Promise<DatabaseConfig> {
    this.logger.info('Loading database configuration from file', { filePath, configName });

    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const configFile: ConfigFile = JSON.parse(fileContent);

      // Determine which configuration to use
      const targetConfigName = configName || configFile.default || 'default';
      
      if (!configFile.configurations[targetConfigName]) {
        throw new Error(`Configuration '${targetConfigName}' not found in file`);
      }

      const config = configFile.configurations[targetConfigName];
      this.validateConfiguration(config);

      // Store all configurations from file
      for (const [name, cfg] of Object.entries(configFile.configurations)) {
        this.loadedConfigs.set(name, cfg);
      }

      this.activeConfigName = targetConfigName;
      this.logger.info('Configuration loaded from file', { 
        type: config.type, 
        configName: targetConfigName 
      });

      return config;
    } catch (error) {
      this.logger.error('Failed to load configuration from file', error as Error, { filePath });
      throw error;
    }
  }

  /**
   * Load configuration from object
   */
  loadFromObject(config: DatabaseConfig, configName: string = 'object'): DatabaseConfig {
    this.logger.info('Loading database configuration from object', { configName });

    this.validateConfiguration(config);
    this.loadedConfigs.set(configName, config);
    this.activeConfigName = configName;

    this.logger.info('Configuration loaded from object', { type: config.type, configName });
    return config;
  }

  // ============================================================================
  // Configuration Management
  // ============================================================================

  /**
   * Get active configuration
   */
  getActiveConfiguration(): DatabaseConfig | null {
    if (!this.activeConfigName) {
      return null;
    }
    return this.loadedConfigs.get(this.activeConfigName) || null;
  }

  /**
   * Get configuration by name
   */
  getConfiguration(name: string): DatabaseConfig | null {
    return this.loadedConfigs.get(name) || null;
  }

  /**
   * List all loaded configurations
   */
  listConfigurations(): string[] {
    return Array.from(this.loadedConfigs.keys());
  }

  /**
   * Switch to a different configuration
   */
  switchConfiguration(name: string): DatabaseConfig {
    const config = this.loadedConfigs.get(name);
    if (!config) {
      throw new Error(`Configuration '${name}' not found`);
    }

    this.activeConfigName = name;
    this.logger.info('Switched to configuration', { configName: name, type: config.type });
    return config;
  }

  /**
   * Save current configurations to file
   */
  async saveToFile(filePath: string, defaultConfigName?: string): Promise<void> {
    this.logger.info('Saving configurations to file', { filePath });

    const configFile: ConfigFile = {
      default: defaultConfigName || this.activeConfigName || undefined,
      configurations: Object.fromEntries(this.loadedConfigs)
    };

    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Write configuration file
      await fs.writeFile(filePath, JSON.stringify(configFile, null, 2), 'utf-8');
      this.logger.info('Configurations saved to file', { filePath });
    } catch (error) {
      this.logger.error('Failed to save configurations to file', error as Error, { filePath });
      throw error;
    }
  }

  // ============================================================================
  // Environment-Specific Loading
  // ============================================================================

  private loadSQLiteFromEnvironment(): DatabaseConfig {
    const filePath = process.env.SQLITE_FILE_PATH;
    if (!filePath) {
      throw new Error('SQLITE_FILE_PATH environment variable is required for SQLite');
    }

    return {
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
  }

  private loadPostgreSQLFromEnvironment(): DatabaseConfig {
    const requiredEnvVars = ['PG_HOST', 'PG_PORT', 'PG_DATABASE', 'PG_USERNAME', 'PG_PASSWORD'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    return {
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
        ssl: this.parseSSLConfig(process.env.PG_SSL),
        pool: {
          min: parseInt(process.env.PG_POOL_MIN || '2'),
          max: parseInt(process.env.PG_POOL_MAX || '20'),
          idleTimeoutMillis: parseInt(process.env.PG_POOL_IDLE_TIMEOUT || '30000'),
          connectionTimeoutMillis: parseInt(process.env.PG_POOL_CONNECTION_TIMEOUT || '5000')
        }
      }
    } as DatabaseConfig;
  }

  private parseSSLConfig(sslEnv?: string): boolean | object | undefined {
    if (!sslEnv) return undefined;
    
    if (sslEnv === 'true') {
      // Check if we should reject unauthorized certificates (default: true for security)
      const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false';
      
      // Support for certificate files
      const sslConfig: any = { rejectUnauthorized };
      
      // CA Certificate (Certificate Authority)
      if (process.env.PG_SSL_CA_FILE) {
        try {
          const fs = require('fs');
          sslConfig.ca = fs.readFileSync(process.env.PG_SSL_CA_FILE, 'utf8');
        } catch (error) {
          throw new Error(`Failed to read CA certificate file: ${process.env.PG_SSL_CA_FILE}`);
        }
      }
      
      // Client Certificate (for mutual TLS)
      if (process.env.PG_SSL_CERT_FILE) {
        try {
          const fs = require('fs');
          sslConfig.cert = fs.readFileSync(process.env.PG_SSL_CERT_FILE, 'utf8');
        } catch (error) {
          throw new Error(`Failed to read client certificate file: ${process.env.PG_SSL_CERT_FILE}`);
        }
      }
      
      // Client Private Key (for mutual TLS)
      if (process.env.PG_SSL_KEY_FILE) {
        try {
          const fs = require('fs');
          sslConfig.key = fs.readFileSync(process.env.PG_SSL_KEY_FILE, 'utf8');
        } catch (error) {
          throw new Error(`Failed to read client key file: ${process.env.PG_SSL_KEY_FILE}`);
        }
      }
      
      return sslConfig;
    }
    if (sslEnv === 'false') return false;
    
    try {
      return JSON.parse(sslEnv);
    } catch {
      return undefined;
    }
  }

  // ============================================================================
  // Configuration Validation
  // ============================================================================

  private validateConfiguration(config: DatabaseConfig): void {
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
        this.validateSQLiteConfig(config);
        break;
      case 'postgresql':
        this.validatePostgreSQLConfig(config);
        break;
    }
  }

  private validateSQLiteConfig(config: DatabaseConfig): void {
    if (!config.sqlite?.filePath) {
      throw new Error('SQLite file path is required');
    }

    // Validate pragmas if provided
    if (config.sqlite.pragmas) {
      const validPragmas = [
        'cache_size', 'temp_store', 'synchronous', 'mmap_size',
        'page_size', 'auto_vacuum', 'foreign_keys'
      ];
      
      for (const pragma of Object.keys(config.sqlite.pragmas)) {
        if (!validPragmas.includes(pragma)) {
          this.logger.warn(`Unknown SQLite pragma: ${pragma}`);
        }
      }
    }
  }

  private validatePostgreSQLConfig(config: DatabaseConfig): void {
    const pg = config.postgresql;
    if (!pg) {
      throw new Error('PostgreSQL configuration is required');
    }

    if (!pg.host || !pg.port || !pg.database || !pg.username || !pg.password) {
      throw new Error('PostgreSQL connection parameters (host, port, database, username, password) are required');
    }

    if (pg.port < 1 || pg.port > 65535) {
      throw new Error('PostgreSQL port must be between 1 and 65535');
    }

    // Validate pool configuration
    if (pg.pool) {
      if (pg.pool.min < 0) {
        throw new Error('Pool minimum connections must be >= 0');
      }
      if (pg.pool.max <= 0) {
        throw new Error('Pool maximum connections must be > 0');
      }
      if (pg.pool.min > pg.pool.max) {
        throw new Error('Pool minimum connections cannot exceed maximum');
      }
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Create a sample configuration file
   */
  static createSampleConfigFile(): ConfigFile {
    return {
      default: 'development',
      configurations: {
        development: {
          type: 'sqlite',
          vectorDimensions: 384,
          enableLogging: true,
          sqlite: {
            filePath: './data/rag-memory-dev.db',
            enableWAL: true,
            pragmas: {
              'cache_size': -64000,
              'temp_store': 'memory',
              'synchronous': 'normal'
            }
          }
        } as DatabaseConfig,
        production: {
          type: 'postgresql',
          vectorDimensions: 384,
          enableLogging: false,
          queryTimeout: 30000,
          postgresql: {
            host: 'localhost',
            port: 5432,
            database: 'rag_memory',
            username: 'rag_user',
            password: 'secure_password',
            ssl: false,
            pool: {
              min: 2,
              max: 20,
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 5000
            }
          }
        } as DatabaseConfig,
        test: {
          type: 'sqlite',
          vectorDimensions: 384,
          enableLogging: false,
          sqlite: {
            filePath: ':memory:',
            enableWAL: false
          }
        } as DatabaseConfig
      }
    };
  }

  /**
   * Get configuration summary for logging
   */
  getConfigurationSummary(config: DatabaseConfig): object {
    const summary: any = {
      type: config.type,
      vectorDimensions: config.vectorDimensions,
      enableLogging: config.enableLogging,
      queryTimeout: config.queryTimeout
    };

    switch (config.type) {
      case 'sqlite':
        summary.sqlite = {
          filePath: config.sqlite?.filePath,
          enableWAL: config.sqlite?.enableWAL,
          pragmaCount: Object.keys(config.sqlite?.pragmas || {}).length
        };
        break;
      case 'postgresql':
        summary.postgresql = {
          host: config.postgresql?.host,
          port: config.postgresql?.port,
          database: config.postgresql?.database,
          username: config.postgresql?.username,
          ssl: !!config.postgresql?.ssl,
          poolMin: config.postgresql?.pool?.min,
          poolMax: config.postgresql?.pool?.max
        };
        break;
    }

    return summary;
  }
}
