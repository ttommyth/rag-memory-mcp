/**
 * Connection Pool Manager
 * 
 * Manages database connection pools for PostgreSQL databases.
 * Provides health monitoring, statistics, and lifecycle management.
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { DatabaseConfig, DatabaseHealth, PoolStats, DatabaseLogger } from './interfaces.js';

/**
 * Connection Pool Manager for PostgreSQL databases
 */
export class ConnectionPoolManager {
  private pools: Map<string, Pool> = new Map();
  private configs: Map<string, DatabaseConfig> = new Map();
  private healthChecks: Map<string, DatabaseHealth> = new Map();
  private logger: DatabaseLogger;

  constructor(logger: DatabaseLogger) {
    this.logger = logger;
  }

  /**
   * Create a new connection pool
   */
  async createPool(name: string, config: DatabaseConfig): Promise<Pool> {
    if (config.type !== 'postgresql') {
      throw new Error('Connection pooling only available for PostgreSQL');
    }

    if (!config.postgresql) {
      throw new Error('PostgreSQL configuration is required');
    }

    this.logger.info(`Creating connection pool: ${name}`);

    const poolConfig: PoolConfig = {
      host: config.postgresql.host,
      port: config.postgresql.port,
      database: config.postgresql.database,
      user: config.postgresql.username,
      password: config.postgresql.password,
      ssl: config.postgresql.ssl,
      min: config.postgresql.pool?.min || 2,
      max: config.postgresql.pool?.max || 20,
      // Use configuration timeouts
      idleTimeoutMillis: config.postgresql.pool?.idleTimeoutMillis || 600000,
      connectionTimeoutMillis: config.postgresql.pool?.connectionTimeoutMillis || 15000,
      // Enhanced keep-alive configuration
      allowExitOnIdle: false,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000, // Start keep-alive sooner
      // Additional connection stability settings
      query_timeout: config.queryTimeout || 30000,
      statement_timeout: config.queryTimeout || 30000,
      // Connection validation
      application_name: 'rag-memory-mcp',
    };

    const pool = new Pool(poolConfig);

    // Set up event handlers
    this.setupPoolEventHandlers(pool, name);

    // Test the pool connection
    await this.testPoolConnection(pool, name);

    // Store pool and configuration
    this.pools.set(name, pool);
    this.configs.set(name, config);

    this.logger.info(`Connection pool created successfully: ${name}`);
    return pool;
  }

  /**
   * Get an existing connection pool
   */
  async getPool(name: string): Promise<Pool> {
    const pool = this.pools.get(name);
    if (!pool) {
      throw new Error(`Pool '${name}' not found`);
    }
    return pool;
  }

  /**
   * Get a client from the pool
   */
  async getClient(poolName: string): Promise<PoolClient> {
    const pool = await this.getPool(poolName);
    return pool.connect();
  }

  /**
   * Close a specific connection pool
   */
  async closePool(name: string): Promise<void> {
    const pool = this.pools.get(name);
    if (pool) {
      this.logger.info(`Closing connection pool: ${name}`);
      
      try {
        await pool.end();
        this.pools.delete(name);
        this.configs.delete(name);
        this.healthChecks.delete(name);
        
        this.logger.info(`Connection pool closed successfully: ${name}`);
      } catch (error) {
        this.logger.error(`Error closing connection pool ${name}:`, error as Error);
        throw error;
      }
    }
  }

  /**
   * Close all connection pools
   */
  async closeAllPools(): Promise<void> {
    this.logger.info('Closing all connection pools');
    
    const closePromises = Array.from(this.pools.keys()).map(name => 
      this.closePool(name).catch(error => {
        this.logger.error(`Error closing pool ${name}:`, error as Error);
        return error;
      })
    );
    
    const results = await Promise.allSettled(closePromises);
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason);
    
    if (errors.length > 0) {
      this.logger.error(`Errors occurred while closing pools:`, new Error(`${errors.length} pools failed to close`));
    }
    
    this.logger.info('All connection pools closed');
  }

  /**
   * Get pool statistics
   */
  getPoolStats(name: string): PoolStats {
    const pool = this.pools.get(name);
    if (!pool) {
      throw new Error(`Pool '${name}' not found`);
    }

    return {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
  }

  /**
   * Get all pool statistics
   */
  getAllPoolStats(): Record<string, PoolStats> {
    const stats: Record<string, PoolStats> = {};
    
    for (const [name] of this.pools) {
      try {
        stats[name] = this.getPoolStats(name);
      } catch (error) {
        this.logger.error(`Error getting stats for pool ${name}:`, error as Error);
      }
    }
    
    return stats;
  }

  /**
   * Check health of a specific pool
   */
  async checkPoolHealth(name: string): Promise<DatabaseHealth> {
    const pool = this.pools.get(name);
    if (!pool) {
      throw new Error(`Pool '${name}' not found`);
    }

    const startTime = Date.now();
    const errors: string[] = [];
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    try {
      // Test connection with a simple query
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        const latency = Date.now() - startTime;

        // Check latency thresholds
        if (latency > 1000) {
          errors.push(`High latency: ${latency}ms`);
          status = 'degraded';
        } else if (latency > 5000) {
          errors.push(`Very high latency: ${latency}ms`);
          status = 'unhealthy';
        }

        // Check pool utilization
        const stats = this.getPoolStats(name);
        const utilization = (stats.totalCount - stats.idleCount) / stats.totalCount;
        
        if (utilization > 0.9) {
          errors.push(`High pool utilization: ${Math.round(utilization * 100)}%`);
          status = status === 'healthy' ? 'degraded' : status;
        }

        if (stats.waitingCount > 0) {
          errors.push(`Connections waiting: ${stats.waitingCount}`);
          status = status === 'healthy' ? 'degraded' : status;
        }

        const health: DatabaseHealth = {
          status,
          latency,
          connections: {
            active: stats.totalCount - stats.idleCount,
            idle: stats.idleCount,
            total: stats.totalCount,
          },
          lastCheck: new Date(),
          errors,
        };

        this.healthChecks.set(name, health);
        return health;

      } finally {
        client.release();
      }

    } catch (error) {
      const health: DatabaseHealth = {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        connections: { active: 0, idle: 0, total: 0 },
        lastCheck: new Date(),
        errors: [error instanceof Error ? error.message : 'Unknown connection error'],
      };

      this.healthChecks.set(name, health);
      this.logger.error(`Health check failed for pool ${name}:`, error as Error);
      return health;
    }
  }

  /**
   * Check health of all pools
   */
  async checkAllPoolsHealth(): Promise<Record<string, DatabaseHealth>> {
    const healthChecks: Record<string, DatabaseHealth> = {};
    
    const checkPromises = Array.from(this.pools.keys()).map(async name => {
      try {
        healthChecks[name] = await this.checkPoolHealth(name);
      } catch (error) {
        this.logger.error(`Error checking health for pool ${name}:`, error as Error);
        healthChecks[name] = {
          status: 'unhealthy',
          latency: 0,
          connections: { active: 0, idle: 0, total: 0 },
          lastCheck: new Date(),
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        };
      }
    });
    
    await Promise.all(checkPromises);
    return healthChecks;
  }

  /**
   * Get cached health status
   */
  getCachedHealth(name: string): DatabaseHealth | undefined {
    return this.healthChecks.get(name);
  }

  /**
   * Get all cached health statuses
   */
  getAllCachedHealth(): Record<string, DatabaseHealth> {
    const health: Record<string, DatabaseHealth> = {};
    for (const [name, healthCheck] of this.healthChecks) {
      health[name] = healthCheck;
    }
    return health;
  }

  /**
   * List all pool names
   */
  getPoolNames(): string[] {
    return Array.from(this.pools.keys());
  }

  /**
   * Check if a pool exists
   */
  hasPool(name: string): boolean {
    return this.pools.has(name);
  }

  /**
   * Get pool configuration
   */
  getPoolConfig(name: string): DatabaseConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * Get pool statistics
   */
  getStats(poolName?: string): PoolStats {
    if (poolName) {
      const pool = this.pools.get(poolName);
      if (!pool) {
        throw new Error(`Pool ${poolName} not found`);
      }
      return {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      };
    }

    // Return stats for the first pool if no name specified
    const firstPool = this.pools.values().next().value;
    if (!firstPool) {
      return {
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0
      };
    }

    return {
      totalCount: firstPool.totalCount,
      idleCount: firstPool.idleCount,
      waitingCount: firstPool.waitingCount
    };
  }

  /**
   * Check if error is a connection-related error that requires recovery
   */
  private isConnectionError(error: Error): boolean {
    const connectionErrorMessages = [
      'connection terminated',
      'connection closed',
      'connection timeout',
      'server closed the connection',
      'connection refused',
      'network error',
      'timeout expired',
      'connection lost',
      'connection reset'
    ];
    
    const errorMessage = error.message.toLowerCase();
    return connectionErrorMessages.some(msg => errorMessage.includes(msg));
  }
  
  /**
   * Schedule pool recovery after connection errors
   */
  private schedulePoolRecovery(poolName: string): void {
    // Debounce recovery attempts
    const recoveryKey = `recovery_${poolName}`;
    if ((this as any)[recoveryKey]) {
      return; // Recovery already scheduled
    }
    
    (this as any)[recoveryKey] = setTimeout(async () => {
      try {
        this.logger.info(`Attempting pool recovery for: ${poolName}`);
        await this.recoverPool(poolName);
        delete (this as any)[recoveryKey];
      } catch (error) {
        this.logger.error(`Pool recovery failed for ${poolName}:`, error as Error);
        delete (this as any)[recoveryKey];
      }
    }, 5000); // Wait 5 seconds before recovery
  }
  
  /**
   * Recover a pool by recreating it
   */
  private async recoverPool(poolName: string): Promise<void> {
    const config = this.configs.get(poolName);
    if (!config) {
      throw new Error(`No configuration found for pool: ${poolName}`);
    }
    
    this.logger.info(`Recovering pool: ${poolName}`);
    
    // Close existing pool
    const existingPool = this.pools.get(poolName);
    if (existingPool) {
      try {
        await existingPool.end();
      } catch (error) {
        this.logger.warn(`Error closing existing pool during recovery: ${error}`);
      }
    }
    
    // Create new pool
    await this.createPool(poolName, config);
    this.logger.info(`Pool recovery completed: ${poolName}`);
  }
  
  /**
   * Get a client with automatic retry on connection errors
   */
  async getClientWithRetry(poolName: string, maxRetries: number = 3): Promise<PoolClient> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const pool = await this.getPool(poolName);
        const client = await pool.connect();
        
        // Test the connection with a simple query
        await client.query('SELECT 1');
        
        return client;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Connection attempt ${attempt}/${maxRetries} failed:`, error as Error);
        
        if (attempt < maxRetries && this.isConnectionError(error as Error)) {
          // Wait before retry with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          this.logger.info(`Retrying connection in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          
          // Trigger pool recovery if this is a connection error
          this.schedulePoolRecovery(poolName);
        }
      }
    }
    
    throw new Error(`Failed to get client after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Set up event handlers for a pool
   */
  private setupPoolEventHandlers(pool: Pool, name: string): void {
    pool.on('connect', (client) => {
      this.logger.debug(`New client connected to pool: ${name}`);
      
      // Set up client-level keep-alive and error handling
      client.on('error', (err) => {
        this.logger.error(`Client error in pool ${name}:`, err);
        // Force client removal from pool on error
        client.release(err);
      });
      
      // Configure client connection settings for stability
      client.query('SET statement_timeout = 300000').catch(err => {
        this.logger.warn(`Failed to set statement_timeout on client: ${err.message}`);
      });
      
      client.query('SET idle_in_transaction_session_timeout = 600000').catch(err => {
        this.logger.warn(`Failed to set idle_in_transaction_session_timeout on client: ${err.message}`);
      });
    });

    pool.on('acquire', (client) => {
      this.logger.debug(`Client acquired from pool: ${name}`);
    });

    pool.on('release', (client) => {
      this.logger.debug(`Client released to pool: ${name}`);
    });

    pool.on('remove', (client) => {
      this.logger.debug(`Client removed from pool: ${name}`);
    });

    pool.on('error', (err, client) => {
      this.logger.error(`Pool error in ${name}:`, err);
      
      // Handle specific connection errors that require pool recreation
      if (this.isConnectionError(err)) {
        this.logger.warn(`Connection error detected, will attempt pool recovery: ${err.message}`);
        this.schedulePoolRecovery(name);
      }
    });

    // Note: Process termination handlers are managed at the application level
    // to prevent premature pool closure during startup
  }

  /**
   * Test pool connection during creation
   */
  private async testPoolConnection(pool: Pool, name: string): Promise<void> {
    this.logger.debug(`Testing connection for pool: ${name}`);
    
    const client = await pool.connect();
    try {
      // Test basic connectivity
      await client.query('SELECT 1');
      
      // Test pgvector extension
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      
      // Test vector operations
      await client.query('SELECT \'[1,2,3]\'::vector');
      
      this.logger.debug(`Connection test successful for pool: ${name}`);
    } finally {
      client.release();
    }
  }
}

/**
 * Health Monitor for database connections
 */
export class HealthMonitor {
  private poolManager: ConnectionPoolManager;
  private logger: DatabaseLogger;
  private monitoringInterval?: NodeJS.Timeout;
  private isMonitoring: boolean = false;

  constructor(poolManager: ConnectionPoolManager, logger: DatabaseLogger) {
    this.poolManager = poolManager;
    this.logger = logger;
  }

  /**
   * Start health monitoring
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      this.logger.warn('Health monitoring is already running');
      return;
    }

    this.logger.info(`Starting health monitoring with ${intervalMs}ms interval`);
    
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Error during health monitoring:', error as Error);
      }
    }, intervalMs);

    this.isMonitoring = true;
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.logger.info('Stopping health monitoring');
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.isMonitoring = false;
  }

  /**
   * Perform health check on all pools
   */
  async performHealthCheck(): Promise<Record<string, DatabaseHealth>> {
    const healthResults = await this.poolManager.checkAllPoolsHealth();
    
    // Log any unhealthy pools
    for (const [poolName, health] of Object.entries(healthResults)) {
      if (health.status === 'unhealthy') {
        this.logger.error(`Pool ${poolName} is unhealthy:`, new Error(health.errors.join(', ')));
      } else if (health.status === 'degraded') {
        this.logger.warn(`Pool ${poolName} is degraded: ${health.errors.join(', ')}`);
      }
    }

    return healthResults;
  }

  /**
   * Get monitoring status
   */
  isMonitoringActive(): boolean {
    return this.isMonitoring;
  }
}

/**
 * Default pool manager instance
 */
let defaultPoolManager: ConnectionPoolManager | null = null;

/**
 * Get or create the default pool manager
 */
export function getDefaultPoolManager(logger: DatabaseLogger): ConnectionPoolManager {
  if (!defaultPoolManager) {
    defaultPoolManager = new ConnectionPoolManager(logger);
  }
  return defaultPoolManager;
}

/**
 * Close the default pool manager
 */
export async function closeDefaultPoolManager(): Promise<void> {
  if (defaultPoolManager) {
    await defaultPoolManager.closeAllPools();
    defaultPoolManager = null;
  }
}
