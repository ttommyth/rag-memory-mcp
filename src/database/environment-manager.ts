/**
 * Environment Manager
 * 
 * Enhanced environment management with dotenv support, environment-specific
 * configuration loading, and secure credential handling.
 */

import { config as dotenvConfig } from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { DatabaseConfig, DatabaseLogger } from './interfaces.js';
import { ConfigManager } from './config-manager.js';
import { DatabaseLogger as Logger } from './logger.js';

/**
 * Environment Types
 */
export type Environment = 'development' | 'production' | 'test' | 'staging';

/**
 * Environment Configuration Options
 */
export interface EnvironmentOptions {
  environment?: Environment;
  envFilePath?: string;
  envFileEncoding?: BufferEncoding;
  override?: boolean;
  debug?: boolean;
}

/**
 * Environment Manager Class
 */
export class EnvironmentManager {
  private logger: DatabaseLogger;
  private configManager: ConfigManager;
  private loadedEnvironment: Environment | null = null;
  private envFilesLoaded: string[] = [];

  constructor(logger?: DatabaseLogger) {
    this.logger = logger || new Logger();
    this.configManager = new ConfigManager(this.logger);
  }

  // ============================================================================
  // Environment Detection and Loading
  // ============================================================================

  /**
   * Detect current environment from NODE_ENV or default to development
   */
  detectEnvironment(): Environment {
    const nodeEnv = process.env.NODE_ENV?.toLowerCase();
    
    switch (nodeEnv) {
      case 'production':
      case 'prod':
        return 'production';
      case 'test':
      case 'testing':
        return 'test';
      case 'staging':
      case 'stage':
        return 'staging';
      case 'development':
      case 'dev':
      default:
        return 'development';
    }
  }

  /**
   * Load environment configuration with automatic environment detection
   */
  async loadEnvironment(options: EnvironmentOptions = {}): Promise<DatabaseConfig> {
    const environment = options.environment || this.detectEnvironment();
    this.logger.info('Loading environment configuration', { environment });

    try {
      // Load base .env file if it exists
      await this.loadEnvFile('.env', { 
        override: false, 
        optional: true,
        debug: options.debug 
      });

      // Load environment-specific .env file
      const envFileName = `.env.${environment}`;
      await this.loadEnvFile(envFileName, { 
        override: true, 
        optional: true,
        debug: options.debug 
      });

      // Load custom env file if specified
      if (options.envFilePath) {
        await this.loadEnvFile(options.envFilePath, { 
          override: options.override ?? true,
          debug: options.debug 
        });
      }

      // Load configuration from environment variables
      const config = this.configManager.loadFromEnvironment();
      this.loadedEnvironment = environment;

      this.logger.info('Environment configuration loaded successfully', {
        environment,
        configType: config.type,
        envFilesLoaded: this.envFilesLoaded
      });

      return config;
    } catch (error) {
      this.logger.error('Failed to load environment configuration', error as Error, {
        environment,
        envFilesLoaded: this.envFilesLoaded
      });
      throw error;
    }
  }

  /**
   * Load specific .env file
   */
  private async loadEnvFile(
    filePath: string, 
    options: { override?: boolean; optional?: boolean; debug?: boolean } = {}
  ): Promise<void> {
    const fullPath = path.resolve(filePath);
    
    try {
      // Check if file exists
      await fs.access(fullPath);
      
      // Load the .env file
      const result = dotenvConfig({
        path: fullPath,
        override: options.override ?? false,
        debug: options.debug ?? false
      });

      if (result.error) {
        throw result.error;
      }

      this.envFilesLoaded.push(fullPath);
      this.logger.debug('Loaded environment file', { filePath: fullPath });

    } catch (error) {
      if (!options.optional) {
        this.logger.error('Failed to load required environment file', error as Error, {
          filePath: fullPath
        });
        throw error;
      } else {
        this.logger.debug('Optional environment file not found', { filePath: fullPath });
      }
    }
  }

  // ============================================================================
  // Environment-Specific Configuration
  // ============================================================================

  /**
   * Get configuration for specific environment
   */
  async getEnvironmentConfig(environment: Environment): Promise<DatabaseConfig> {
    const currentEnv = process.env.NODE_ENV;
    
    try {
      // Temporarily set NODE_ENV
      process.env.NODE_ENV = environment;
      
      // Load environment configuration
      const config = await this.loadEnvironment({ environment });
      
      return config;
    } finally {
      // Restore original NODE_ENV
      if (currentEnv !== undefined) {
        process.env.NODE_ENV = currentEnv;
      } else {
        delete process.env.NODE_ENV;
      }
    }
  }

  /**
   * Create environment-specific configuration files
   */
  async createEnvironmentFiles(baseDir: string = '.'): Promise<void> {
    this.logger.info('Creating environment configuration files', { baseDir });

    const environments: Environment[] = ['development', 'production', 'test', 'staging'];
    
    for (const env of environments) {
      const filePath = path.join(baseDir, `.env.${env}`);
      const config = this.getEnvironmentTemplate(env);
      
      try {
        // Check if file already exists
        await fs.access(filePath);
        this.logger.warn('Environment file already exists, skipping', { filePath });
      } catch {
        // File doesn't exist, create it
        await fs.writeFile(filePath, config, 'utf-8');
        this.logger.info('Created environment file', { filePath });
      }
    }

    // Create .env.example if it doesn't exist
    const examplePath = path.join(baseDir, '.env.example');
    try {
      await fs.access(examplePath);
      this.logger.warn('Example environment file already exists, skipping', { filePath: examplePath });
    } catch {
      const exampleConfig = this.getEnvironmentTemplate('development', true);
      await fs.writeFile(examplePath, exampleConfig, 'utf-8');
      this.logger.info('Created example environment file', { filePath: examplePath });
    }
  }

  /**
   * Get environment configuration template
   */
  private getEnvironmentTemplate(environment: Environment, isExample: boolean = false): string {
    const prefix = isExample ? '# ' : '';
    const passwordValue = isExample ? 'your_secure_password_here' : '';

    switch (environment) {
      case 'development':
        return `${prefix}Development Environment Configuration
NODE_ENV=development

${prefix}Database Configuration
DB_TYPE=sqlite
SQLITE_FILE_PATH=./data/rag-memory-dev.db
SQLITE_ENABLE_WAL=true
VECTOR_DIMENSIONS=384

${prefix}Logging
ENABLE_DB_LOGGING=true
LOG_LEVEL=debug
DEBUG_ENABLED=true

${prefix}Development Features
DEV_MODE=true
ENABLE_PERFORMANCE_MONITORING=true
LOG_SENSITIVE_DATA=false

${prefix}Query Settings
QUERY_TIMEOUT=30000
`;

      case 'production':
        return `${prefix}Production Environment Configuration
NODE_ENV=production

${prefix}Database Configuration - PostgreSQL for Production
DB_TYPE=postgresql
VECTOR_DIMENSIONS=384

${prefix}PostgreSQL Configuration
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=rag_memory
PG_USERNAME=rag_user
PG_PASSWORD=${passwordValue}

${prefix}SSL Configuration for Production
PG_SSL=true

${prefix}Connection Pool - Production Optimized
PG_POOL_MIN=5
PG_POOL_MAX=50
PG_POOL_IDLE_TIMEOUT=30000
PG_POOL_CONNECTION_TIMEOUT=5000

${prefix}Logging - Minimal for Production
ENABLE_DB_LOGGING=false
LOG_LEVEL=warn
DEBUG_ENABLED=false
LOG_SENSITIVE_DATA=false

${prefix}Performance
QUERY_TIMEOUT=15000
ENABLE_PERFORMANCE_MONITORING=true

${prefix}Security
DEV_MODE=false
`;

      case 'test':
        return `${prefix}Test Environment Configuration
NODE_ENV=test

${prefix}Database Configuration - In-Memory SQLite for Testing
DB_TYPE=sqlite
SQLITE_FILE_PATH=:memory:
SQLITE_ENABLE_WAL=false
VECTOR_DIMENSIONS=384

${prefix}Logging - Minimal for Tests
ENABLE_DB_LOGGING=false
LOG_LEVEL=error
DEBUG_ENABLED=false
LOG_SENSITIVE_DATA=false

${prefix}Performance - Fast for Tests
QUERY_TIMEOUT=5000
ENABLE_PERFORMANCE_MONITORING=false

${prefix}Test Features
DEV_MODE=false
`;

      case 'staging':
        return `${prefix}Staging Environment Configuration
NODE_ENV=staging

${prefix}Database Configuration - PostgreSQL for Staging
DB_TYPE=postgresql
VECTOR_DIMENSIONS=384

${prefix}PostgreSQL Configuration
PG_HOST=staging-db-host
PG_PORT=5432
PG_DATABASE=rag_memory_staging
PG_USERNAME=rag_user
PG_PASSWORD=${passwordValue}

${prefix}SSL Configuration
PG_SSL=true

${prefix}Connection Pool - Staging Optimized
PG_POOL_MIN=3
PG_POOL_MAX=30
PG_POOL_IDLE_TIMEOUT=30000
PG_POOL_CONNECTION_TIMEOUT=5000

${prefix}Logging - Moderate for Staging
ENABLE_DB_LOGGING=true
LOG_LEVEL=info
DEBUG_ENABLED=false
LOG_SENSITIVE_DATA=false

${prefix}Performance
QUERY_TIMEOUT=20000
ENABLE_PERFORMANCE_MONITORING=true

${prefix}Security
DEV_MODE=false
`;

      default:
        throw new Error(`Unknown environment: ${environment}`);
    }
  }

  // ============================================================================
  // Environment Validation and Security
  // ============================================================================

  /**
   * Validate environment configuration
   */
  validateEnvironment(): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required environment variables
    const requiredVars = ['DB_TYPE'];
    for (const varName of requiredVars) {
      if (!process.env[varName]) {
        errors.push(`Missing required environment variable: ${varName}`);
      }
    }

    // Database-specific validation
    const dbType = process.env.DB_TYPE?.toLowerCase();
    if (dbType === 'postgresql') {
      const pgRequiredVars = ['PG_HOST', 'PG_PORT', 'PG_DATABASE', 'PG_USERNAME', 'PG_PASSWORD'];
      for (const varName of pgRequiredVars) {
        if (!process.env[varName]) {
          errors.push(`Missing required PostgreSQL environment variable: ${varName}`);
        }
      }
    } else if (dbType === 'sqlite') {
      if (!process.env.SQLITE_FILE_PATH) {
        errors.push('Missing required SQLite environment variable: SQLITE_FILE_PATH');
      }
    }

    // Security warnings
    if (process.env.NODE_ENV === 'production') {
      if (process.env.DEBUG_ENABLED === 'true') {
        warnings.push('Debug mode is enabled in production environment');
      }
      if (process.env.LOG_SENSITIVE_DATA === 'true') {
        warnings.push('Sensitive data logging is enabled in production environment');
      }
      if (process.env.DEV_MODE === 'true') {
        warnings.push('Development mode is enabled in production environment');
      }
    }

    // Performance warnings
    const queryTimeout = parseInt(process.env.QUERY_TIMEOUT || '30000');
    if (queryTimeout > 60000) {
      warnings.push('Query timeout is set to more than 60 seconds');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get environment summary for logging
   */
  getEnvironmentSummary(): object {
    return {
      environment: this.loadedEnvironment,
      nodeEnv: process.env.NODE_ENV,
      dbType: process.env.DB_TYPE,
      envFilesLoaded: this.envFilesLoaded,
      configurationValid: this.validateEnvironment().isValid
    };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get current loaded environment
   */
  getCurrentEnvironment(): Environment | null {
    return this.loadedEnvironment;
  }

  /**
   * Get list of loaded environment files
   */
  getLoadedEnvFiles(): string[] {
    return [...this.envFilesLoaded];
  }

  /**
   * Reset environment state (useful for testing)
   */
  reset(): void {
    this.loadedEnvironment = null;
    this.envFilesLoaded = [];
  }

  /**
   * Check if running in Docker environment
   */
  isDockerEnvironment(): boolean {
    return !!(
      process.env.DOCKER_CONTAINER ||
      process.env.KUBERNETES_SERVICE_HOST ||
      process.env.DOCKER_PG_SERVICE
    );
  }

  /**
   * Get Docker-specific configuration adjustments
   */
  getDockerConfiguration(): Partial<DatabaseConfig> {
    if (!this.isDockerEnvironment()) {
      return {};
    }

    const config: any = {};

    // Adjust PostgreSQL host for Docker
    if (process.env.DB_TYPE === 'postgresql' && process.env.DOCKER_PG_SERVICE) {
      config.postgresql = {
        host: process.env.DOCKER_PG_SERVICE,
        port: parseInt(process.env.PG_PORT || '5432')
      };
    }

    return config;
  }
}
