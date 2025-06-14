/**
 * Configuration Factory
 * 
 * Unified factory for creating and managing database configurations across
 * different environments and sources. Integrates ConfigManager and EnvironmentManager.
 */

import { DatabaseConfig, DatabaseLogger } from './interfaces.js';
import { ConfigManager } from './config-manager.js';
import { EnvironmentManager, Environment } from './environment-manager.js';
import { DatabaseLogger as Logger } from './logger.js';

/**
 * Configuration Source Types
 */
export type ConfigurationSource = 
  | 'environment'
  | 'file'
  | 'object'
  | 'auto';

/**
 * Configuration Factory Options
 */
export interface ConfigurationFactoryOptions {
  logger?: DatabaseLogger;
  environment?: Environment;
  configFilePath?: string;
  envFilePath?: string;
  source?: ConfigurationSource;
  validateOnLoad?: boolean;
  enableDockerSupport?: boolean;
}

/**
 * Configuration Factory Result
 */
export interface ConfigurationResult {
  config: DatabaseConfig;
  source: ConfigurationSource;
  environment: Environment;
  metadata: {
    loadedFiles: string[];
    validationResult: {
      isValid: boolean;
      errors: string[];
      warnings: string[];
    };
    dockerEnvironment: boolean;
    configSummary: object;
  };
}

/**
 * Configuration Factory Class
 */
export class ConfigurationFactory {
  private static instance: ConfigurationFactory | null = null;
  private logger: DatabaseLogger;
  private configManager: ConfigManager;
  private environmentManager: EnvironmentManager;

  private constructor(logger?: DatabaseLogger) {
    this.logger = logger || new Logger();
    this.configManager = new ConfigManager(this.logger);
    this.environmentManager = new EnvironmentManager(this.logger);
  }

  /**
   * Get singleton instance
   */
  static getInstance(logger?: DatabaseLogger): ConfigurationFactory {
    if (!ConfigurationFactory.instance) {
      ConfigurationFactory.instance = new ConfigurationFactory(logger);
    }
    return ConfigurationFactory.instance;
  }

  // ============================================================================
  // Configuration Creation
  // ============================================================================

  /**
   * Create configuration with automatic source detection
   */
  async createConfiguration(options: ConfigurationFactoryOptions = {}): Promise<ConfigurationResult> {
    this.logger.info('Creating database configuration', options);

    const source = options.source || 'auto';
    const environment = options.environment || this.environmentManager.detectEnvironment();

    try {
      let config: DatabaseConfig;
      let actualSource: ConfigurationSource;
      let loadedFiles: string[] = [];

      switch (source) {
        case 'environment':
          config = await this.createFromEnvironment(options);
          actualSource = 'environment';
          loadedFiles = this.environmentManager.getLoadedEnvFiles();
          break;

        case 'file':
          if (!options.configFilePath) {
            throw new Error('Configuration file path is required when source is "file"');
          }
          config = await this.createFromFile(options.configFilePath, options);
          actualSource = 'file';
          break;

        case 'object':
          throw new Error('Object source requires explicit configuration object');

        case 'auto':
        default:
          const result = await this.createFromAuto(options);
          config = result.config;
          actualSource = result.source;
          loadedFiles = result.loadedFiles;
          break;
      }

      // Apply Docker-specific adjustments if enabled
      if (options.enableDockerSupport !== false && this.environmentManager.isDockerEnvironment()) {
        const dockerConfig = this.environmentManager.getDockerConfiguration();
        config = this.mergeConfigurations(config, dockerConfig);
      }

      // Validate configuration if requested
      let validationResult: { isValid: boolean; errors: string[]; warnings: string[] } = { isValid: true, errors: [], warnings: [] };
      if (options.validateOnLoad !== false) {
        validationResult = this.environmentManager.validateEnvironment();
      }

      const result: ConfigurationResult = {
        config,
        source: actualSource,
        environment,
        metadata: {
          loadedFiles,
          validationResult,
          dockerEnvironment: this.environmentManager.isDockerEnvironment(),
          configSummary: this.configManager.getConfigurationSummary(config)
        }
      };

      this.logger.info('Configuration created successfully', {
        source: actualSource,
        environment,
        type: config.type,
        isValid: validationResult.isValid,
        dockerEnvironment: result.metadata.dockerEnvironment
      });

      return result;

    } catch (error) {
      this.logger.error('Failed to create configuration', error as Error, options);
      throw error;
    }
  }

  /**
   * Create configuration from environment variables
   */
  private async createFromEnvironment(options: ConfigurationFactoryOptions): Promise<DatabaseConfig> {
    return await this.environmentManager.loadEnvironment({
      environment: options.environment,
      envFilePath: options.envFilePath
    });
  }

  /**
   * Create configuration from file
   */
  private async createFromFile(filePath: string, options: ConfigurationFactoryOptions): Promise<DatabaseConfig> {
    const configName = options.environment;
    return await this.configManager.loadFromFile(filePath, configName);
  }

  /**
   * Create configuration with automatic source detection
   */
  private async createFromAuto(options: ConfigurationFactoryOptions): Promise<{
    config: DatabaseConfig;
    source: ConfigurationSource;
    loadedFiles: string[];
  }> {
    // Try environment first (most common)
    try {
      const config = await this.createFromEnvironment(options);
      return {
        config,
        source: 'environment',
        loadedFiles: this.environmentManager.getLoadedEnvFiles()
      };
    } catch (envError) {
      this.logger.debug('Environment configuration failed, trying file', { error: envError });
    }

    // Try configuration file
    if (options.configFilePath) {
      try {
        const config = await this.createFromFile(options.configFilePath, options);
        return {
          config,
          source: 'file',
          loadedFiles: [options.configFilePath]
        };
      } catch (fileError) {
        this.logger.debug('File configuration failed', { error: fileError });
      }
    }

    // If all else fails, throw the original environment error
    throw new Error('Unable to create configuration from any source. Ensure environment variables or configuration file is properly set.');
  }

  // ============================================================================
  // Configuration Management
  // ============================================================================

  /**
   * Create configuration for specific environment
   */
  async createForEnvironment(environment: Environment, options: Omit<ConfigurationFactoryOptions, 'environment'> = {}): Promise<ConfigurationResult> {
    return await this.createConfiguration({
      ...options,
      environment
    });
  }

  /**
   * Create multiple configurations for different environments
   */
  async createMultiEnvironmentConfigurations(
    environments: Environment[],
    options: Omit<ConfigurationFactoryOptions, 'environment'> = {}
  ): Promise<Record<Environment, ConfigurationResult>> {
    const results: Record<string, ConfigurationResult> = {};

    for (const environment of environments) {
      try {
        results[environment] = await this.createForEnvironment(environment, options);
      } catch (error) {
        this.logger.error(`Failed to create configuration for environment: ${environment}`, error as Error);
        throw error;
      }
    }

    return results as Record<Environment, ConfigurationResult>;
  }

  /**
   * Merge two configurations (second overrides first)
   */
  private mergeConfigurations(base: DatabaseConfig, override: Partial<DatabaseConfig>): DatabaseConfig {
    const merged = { ...base };

    // Merge top-level properties
    Object.assign(merged, override);

    // Deep merge database-specific configurations
    if (override.sqlite && merged.sqlite) {
      merged.sqlite = { ...merged.sqlite, ...override.sqlite };
    }

    if (override.postgresql && merged.postgresql) {
      merged.postgresql = { ...merged.postgresql, ...override.postgresql };
      
      // Deep merge pool configuration
      if (override.postgresql.pool && merged.postgresql.pool) {
        merged.postgresql.pool = { ...merged.postgresql.pool, ...override.postgresql.pool };
      }
    }

    return merged;
  }

  // ============================================================================
  // Environment Setup and Management
  // ============================================================================

  /**
   * Initialize environment files for a project
   */
  async initializeEnvironmentFiles(baseDir: string = '.'): Promise<void> {
    this.logger.info('Initializing environment files', { baseDir });
    await this.environmentManager.createEnvironmentFiles(baseDir);
  }

  /**
   * Validate current environment setup
   */
  validateCurrentEnvironment(): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    summary: object;
  } {
    const validation = this.environmentManager.validateEnvironment();
    const summary = this.environmentManager.getEnvironmentSummary();

    return {
      ...validation,
      summary
    };
  }

  /**
   * Get configuration recommendations based on environment
   */
  getConfigurationRecommendations(environment: Environment): {
    recommendations: string[];
    warnings: string[];
    optimizations: string[];
  } {
    const recommendations: string[] = [];
    const warnings: string[] = [];
    const optimizations: string[] = [];

    switch (environment) {
      case 'development':
        recommendations.push('Use SQLite for local development');
        recommendations.push('Enable debug logging');
        recommendations.push('Use WAL mode for SQLite');
        optimizations.push('Set cache_size to -32MB for development');
        break;

      case 'production':
        recommendations.push('Use PostgreSQL for production');
        recommendations.push('Enable SSL connections');
        recommendations.push('Configure connection pooling (min: 5, max: 50)');
        recommendations.push('Disable debug logging');
        warnings.push('Ensure sensitive data logging is disabled');
        warnings.push('Use secure password management');
        optimizations.push('Configure pgvector with HNSW indexes');
        optimizations.push('Set query timeout to 15 seconds');
        break;

      case 'test':
        recommendations.push('Use in-memory SQLite for tests');
        recommendations.push('Disable logging for faster tests');
        recommendations.push('Set short query timeouts');
        optimizations.push('Disable WAL mode for tests');
        optimizations.push('Use synchronous=OFF for speed');
        break;

      case 'staging':
        recommendations.push('Use PostgreSQL similar to production');
        recommendations.push('Enable moderate logging');
        recommendations.push('Use smaller connection pool than production');
        warnings.push('Ensure staging data is not production data');
        break;
    }

    return { recommendations, warnings, optimizations };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Reset factory state (useful for testing)
   */
  reset(): void {
    this.environmentManager.reset();
    ConfigurationFactory.instance = null;
  }

  /**
   * Get factory instance information
   */
  getFactoryInfo(): {
    environment: Environment | null;
    dockerEnvironment: boolean;
    loadedFiles: string[];
  } {
    return {
      environment: this.environmentManager.getCurrentEnvironment(),
      dockerEnvironment: this.environmentManager.isDockerEnvironment(),
      loadedFiles: this.environmentManager.getLoadedEnvFiles()
    };
  }
}
