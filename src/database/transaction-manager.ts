/**
 * Transaction Management System
 * 
 * Provides unified transaction management for both SQLite and PostgreSQL databases.
 * Supports nested transactions through savepoints and proper error handling.
 */

import Database from 'better-sqlite3';
import { PoolClient } from 'pg';
import { Transaction, PreparedStatement, RunResult, DatabaseLogger } from './interfaces.js';

/**
 * Database-specific error class
 */
export class DatabaseError extends Error {
  public readonly code: string;
  public readonly sql?: string;
  public readonly params?: any[];
  public readonly originalError?: Error;

  constructor(
    message: string, 
    sql?: string, 
    params?: any[], 
    originalError?: Error,
    code: string = 'DATABASE_ERROR'
  ) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.sql = sql;
    this.params = params;
    this.originalError = originalError;
  }
}

/**
 * Transaction-specific error class
 */
export class TransactionError extends DatabaseError {
  constructor(message: string, originalError?: Error) {
    super(message, undefined, undefined, originalError, 'TRANSACTION_ERROR');
    this.name = 'TransactionError';
  }
}

/**
 * Base transaction class with common functionality
 */
export abstract class BaseTransaction implements Transaction {
  protected id: string;
  protected isActiveFlag: boolean = true;
  protected savepoints: Set<string> = new Set();
  protected logger: DatabaseLogger;
  protected startTime: number;

  constructor(id: string, logger: DatabaseLogger) {
    this.id = id;
    this.logger = logger;
    this.startTime = Date.now();
    this.logger.debug(`Transaction started: ${id}`);
  }

  getId(): string {
    return this.id;
  }

  isActive(): boolean {
    return this.isActiveFlag;
  }

  async savepoint(name: string): Promise<void> {
    if (!this.isActiveFlag) {
      throw new TransactionError('Transaction is not active');
    }
    
    if (this.savepoints.has(name)) {
      throw new TransactionError(`Savepoint '${name}' already exists`);
    }
    
    this.logger.debug(`Creating savepoint: ${name} in transaction ${this.id}`);
    
    try {
      await this.executeSavepoint(name);
      this.savepoints.add(name);
    } catch (error) {
      throw new TransactionError(`Failed to create savepoint '${name}': ${error}`, error as Error);
    }
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    if (!this.isActiveFlag) {
      throw new TransactionError('Transaction is not active');
    }
    
    if (!this.savepoints.has(name)) {
      throw new TransactionError(`Savepoint '${name}' not found`);
    }
    
    this.logger.debug(`Rolling back to savepoint: ${name} in transaction ${this.id}`);
    
    try {
      await this.executeRollbackToSavepoint(name);
      
      // Remove savepoints created after this one
      const savepointArray = Array.from(this.savepoints);
      const index = savepointArray.indexOf(name);
      for (let i = index + 1; i < savepointArray.length; i++) {
        this.savepoints.delete(savepointArray[i]);
      }
    } catch (error) {
      throw new TransactionError(`Failed to rollback to savepoint '${name}': ${error}`, error as Error);
    }
  }

  async releaseSavepoint(name: string): Promise<void> {
    if (!this.isActiveFlag) {
      throw new TransactionError('Transaction is not active');
    }
    
    if (!this.savepoints.has(name)) {
      throw new TransactionError(`Savepoint '${name}' not found`);
    }
    
    this.logger.debug(`Releasing savepoint: ${name} in transaction ${this.id}`);
    
    try {
      await this.executeReleaseSavepoint(name);
      this.savepoints.delete(name);
    } catch (error) {
      throw new TransactionError(`Failed to release savepoint '${name}': ${error}`, error as Error);
    }
  }

  protected logTransactionEnd(action: 'commit' | 'rollback'): void {
    const duration = Date.now() - this.startTime;
    this.logger.debug(`Transaction ${action}: ${this.id} (duration: ${duration}ms)`);
  }

  // Abstract methods to be implemented by concrete classes
  abstract execute<T = any>(sql: string, params?: any[]): Promise<T>;
  abstract prepare<T = any>(sql: string): PreparedStatement<T>;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  protected abstract executeSavepoint(name: string): Promise<void>;
  protected abstract executeRollbackToSavepoint(name: string): Promise<void>;
  protected abstract executeReleaseSavepoint(name: string): Promise<void>;
}

/**
 * SQLite Transaction Implementation
 */
export class SQLiteTransaction extends BaseTransaction {
  private db: Database.Database;

  constructor(db: Database.Database, id: string, logger: DatabaseLogger) {
    super(id, logger);
    this.db = db;
  }

  async execute<T = any>(sql: string, params: any[] = []): Promise<T> {
    if (!this.isActiveFlag) {
      throw new TransactionError('Transaction is not active');
    }
    
    this.logger.debug(`Executing SQL in transaction ${this.id}: ${sql}`);
    
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return result as T;
    } catch (error) {
      this.logger.error(`SQL execution failed in transaction ${this.id}:`, error as Error, { sql, params });
      throw new DatabaseError(`SQL execution failed: ${error}`, sql, params, error as Error);
    }
  }

  prepare<T = any>(sql: string): PreparedStatement<T> {
    if (!this.isActiveFlag) {
      throw new TransactionError('Transaction is not active');
    }
    
    try {
      const stmt = this.db.prepare(sql);
      return new SQLitePreparedStatement<T>(stmt, this.logger);
    } catch (error) {
      this.logger.error(`Failed to prepare statement in transaction ${this.id}:`, error as Error, { sql });
      throw new DatabaseError(`Failed to prepare statement: ${error}`, sql, undefined, error as Error);
    }
  }

  async commit(): Promise<void> {
    if (!this.isActiveFlag) {
      throw new TransactionError('Transaction is not active');
    }
    
    try {
      this.db.exec('COMMIT');
      this.isActiveFlag = false;
      this.logTransactionEnd('commit');
    } catch (error) {
      this.logger.error(`Transaction commit failed: ${this.id}`, error as Error);
      throw new TransactionError(`Transaction commit failed: ${error}`, error as Error);
    }
  }

  async rollback(): Promise<void> {
    if (!this.isActiveFlag) {
      return; // Already rolled back
    }
    
    try {
      this.db.exec('ROLLBACK');
      this.isActiveFlag = false;
      this.logTransactionEnd('rollback');
    } catch (error) {
      this.logger.error(`Transaction rollback failed: ${this.id}`, error as Error);
      throw new TransactionError(`Transaction rollback failed: ${error}`, error as Error);
    }
  }

  protected async executeSavepoint(name: string): Promise<void> {
    this.db.exec(`SAVEPOINT ${name}`);
  }

  protected async executeRollbackToSavepoint(name: string): Promise<void> {
    this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
  }

  protected async executeReleaseSavepoint(name: string): Promise<void> {
    this.db.exec(`RELEASE SAVEPOINT ${name}`);
  }
}

/**
 * PostgreSQL Transaction Implementation
 */
export class PostgreSQLTransaction extends BaseTransaction {
  private client: PoolClient;
  private shouldReleaseClient: boolean = true;

  constructor(client: PoolClient, id: string, logger: DatabaseLogger) {
    super(id, logger);
    this.client = client;
  }

  async execute<T = any>(sql: string, params: any[] = []): Promise<T> {
    if (!this.isActiveFlag) {
      throw new TransactionError('Transaction is not active');
    }
    
    this.logger.debug(`Executing SQL in transaction ${this.id}: ${sql}`);
    
    try {
      const result = await this.client.query(sql, params);
      return result as T;
    } catch (error) {
      this.logger.error(`SQL execution failed in transaction ${this.id}:`, error as Error, { sql, params });
      throw new DatabaseError(`SQL execution failed: ${error}`, sql, params, error as Error);
    }
  }

  prepare<T = any>(sql: string): PreparedStatement<T> {
    if (!this.isActiveFlag) {
      throw new TransactionError('Transaction is not active');
    }
    
    return new PostgreSQLPreparedStatement<T>(this.client, sql, this.logger);
  }

  async commit(): Promise<void> {
    if (!this.isActiveFlag) {
      throw new TransactionError('Transaction is not active');
    }
    
    try {
      await this.client.query('COMMIT');
      this.isActiveFlag = false;
      this.logTransactionEnd('commit');
      
      if (this.shouldReleaseClient) {
        this.client.release();
      }
    } catch (error) {
      this.logger.error(`Transaction commit failed: ${this.id}`, error as Error);
      
      if (this.shouldReleaseClient) {
        this.client.release(true); // Release with error
      }
      
      throw new TransactionError(`Transaction commit failed: ${error}`, error as Error);
    }
  }

  async rollback(): Promise<void> {
    if (!this.isActiveFlag) {
      return; // Already rolled back
    }
    
    try {
      await this.client.query('ROLLBACK');
      this.isActiveFlag = false;
      this.logTransactionEnd('rollback');
      
      if (this.shouldReleaseClient) {
        this.client.release();
      }
    } catch (error) {
      this.logger.error(`Transaction rollback failed: ${this.id}`, error as Error);
      
      if (this.shouldReleaseClient) {
        this.client.release(true); // Release with error
      }
      
      throw new TransactionError(`Transaction rollback failed: ${error}`, error as Error);
    }
  }

  protected async executeSavepoint(name: string): Promise<void> {
    await this.client.query(`SAVEPOINT ${name}`);
  }

  protected async executeRollbackToSavepoint(name: string): Promise<void> {
    await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }

  protected async executeReleaseSavepoint(name: string): Promise<void> {
    await this.client.query(`RELEASE SAVEPOINT ${name}`);
  }

  /**
   * Set whether to release the client when transaction ends
   */
  setShouldReleaseClient(shouldRelease: boolean): void {
    this.shouldReleaseClient = shouldRelease;
  }
}

/**
 * SQLite Prepared Statement Implementation
 */
export class SQLitePreparedStatement<T = any> implements PreparedStatement<T> {
  private stmt: Database.Statement;
  private logger: DatabaseLogger;

  constructor(stmt: Database.Statement, logger: DatabaseLogger) {
    this.stmt = stmt;
    this.logger = logger;
  }

  async run(...params: any[]): Promise<RunResult> {
    try {
      const result = this.stmt.run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    } catch (error) {
      this.logger.error('Prepared statement run failed:', error as Error, { params });
      throw new DatabaseError(`Prepared statement execution failed: ${error}`, undefined, params, error as Error);
    }
  }

  async get(...params: any[]): Promise<T | undefined> {
    try {
      return this.stmt.get(...params) as T | undefined;
    } catch (error) {
      this.logger.error('Prepared statement get failed:', error as Error, { params });
      throw new DatabaseError(`Prepared statement get failed: ${error}`, undefined, params, error as Error);
    }
  }

  async all(...params: any[]): Promise<T[]> {
    try {
      return this.stmt.all(...params) as T[];
    } catch (error) {
      this.logger.error('Prepared statement all failed:', error as Error, { params });
      throw new DatabaseError(`Prepared statement all failed: ${error}`, undefined, params, error as Error);
    }
  }

  async finalize(): Promise<void> {
    // SQLite prepared statements don't need explicit finalization in better-sqlite3
    // This is a no-op for compatibility
  }
}

/**
 * PostgreSQL Prepared Statement Implementation
 */
export class PostgreSQLPreparedStatement<T = any> implements PreparedStatement<T> {
  private client: PoolClient;
  private sql: string;
  private logger: DatabaseLogger;

  constructor(client: PoolClient, sql: string, logger: DatabaseLogger) {
    this.client = client;
    this.sql = sql;
    this.logger = logger;
  }

  async run(...params: any[]): Promise<RunResult> {
    try {
      const result = await this.client.query(this.sql, params);
      return {
        changes: result.rowCount || 0,
        // PostgreSQL doesn't have lastInsertRowid equivalent
        // This would need to be handled differently for INSERT operations
      };
    } catch (error) {
      this.logger.error('Prepared statement run failed:', error as Error, { sql: this.sql, params });
      throw new DatabaseError(`Prepared statement execution failed: ${error}`, this.sql, params, error as Error);
    }
  }

  async get(...params: any[]): Promise<T | undefined> {
    try {
      const result = await this.client.query(this.sql, params);
      return result.rows[0] as T | undefined;
    } catch (error) {
      this.logger.error('Prepared statement get failed:', error as Error, { sql: this.sql, params });
      throw new DatabaseError(`Prepared statement get failed: ${error}`, this.sql, params, error as Error);
    }
  }

  async all(...params: any[]): Promise<T[]> {
    try {
      const result = await this.client.query(this.sql, params);
      return result.rows as T[];
    } catch (error) {
      this.logger.error('Prepared statement all failed:', error as Error, { sql: this.sql, params });
      throw new DatabaseError(`Prepared statement all failed: ${error}`, this.sql, params, error as Error);
    }
  }

  async finalize(): Promise<void> {
    // PostgreSQL prepared statements are automatically cleaned up
    // This is a no-op for compatibility
  }
}

/**
 * Transaction Manager for coordinating transactions
 */
export class TransactionManager {
  private activeTransactions: Map<string, Transaction> = new Map();
  private logger: DatabaseLogger;

  constructor(logger: DatabaseLogger) {
    this.logger = logger;
  }

  /**
   * Register a transaction
   */
  registerTransaction(transaction: Transaction): void {
    this.activeTransactions.set(transaction.getId(), transaction);
    this.logger.debug(`Transaction registered: ${transaction.getId()}`);
  }

  /**
   * Unregister a transaction
   */
  unregisterTransaction(transactionId: string): void {
    this.activeTransactions.delete(transactionId);
    this.logger.debug(`Transaction unregistered: ${transactionId}`);
  }

  /**
   * Get active transaction by ID
   */
  getTransaction(transactionId: string): Transaction | undefined {
    return this.activeTransactions.get(transactionId);
  }

  /**
   * Get all active transactions
   */
  getActiveTransactions(): Transaction[] {
    return Array.from(this.activeTransactions.values());
  }

  /**
   * Get active transaction count
   */
  getActiveTransactionCount(): number {
    return this.activeTransactions.size;
  }

  /**
   * Rollback all active transactions (emergency cleanup)
   */
  async rollbackAllTransactions(): Promise<void> {
    this.logger.warn(`Rolling back ${this.activeTransactions.size} active transactions`);
    
    const rollbackPromises = Array.from(this.activeTransactions.values()).map(async (tx) => {
      try {
        if (tx.isActive()) {
          await tx.rollback();
        }
      } catch (error) {
        this.logger.error(`Error rolling back transaction ${tx.getId()}:`, error as Error);
      }
    });
    
    await Promise.all(rollbackPromises);
    this.activeTransactions.clear();
  }

  /**
   * Execute a function within a transaction with automatic cleanup
   */
  async executeInTransaction<T>(
    createTransaction: () => Promise<Transaction>,
    fn: (tx: Transaction) => Promise<T>
  ): Promise<T> {
    const transaction = await createTransaction();
    this.registerTransaction(transaction);
    
    try {
      const result = await fn(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      this.logger.error(`Error in transaction ${transaction.getId()}:`, error as Error);
      
      try {
        if (transaction.isActive()) {
          await transaction.rollback();
        }
      } catch (rollbackError) {
        this.logger.error(`Error rolling back transaction ${transaction.getId()}:`, rollbackError as Error);
      }
      
      throw error;
    } finally {
      this.unregisterTransaction(transaction.getId());
    }
  }
}

/**
 * Generate a unique transaction ID
 */
export function generateTransactionId(): string {
  return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Export SQLiteTransaction as SQLiteTransactionManager for convenience
 */
export { SQLiteTransaction as SQLiteTransactionManager };
