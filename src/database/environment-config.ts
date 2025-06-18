/**
 * Environment Configuration Manager
 * 
 * Comprehensive environment-based configuration system for multi-database support.
 * Provides centralized management of environment variables with validation and defaults.
 */

import { DatabaseConfig } from './interfaces.js';

/**
 * Environment Configuration Interface
 */
export interface EnvironmentConfig {
  // Core database selection
  dbType: 'sqlite' | 'postgresql';
  
  // Common configuration
  vectorDimensions: number;
  enableLogging: boolean;
  queryTimeout: number;
  
  // SQLite specific
  sqlite?: {
    filePath: string;
    enableWAL: boolean;
    cacheSize: number;
    tempStore: string;
    synchronous: string;
    mmapSize: number;
  };
  
  // PostgreSQL specific
  postgresql?: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl: boolean | { rejectUnauthorized: boolean } | undefined;
    poolMin: number;
    poolMax: number;
    poolIdleTimeout: number;
    poolConnectionTimeout: number;
  };
}

/**
 * Environment Configuration Manager
 */
export class EnvironmentConfigManager {
  
  /**
   * Get complete environment configuration
   */
  static getEnvironmentConfig(): EnvironmentConfig {
    const dbType = this.getDatabaseType();
    
    const config: EnvironmentConfig = {
      dbType,
      vectorDimensions: this.getVectorDimensions(),
      enableLogging: this.getLoggingEnabled(),
      queryTimeout: this.getQueryTimeout()
    };
    
    if (dbType === 'sqlite') {
      config.sqlite = this.getSQLiteConfig();
    } else if (dbType === 'postgresql') {
      config.postgresql = this.getPostgreSQLConfig();
    }
    
    return config;
  }
  
  /**
   * Get database type from environment
   */
  static getDatabaseType(): 'sqlite' | 'postgresql' {
    const dbType = process.env.DB_TYPE?.toLowerCase();
    
    if (!dbType) {
      // Default to SQLite for local development
      return 'sqlite';
    }
    
    if (dbType !== 'sqlite' && dbType !== 'postgresql') {
      throw new Error(`Invalid DB_TYPE: ${dbType}. Must be 'sqlite' or 'postgresql'`);
    }
    
    return dbType as 'sqlite' | 'postgresql';
  }
  
  /**
   * Get vector dimensions configuration
   */
  static getVectorDimensions(): number {
    const dimensions = parseInt(process.env.VECTOR_DIMENSIONS || '384');
    
    if (isNaN(dimensions) || dimensions <= 0) {
      throw new Error('VECTOR_DIMENSIONS must be a positive number');
    }
    
    return dimensions;
  }
  
  /**
   * Get logging configuration
   */
  static getLoggingEnabled(): boolean {
    return process.env.ENABLE_DB_LOGGING === 'true';
  }
  
  /**
   * Get query timeout configuration
   */
  static getQueryTimeout(): number {
    const timeout = parseInt(process.env.QUERY_TIMEOUT || '30000');
    
    if (isNaN(timeout) || timeout <= 0) {
      throw new Error('QUERY_TIMEOUT must be a positive number');
    }
    
    return timeout;
  }
  
  /**
   * Get SQLite configuration from environment
   */
  static getSQLiteConfig() {
    const filePath = process.env.SQLITE_FILE_PATH || 'memory.db';
    
    return {
      filePath,
      enableWAL: process.env.SQLITE_ENABLE_WAL !== 'false',
      cacheSize: parseInt(process.env.SQLITE_CACHE_SIZE || '-64000'),
      tempStore: process.env.SQLITE_TEMP_STORE || 'memory',
      synchronous: process.env.SQLITE_SYNCHRONOUS || 'normal',
      mmapSize: parseInt(process.env.SQLITE_MMAP_SIZE || '268435456')
    };
  }
  
  /**
   * Get PostgreSQL configuration from environment
   */
  static getPostgreSQLConfig() {
    const requiredVars = ['PG_HOST', 'PG_PORT', 'PG_DATABASE', 'PG_USERNAME', 'PG_PASSWORD'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required PostgreSQL environment variables: ${missingVars.join(', ')}`);
    }
    
    return {
      host: process.env.PG_HOST!,
      port: parseInt(process.env.PG_PORT!),
      database: process.env.PG_DATABASE!,
      username: process.env.PG_USERNAME!,
      password: process.env.PG_PASSWORD!,
      ssl: this.buildSSLConfig(),
      poolMin: parseInt(process.env.PG_POOL_MIN || '2'),
      poolMax: parseInt(process.env.PG_POOL_MAX || '20'),
      poolIdleTimeout: parseInt(process.env.PG_POOL_IDLE_TIMEOUT || '300000'), // 5 minutes for better stability
      poolConnectionTimeout: parseInt(process.env.PG_POOL_CONNECTION_TIMEOUT || '15000') // 15 seconds for slower connections
    };
  }
  
  /**
   * Build SSL configuration with support for certificate files
   */
  private static buildSSLConfig(): any {
    const sslEnv = process.env.PG_SSL;
    
    if (sslEnv === 'false') return false;
    if (sslEnv !== 'true') return undefined;
    
    // Start with basic SSL configuration
    const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false';
    const sslConfig: any = { rejectUnauthorized };
    
    // Support for certificate files
    try {
      // CA Certificate (Certificate Authority)
      if (process.env.PG_SSL_CA_FILE) {
        const fs = require('fs');
        sslConfig.ca = fs.readFileSync(process.env.PG_SSL_CA_FILE, 'utf8');
      }
      
      // Client Certificate (for mutual TLS)
      if (process.env.PG_SSL_CERT_FILE) {
        const fs = require('fs');
        sslConfig.cert = fs.readFileSync(process.env.PG_SSL_CERT_FILE, 'utf8');
      }
      
      // Client Private Key (for mutual TLS)
      if (process.env.PG_SSL_KEY_FILE) {
        const fs = require('fs');
        sslConfig.key = fs.readFileSync(process.env.PG_SSL_KEY_FILE, 'utf8');
      }
    } catch (error) {
      throw new Error(`Failed to read SSL certificate file: ${(error as Error).message}`);
    }
    
    return sslConfig;
  }
  
  /**
   * Convert environment configuration to database configuration
   */
  static toDatabaseConfig(envConfig: EnvironmentConfig): DatabaseConfig {
    const baseConfig = {
      type: envConfig.dbType,
      vectorDimensions: envConfig.vectorDimensions,
      enableLogging: envConfig.enableLogging,
      queryTimeout: envConfig.queryTimeout
    };
    
    if (envConfig.dbType === 'sqlite' && envConfig.sqlite) {
      return {
        ...baseConfig,
        type: 'sqlite',
        sqlite: {
          filePath: envConfig.sqlite.filePath,
          enableWAL: envConfig.sqlite.enableWAL,
          pragmas: {
            'cache_size': envConfig.sqlite.cacheSize,
            'temp_store': envConfig.sqlite.tempStore,
            'synchronous': envConfig.sqlite.synchronous,
            'mmap_size': envConfig.sqlite.mmapSize
          }
        }
      } as DatabaseConfig;
    }
    
    if (envConfig.dbType === 'postgresql' && envConfig.postgresql) {
      return {
        ...baseConfig,
        type: 'postgresql',
        postgresql: {
          host: envConfig.postgresql.host,
          port: envConfig.postgresql.port,
          database: envConfig.postgresql.database,
          username: envConfig.postgresql.username,
          password: envConfig.postgresql.password,
          ssl: envConfig.postgresql.ssl,
          pool: {
            min: envConfig.postgresql.poolMin,
            max: envConfig.postgresql.poolMax,
            idleTimeoutMillis: envConfig.postgresql.poolIdleTimeout,
            connectionTimeoutMillis: envConfig.postgresql.poolConnectionTimeout
          }
        }
      } as DatabaseConfig;
    }
    
    throw new Error(`Invalid database configuration for type: ${envConfig.dbType}`);
  }
  
  /**
   * Validate environment configuration
   */
  static validateEnvironmentConfig(config: EnvironmentConfig): void {
    // Validate common configuration
    if (config.vectorDimensions <= 0) {
      throw new Error('Vector dimensions must be positive');
    }
    
    if (config.queryTimeout <= 0) {
      throw new Error('Query timeout must be positive');
    }
    
    // Validate database-specific configuration
    if (config.dbType === 'sqlite') {
      if (!config.sqlite) {
        throw new Error('SQLite configuration is required when DB_TYPE is sqlite');
      }
      
      if (!config.sqlite.filePath) {
        throw new Error('SQLite file path is required');
      }
    }
    
    if (config.dbType === 'postgresql') {
      if (!config.postgresql) {
        throw new Error('PostgreSQL configuration is required when DB_TYPE is postgresql');
      }
      
      const pg = config.postgresql;
      if (!pg.host || !pg.database || !pg.username || !pg.password) {
        throw new Error('PostgreSQL host, database, username, and password are required');
      }
      
      if (pg.port <= 0 || pg.port > 65535) {
        throw new Error('PostgreSQL port must be between 1 and 65535');
      }
      
      if (pg.poolMin < 0 || pg.poolMax <= 0 || pg.poolMin > pg.poolMax) {
        throw new Error('Invalid PostgreSQL pool configuration');
      }
    }
  }
  
  /**
   * Get environment configuration with validation
   */
  static getValidatedEnvironmentConfig(): EnvironmentConfig {
    const config = this.getEnvironmentConfig();
    this.validateEnvironmentConfig(config);
    return config;
  }
  
  /**
   * Print environment configuration summary
   */
  static printConfigurationSummary(): void {
    try {
      const config = this.getValidatedEnvironmentConfig();
      
      console.log('🔧 Database Configuration Summary:');
      console.log(`   Database Type: ${config.dbType.toUpperCase()}`);
      console.log(`   Vector Dimensions: ${config.vectorDimensions}`);
      console.log(`   Logging Enabled: ${config.enableLogging}`);
      console.log(`   Query Timeout: ${config.queryTimeout}ms`);
      
      if (config.dbType === 'sqlite' && config.sqlite) {
        console.log('   SQLite Configuration:');
        console.log(`     File Path: ${config.sqlite.filePath}`);
        console.log(`     WAL Enabled: ${config.sqlite.enableWAL}`);
        console.log(`     Cache Size: ${config.sqlite.cacheSize}`);
      }
      
      if (config.dbType === 'postgresql' && config.postgresql) {
        console.log('   PostgreSQL Configuration:');
        console.log(`     Host: ${config.postgresql.host}:${config.postgresql.port}`);
        console.log(`     Database: ${config.postgresql.database}`);
        console.log(`     Username: ${config.postgresql.username}`);
        console.log(`     SSL: ${config.postgresql.ssl ?? 'auto'}`);
        console.log(`     Pool: ${config.postgresql.poolMin}-${config.postgresql.poolMax} connections`);
      }
      
    } catch (error) {
      console.error('❌ Configuration Error:', (error as Error).message);
    }
  }
}

/**
 * Environment variable documentation
 */
export const ENVIRONMENT_VARIABLES = {
  // Core database selection
  DB_TYPE: 'Database type: "sqlite" or "postgresql" (default: sqlite)',
  
  // Common configuration
  VECTOR_DIMENSIONS: 'Vector dimensions for embeddings (default: 384)',
  ENABLE_DB_LOGGING: 'Enable database logging: "true" or "false" (default: false)',
  QUERY_TIMEOUT: 'Query timeout in milliseconds (default: 30000)',
  
  // SQLite configuration
  SQLITE_FILE_PATH: 'SQLite database file path (default: memory.db)',
  SQLITE_ENABLE_WAL: 'Enable WAL mode: "true" or "false" (default: true)',
  SQLITE_CACHE_SIZE: 'SQLite cache size (default: -64000)',
  SQLITE_TEMP_STORE: 'SQLite temp store: "memory" or "file" (default: memory)',
  SQLITE_SYNCHRONOUS: 'SQLite synchronous mode: "off", "normal", "full" (default: normal)',
  SQLITE_MMAP_SIZE: 'SQLite memory map size (default: 268435456)',
  
  // PostgreSQL configuration
  PG_HOST: 'PostgreSQL host (required for PostgreSQL)',
  PG_PORT: 'PostgreSQL port (required for PostgreSQL)',
  PG_DATABASE: 'PostgreSQL database name (required for PostgreSQL)',
  PG_USERNAME: 'PostgreSQL username (required for PostgreSQL)',
  PG_PASSWORD: 'PostgreSQL password (required for PostgreSQL)',
  PG_SSL: 'PostgreSQL SSL: "true", "false", or undefined for auto (optional)',
  PG_SSL_REJECT_UNAUTHORIZED: 'Reject unauthorized SSL certificates: "true" (default, secure), "false" (for self-signed certs)',
  PG_POOL_MIN: 'PostgreSQL minimum pool connections (default: 2)',
  PG_POOL_MAX: 'PostgreSQL maximum pool connections (default: 20)',
  PG_POOL_IDLE_TIMEOUT: 'PostgreSQL pool idle timeout in ms (default: 300000)',
  PG_POOL_CONNECTION_TIMEOUT: 'PostgreSQL pool connection timeout in ms (default: 15000)',
  PG_SSL_CA_FILE: 'Path to CA certificate file for SSL verification (optional)',
  PG_SSL_CERT_FILE: 'Path to client certificate file for mutual TLS (optional)',
  PG_SSL_KEY_FILE: 'Path to client private key file for mutual TLS (optional)'
} as const;
