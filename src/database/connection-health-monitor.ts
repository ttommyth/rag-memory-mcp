/**
 * Connection Health Monitor
 * 
 * Monitors PostgreSQL connection health and automatically handles reconnections
 */

import { Pool, PoolClient } from 'pg';
import { DatabaseLogger } from './interfaces.js';

export interface ConnectionHealthConfig {
  checkIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  healthCheckQuery: string;
  healthCheckTimeoutMs: number;
}

export class ConnectionHealthMonitor {
  private pool: Pool;
  private logger: DatabaseLogger;
  private config: ConnectionHealthConfig;
  private isMonitoring: boolean = false;
  private monitorInterval?: NodeJS.Timeout;
  private consecutiveFailures: number = 0;

  constructor(pool: Pool, logger: DatabaseLogger, config?: Partial<ConnectionHealthConfig>) {
    this.pool = pool;
    this.logger = logger;
    this.config = {
      checkIntervalMs: 30000, // Check every 30 seconds
      maxRetries: 3,
      retryDelayMs: 5000,
      healthCheckQuery: 'SELECT 1',
      healthCheckTimeoutMs: 10000,
      ...config
    };
  }

  /**
   * Start monitoring connection health
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      this.logger.warn('Connection health monitoring is already running');
      return;
    }

    this.logger.info('Starting connection health monitoring', {
      interval: this.config.checkIntervalMs,
      maxRetries: this.config.maxRetries
    });

    this.isMonitoring = true;
    this.scheduleNextCheck();
  }

  /**
   * Stop monitoring connection health
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.logger.info('Stopping connection health monitoring');
    
    if (this.monitorInterval) {
      clearTimeout(this.monitorInterval);
      this.monitorInterval = undefined;
    }

    this.isMonitoring = false;
    this.consecutiveFailures = 0;
  }

  /**
   * Perform a single health check
   */
  async performHealthCheck(): Promise<boolean> {
    let client: PoolClient | null = null;
    
    try {
      // Get client with timeout
      client = await Promise.race([
        this.pool.connect(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), this.config.healthCheckTimeoutMs)
        )
      ]);

      // Execute health check query with timeout
      await Promise.race([
        client.query(this.config.healthCheckQuery),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Health check query timeout')), this.config.healthCheckTimeoutMs)
        )
      ]);

      // Reset failure counter on success
      if (this.consecutiveFailures > 0) {
        this.logger.info('Connection health restored', {
          previousFailures: this.consecutiveFailures
        });
        this.consecutiveFailures = 0;
      }

      return true;

    } catch (error) {
      this.consecutiveFailures++;
      this.logger.error('Connection health check failed', error as Error, {
        consecutiveFailures: this.consecutiveFailures,
        maxRetries: this.config.maxRetries
      });

      // Trigger recovery if we've exceeded max failures
      if (this.consecutiveFailures >= this.config.maxRetries) {
        await this.triggerConnectionRecovery();
      }

      return false;

    } finally {
      if (client) {
        try {
          client.release();
        } catch (error) {
          this.logger.warn('Error releasing client after health check', error as Error);
        }
      }
    }
  }

  /**
   * Trigger connection recovery procedures
   */
  private async triggerConnectionRecovery(): Promise<void> {
    this.logger.warn('Triggering connection recovery', {
      consecutiveFailures: this.consecutiveFailures
    });

    try {
      // Emit pool error to trigger existing recovery mechanisms
      this.pool.emit('error', new Error('Health check failures exceeded threshold'));
      
      // Reset failure counter after triggering recovery
      this.consecutiveFailures = 0;
      
    } catch (error) {
      this.logger.error('Error during connection recovery', error as Error);
    }
  }

  /**
   * Schedule the next health check
   */
  private scheduleNextCheck(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.monitorInterval = setTimeout(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Unexpected error during health check', error as Error);
      } finally {
        this.scheduleNextCheck();
      }
    }, this.config.checkIntervalMs);
  }

  /**
   * Get current health status
   */
  getHealthStatus(): {
    isMonitoring: boolean;
    consecutiveFailures: number;
    maxRetries: number;
    isHealthy: boolean;
  } {
    return {
      isMonitoring: this.isMonitoring,
      consecutiveFailures: this.consecutiveFailures,
      maxRetries: this.config.maxRetries,
      isHealthy: this.consecutiveFailures < this.config.maxRetries
    };
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(newConfig: Partial<ConnectionHealthConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Connection health monitor configuration updated', this.config);
  }
}