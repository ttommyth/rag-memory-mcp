/**
 * Database Manager
 * 
 * Main orchestrator for database operations. Manages adapter lifecycle,
 * configuration, and provides a unified interface for all database operations.
 */

import {
  DatabaseAdapter,
  DatabaseConfig,
  DatabaseHealth,
  Transaction,
  Entity,
  Relation,
  KnowledgeGraph,
  EntitySearchResult,
  ObservationAddition,
  ObservationDeletion,
  ChunkOptions,
  ChunkResult,
  ExtractOptions,
  TermResult,
  StoreDocumentResult,
  SearchOptions,
  EnhancedSearchResult,
  DetailedContext,
  DocumentInfo,
  KnowledgeGraphStats,
  PerformanceMetrics,
  Migration,
  MigrationResult,
  RollbackResult,
  EmbeddingResult,
  DeletionResult,
  DatabaseLogger
} from './interfaces.js';

import { DatabaseFactory } from './database-factory.js';
import { ConfigManager } from './config-manager.js';
import { DatabaseLogger as Logger } from './logger.js';

/**
 * Database Manager Events
 */
export interface DatabaseManagerEvents {
  'adapter-created': (adapter: DatabaseAdapter) => void;
  'adapter-closed': (adapter: DatabaseAdapter) => void;
  'configuration-changed': (config: DatabaseConfig) => void;
  'health-check': (health: DatabaseHealth) => void;
  'error': (error: Error) => void;
}

/**
 * Database Manager Options
 */
export interface DatabaseManagerOptions {
  logger?: DatabaseLogger;
  autoReconnect?: boolean;
  healthCheckInterval?: number;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Database Manager Class
 */
export class DatabaseManager {
  private adapter: DatabaseAdapter | null = null;
  private config: DatabaseConfig | null = null;
  private factory: DatabaseFactory;
  private configManager: ConfigManager;
  private logger: DatabaseLogger;
  private options: Required<DatabaseManagerOptions>;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;
  private eventListeners: Map<keyof DatabaseManagerEvents, Function[]> = new Map();

  constructor(options: DatabaseManagerOptions = {}) {
    this.logger = options.logger || new Logger();
    this.options = {
      logger: this.logger,
      autoReconnect: options.autoReconnect ?? true,
      healthCheckInterval: options.healthCheckInterval ?? 30000, // 30 seconds
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000
    };

    this.factory = DatabaseFactory.getInstance(this.logger);
    this.configManager = new ConfigManager(this.logger);

    this.logger.info('Database Manager initialized', {
      autoReconnect: this.options.autoReconnect,
      healthCheckInterval: this.options.healthCheckInterval
    });
  }

  // ============================================================================
  // Initialization and Configuration
  // ============================================================================

  /**
   * Initialize with configuration object
   */
  async initialize(config: DatabaseConfig): Promise<void> {
    this.logger.info('Initializing Database Manager with configuration');

    try {
      this.config = config;
      this.configManager.loadFromObject(config, 'runtime');
      
      await this.createAndInitializeAdapter();
      this.startHealthChecking();
      
      this.emit('configuration-changed', config);
      this.logger.info('Database Manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Database Manager', error as Error);
      throw error;
    }
  }

  /**
   * Initialize from environment variables
   */
  async initializeFromEnvironment(): Promise<void> {
    this.logger.info('Initializing Database Manager from environment');

    try {
      this.config = this.configManager.loadFromEnvironment();
      await this.createAndInitializeAdapter();
      this.startHealthChecking();
      
      this.emit('configuration-changed', this.config);
      this.logger.info('Database Manager initialized from environment');
    } catch (error) {
      this.logger.error('Failed to initialize Database Manager from environment', error as Error);
      throw error;
    }
  }

  /**
   * Initialize from configuration file
   */
  async initializeFromFile(filePath: string, configName?: string): Promise<void> {
    this.logger.info('Initializing Database Manager from file', { filePath, configName });

    try {
      this.config = await this.configManager.loadFromFile(filePath, configName);
      await this.createAndInitializeAdapter();
      this.startHealthChecking();
      
      this.emit('configuration-changed', this.config);
      this.logger.info('Database Manager initialized from file');
    } catch (error) {
      this.logger.error('Failed to initialize Database Manager from file', error as Error);
      throw error;
    }
  }

  /**
   * Switch to a different configuration
   */
  async switchConfiguration(configName: string): Promise<void> {
    this.logger.info('Switching database configuration', { configName });

    try {
      const newConfig = this.configManager.switchConfiguration(configName);
      
      // Close current adapter
      if (this.adapter) {
        await this.adapter.close();
        this.emit('adapter-closed', this.adapter);
      }

      // Create new adapter with new configuration
      this.config = newConfig;
      await this.createAndInitializeAdapter();
      
      this.emit('configuration-changed', newConfig);
      this.logger.info('Configuration switched successfully', { configName });
    } catch (error) {
      this.logger.error('Failed to switch configuration', error as Error, { configName });
      throw error;
    }
  }

  // ============================================================================
  // Adapter Management
  // ============================================================================

  private async createAndInitializeAdapter(): Promise<void> {
    if (!this.config) {
      throw new Error('No configuration available');
    }

    let retries = 0;
    while (retries < this.options.maxRetries) {
      try {
        this.adapter = await this.factory.createAdapter(this.config);
        this.emit('adapter-created', this.adapter);
        this.logger.info('Database adapter created and initialized');
        return;
      } catch (error) {
        retries++;
        this.logger.warn(`Failed to create adapter (attempt ${retries}/${this.options.maxRetries})`, error as Error);
        
        if (retries >= this.options.maxRetries) {
          throw error;
        }
        
        await this.delay(this.options.retryDelay * retries);
      }
    }
  }

  private async reconnectAdapter(): Promise<void> {
    if (!this.options.autoReconnect || this.isShuttingDown) {
      return;
    }

    this.logger.info('Attempting to reconnect database adapter');

    try {
      if (this.adapter) {
        await this.adapter.close();
      }
      await this.createAndInitializeAdapter();
      this.logger.info('Database adapter reconnected successfully');
    } catch (error) {
      this.logger.error('Failed to reconnect database adapter', error as Error);
      this.emit('error', error as Error);
    }
  }

  // ============================================================================
  // Health Monitoring
  // ============================================================================

  private startHealthChecking(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        const health = await this.getHealth();
        this.emit('health-check', health);

        if (health.status === 'unhealthy' && this.options.autoReconnect) {
          this.logger.warn('Database unhealthy, attempting reconnection');
          await this.reconnectAdapter();
        }
      } catch (error) {
        this.logger.error('Health check failed', error as Error);
        this.emit('error', error as Error);
      }
    }, this.options.healthCheckInterval);
  }

  private stopHealthChecking(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ============================================================================
  // Public API - Connection Management
  // ============================================================================

  /**
   * Check if database is connected
   */
  isConnected(): boolean {
    return this.adapter?.isConnected() ?? false;
  }

  /**
   * Get database health status
   */
  async getHealth(): Promise<DatabaseHealth> {
    if (!this.adapter) {
      return {
        status: 'unhealthy',
        latency: -1,
        connections: { active: 0, idle: 0, total: 0 },
        lastCheck: new Date(),
        errors: ['No database adapter available']
      };
    }

    return this.adapter.getHealth();
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    this.logger.info('Closing Database Manager');
    this.isShuttingDown = true;

    this.stopHealthChecking();

    if (this.adapter) {
      await this.adapter.close();
      this.emit('adapter-closed', this.adapter);
      this.adapter = null;
    }

    this.logger.info('Database Manager closed');
  }

  // ============================================================================
  // Public API - Database Operations (Delegated to Adapter)
  // ============================================================================

  private ensureAdapter(): DatabaseAdapter {
    if (!this.adapter) {
      throw new Error('Database adapter not initialized');
    }
    return this.adapter;
  }

  // Transaction Management
  async beginTransaction(): Promise<Transaction> {
    return this.ensureAdapter().beginTransaction();
  }

  async executeInTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.ensureAdapter().executeInTransaction(fn);
  }

  // Schema Management
  async runMigrations(migrations: Migration[]): Promise<MigrationResult> {
    return this.ensureAdapter().runMigrations(migrations);
  }

  async getCurrentVersion(): Promise<number> {
    return this.ensureAdapter().getCurrentVersion();
  }

  async rollbackMigration(targetVersion: number): Promise<RollbackResult> {
    return this.ensureAdapter().rollbackMigration(targetVersion);
  }

  // Entity Operations
  async createEntities(entities: Entity[]): Promise<Entity[]> {
    return this.ensureAdapter().createEntities(entities);
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    return this.ensureAdapter().deleteEntities(entityNames);
  }

  async addObservations(observations: ObservationAddition[]): Promise<void> {
    return this.ensureAdapter().addObservations(observations);
  }

  async deleteObservations(deletions: ObservationDeletion[]): Promise<void> {
    return this.ensureAdapter().deleteObservations(deletions);
  }

  async searchNodes(query: string, limit?: number): Promise<KnowledgeGraph> {
    return this.ensureAdapter().searchNodes(query, limit);
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    return this.ensureAdapter().openNodes(names);
  }

  async readGraph(): Promise<KnowledgeGraph> {
    return this.ensureAdapter().readGraph();
  }

  async embedAllEntities(): Promise<EmbeddingResult> {
    return this.ensureAdapter().embedAllEntities();
  }

  // Relationship Operations
  async createRelations(relations: Relation[]): Promise<void> {
    return this.ensureAdapter().createRelations(relations);
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    return this.ensureAdapter().deleteRelations(relations);
  }

  // Document Operations
  async storeDocument(id: string, content: string, metadata?: Record<string, any>): Promise<StoreDocumentResult> {
    return this.ensureAdapter().storeDocument(id, content, metadata);
  }

  async chunkDocument(documentId: string, options?: ChunkOptions): Promise<ChunkResult> {
    return this.ensureAdapter().chunkDocument(documentId, options);
  }

  async embedChunks(documentId: string): Promise<EmbeddingResult> {
    return this.ensureAdapter().embedChunks(documentId);
  }

  async extractTerms(documentId: string, options?: ExtractOptions): Promise<TermResult> {
    return this.ensureAdapter().extractTerms(documentId, options);
  }

  async linkEntitiesToDocument(documentId: string, entityNames: string[]): Promise<void> {
    return this.ensureAdapter().linkEntitiesToDocument(documentId, entityNames);
  }

  async deleteDocuments(documentIds: string | string[]): Promise<DeletionResult> {
    return this.ensureAdapter().deleteDocuments(documentIds);
  }

  async listDocuments(includeMetadata?: boolean): Promise<DocumentInfo[]> {
    return this.ensureAdapter().listDocuments(includeMetadata);
  }

  // Search Operations
  async hybridSearch(query: string, options?: SearchOptions): Promise<EnhancedSearchResult[]> {
    return this.ensureAdapter().hybridSearch(query, options);
  }

  async getDetailedContext(chunkId: string, includeSurrounding?: boolean): Promise<DetailedContext> {
    return this.ensureAdapter().getDetailedContext(chunkId, includeSurrounding);
  }

  // Statistics and Monitoring
  async getKnowledgeGraphStats(): Promise<KnowledgeGraphStats> {
    return this.ensureAdapter().getKnowledgeGraphStats();
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    return this.ensureAdapter().getPerformanceMetrics();
  }

  // ============================================================================
  // Event Management
  // ============================================================================

  on<K extends keyof DatabaseManagerEvents>(event: K, listener: DatabaseManagerEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  off<K extends keyof DatabaseManagerEvents>(event: K, listener: DatabaseManagerEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit<K extends keyof DatabaseManagerEvents>(event: K, ...args: Parameters<DatabaseManagerEvents[K]>): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          (listener as any)(...args);
        } catch (error) {
          this.logger.error(`Event listener error for ${event}`, error as Error);
        }
      });
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get current configuration
   */
  getCurrentConfiguration(): DatabaseConfig | null {
    return this.config;
  }

  /**
   * Get configuration manager
   */
  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  /**
   * Get current adapter type
   */
  getAdapterType(): string | null {
    return this.config?.type || null;
  }

  /**
   * Get the current database adapter
   */
  getAdapter(): DatabaseAdapter | null {
    return this.adapter;
  }

  /**
   * Test connection with a different configuration
   */
  async testConfiguration(config: DatabaseConfig): Promise<boolean> {
    try {
      const testFactory = DatabaseFactory.getInstance(this.logger);
      const testAdapter = await testFactory.createAdapter(config);
      const health = await testAdapter.getHealth();
      await testAdapter.close();
      return health.status !== 'unhealthy';
    } catch (error) {
      this.logger.warn('Configuration test failed', error as Error);
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
