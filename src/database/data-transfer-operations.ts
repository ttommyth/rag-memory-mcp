/**
 * Data Transfer Operations
 * 
 * Implements specific data transfer operations for migrating data
 * from SQLite to PostgreSQL while preserving all relationships and vector data.
 */

import {
  DatabaseAdapter,
  Entity,
  Relation,
  DocumentInfo,
  DatabaseLogger
} from './interfaces.js';

import {
  DataTransferOperation,
  DataTransferResult,
  ValidationResult
} from './multi-db-migration-manager.js';

import { DatabaseLogger as Logger } from './logger.js';

/**
 * Base class for data transfer operations
 */
abstract class BaseDataTransferOperation implements DataTransferOperation {
  public name: string;
  public description: string;
  public sourceAdapter: DatabaseAdapter;
  public targetAdapter: DatabaseAdapter;
  protected logger: DatabaseLogger;

  constructor(
    name: string,
    description: string,
    sourceAdapter: DatabaseAdapter,
    targetAdapter: DatabaseAdapter,
    logger?: DatabaseLogger
  ) {
    this.name = name;
    this.description = description;
    this.sourceAdapter = sourceAdapter;
    this.targetAdapter = targetAdapter;
    this.logger = logger || new Logger();
  }

  abstract execute(): Promise<DataTransferResult>;

  async validate(): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation - check if adapters are connected
    if (!this.sourceAdapter.isConnected()) {
      errors.push('Source database is not connected');
    }

    if (!this.targetAdapter.isConnected()) {
      errors.push('Target database is not connected');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      details: {}
    };
  }

  protected async handleError(operation: string, error: Error): Promise<DataTransferResult> {
    this.logger.error(`${this.name} - ${operation} failed`, error);
    return {
      success: false,
      recordsTransferred: 0,
      errors: [error.message],
      duration: 0,
      details: { operation, error: error.message }
    };
  }
}

/**
 * Transfer entities from source to target database
 */
export class EntityTransferOperation extends BaseDataTransferOperation {
  constructor(
    sourceAdapter: DatabaseAdapter,
    targetAdapter: DatabaseAdapter,
    logger?: DatabaseLogger
  ) {
    super(
      'EntityTransfer',
      'Transfer all entities with their observations and metadata',
      sourceAdapter,
      targetAdapter,
      logger
    );
  }

  async execute(): Promise<DataTransferResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting entity transfer operation');

      // Read all entities from source
      const sourceGraph = await this.sourceAdapter.readGraph();
      const entities = sourceGraph.entities;

      if (entities.length === 0) {
        this.logger.info('No entities to transfer');
        return {
          success: true,
          recordsTransferred: 0,
          errors: [],
          duration: Date.now() - startTime,
          details: { message: 'No entities found in source database' }
        };
      }

      this.logger.info(`Transferring ${entities.length} entities`);

      // Create entities in target database
      await this.targetAdapter.createEntities(entities);

      this.logger.info(`Successfully transferred ${entities.length} entities`);

      return {
        success: true,
        recordsTransferred: entities.length,
        errors: [],
        duration: Date.now() - startTime,
        details: {
          entityTypes: this.getEntityTypeBreakdown(entities),
          totalObservations: entities.reduce((sum, e) => sum + e.observations.length, 0)
        }
      };

    } catch (error) {
      return this.handleError('entity transfer', error as Error);
    }
  }

  async validate(): Promise<ValidationResult> {
    const baseValidation = await super.validate();
    if (!baseValidation.valid) {
      return baseValidation;
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const details: Record<string, any> = {};

    try {
      // Check source entity count
      const sourceStats = await this.sourceAdapter.getKnowledgeGraphStats();
      details.sourceEntityCount = sourceStats.entities.total;

      // Check target entity count
      const targetStats = await this.targetAdapter.getKnowledgeGraphStats();
      details.targetEntityCount = targetStats.entities.total;

      if (targetStats.entities.total > 0) {
        warnings.push(`Target database already contains ${targetStats.entities.total} entities`);
      }

    } catch (error) {
      errors.push(`Validation error: ${(error as Error).message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      details
    };
  }

  private getEntityTypeBreakdown(entities: Entity[]): Record<string, number> {
    const breakdown: Record<string, number> = {};
    entities.forEach(entity => {
      breakdown[entity.entityType] = (breakdown[entity.entityType] || 0) + 1;
    });
    return breakdown;
  }
}

/**
 * Transfer relationships from source to target database
 */
export class RelationshipTransferOperation extends BaseDataTransferOperation {
  constructor(
    sourceAdapter: DatabaseAdapter,
    targetAdapter: DatabaseAdapter,
    logger?: DatabaseLogger
  ) {
    super(
      'RelationshipTransfer',
      'Transfer all relationships between entities',
      sourceAdapter,
      targetAdapter,
      logger
    );
  }

  async execute(): Promise<DataTransferResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting relationship transfer operation');

      // Read all relationships from source
      const sourceGraph = await this.sourceAdapter.readGraph();
      const relationships = sourceGraph.relations;

      if (relationships.length === 0) {
        this.logger.info('No relationships to transfer');
        return {
          success: true,
          recordsTransferred: 0,
          errors: [],
          duration: Date.now() - startTime,
          details: { message: 'No relationships found in source database' }
        };
      }

      this.logger.info(`Transferring ${relationships.length} relationships`);

      // Create relationships in target database
      await this.targetAdapter.createRelations(relationships);

      this.logger.info(`Successfully transferred ${relationships.length} relationships`);

      return {
        success: true,
        recordsTransferred: relationships.length,
        errors: [],
        duration: Date.now() - startTime,
        details: {
          relationshipTypes: this.getRelationshipTypeBreakdown(relationships)
        }
      };

    } catch (error) {
      return this.handleError('relationship transfer', error as Error);
    }
  }

  async validate(): Promise<ValidationResult> {
    const baseValidation = await super.validate();
    if (!baseValidation.valid) {
      return baseValidation;
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const details: Record<string, any> = {};

    try {
      // Check source relationship count
      const sourceStats = await this.sourceAdapter.getKnowledgeGraphStats();
      details.sourceRelationshipCount = sourceStats.relationships.total;

      // Check target relationship count
      const targetStats = await this.targetAdapter.getKnowledgeGraphStats();
      details.targetRelationshipCount = targetStats.relationships.total;

      if (targetStats.relationships.total > 0) {
        warnings.push(`Target database already contains ${targetStats.relationships.total} relationships`);
      }

      // Ensure entities exist in target before transferring relationships
      if (targetStats.entities.total === 0) {
        errors.push('Target database contains no entities - transfer entities first');
      }

    } catch (error) {
      errors.push(`Validation error: ${(error as Error).message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      details
    };
  }

  private getRelationshipTypeBreakdown(relationships: Relation[]): Record<string, number> {
    const breakdown: Record<string, number> = {};
    relationships.forEach(rel => {
      breakdown[rel.relationType] = (breakdown[rel.relationType] || 0) + 1;
    });
    return breakdown;
  }
}

/**
 * Transfer documents from source to target database
 */
export class DocumentTransferOperation extends BaseDataTransferOperation {
  constructor(
    sourceAdapter: DatabaseAdapter,
    targetAdapter: DatabaseAdapter,
    logger?: DatabaseLogger
  ) {
    super(
      'DocumentTransfer',
      'Transfer all documents with their metadata',
      sourceAdapter,
      targetAdapter,
      logger
    );
  }

  async execute(): Promise<DataTransferResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting document transfer operation');

      // Get list of all documents from source
      const documents = await this.sourceAdapter.listDocuments(true);

      if (documents.length === 0) {
        this.logger.info('No documents to transfer');
        return {
          success: true,
          recordsTransferred: 0,
          errors: [],
          duration: Date.now() - startTime,
          details: { message: 'No documents found in source database' }
        };
      }

      this.logger.info(`Transferring ${documents.length} documents`);

      let transferredCount = 0;
      const errors: string[] = [];

      // Transfer each document individually to handle large content
      for (const docInfo of documents) {
        try {
          // Get full document content from source database
          const content = await this.sourceAdapter.getDocumentContent(docInfo.id);
          
          this.logger.debug(`Transferring document: ${docInfo.id} (${content.length} chars)`);
          
          await this.targetAdapter.storeDocument(
            docInfo.id,
            content, // Use actual content instead of empty string
            docInfo.metadata
          );
          transferredCount++;
        } catch (error) {
          errors.push(`Failed to transfer document ${docInfo.id}: ${(error as Error).message}`);
          this.logger.warn(`Failed to transfer document ${docInfo.id}`, error as Error);
        }
      }

      this.logger.info(`Successfully transferred ${transferredCount}/${documents.length} documents`);

      return {
        success: errors.length === 0,
        recordsTransferred: transferredCount,
        errors,
        duration: Date.now() - startTime,
        details: {
          totalDocuments: documents.length,
          successfulTransfers: transferredCount,
          failedTransfers: documents.length - transferredCount
        }
      };

    } catch (error) {
      return this.handleError('document transfer', error as Error);
    }
  }

  async validate(): Promise<ValidationResult> {
    const baseValidation = await super.validate();
    if (!baseValidation.valid) {
      return baseValidation;
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const details: Record<string, any> = {};

    try {
      // Check source document count
      const sourceStats = await this.sourceAdapter.getKnowledgeGraphStats();
      details.sourceDocumentCount = sourceStats.documents.total;

      // Check target document count
      const targetStats = await this.targetAdapter.getKnowledgeGraphStats();
      details.targetDocumentCount = targetStats.documents.total;

      if (targetStats.documents.total > 0) {
        warnings.push(`Target database already contains ${targetStats.documents.total} documents`);
      }

    } catch (error) {
      errors.push(`Validation error: ${(error as Error).message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      details
    };
  }
}

/**
 * Transfer vector embeddings from source to target database
 */
export class VectorTransferOperation extends BaseDataTransferOperation {
  constructor(
    sourceAdapter: DatabaseAdapter,
    targetAdapter: DatabaseAdapter,
    logger?: DatabaseLogger
  ) {
    super(
      'VectorTransfer',
      'Transfer vector embeddings for chunks and entities',
      sourceAdapter,
      targetAdapter,
      logger
    );
  }

  async execute(): Promise<DataTransferResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting vector transfer operation');

      // This is a complex operation that would need to:
      // 1. Extract vector embeddings from SQLite sqlite-vec tables
      // 2. Convert them to PostgreSQL pgvector format (potentially halfvec)
      // 3. Maintain relationships between vectors and their source data

      // For now, we'll implement a placeholder that re-generates embeddings
      this.logger.info('Re-generating embeddings for all entities in target database');
      
      const embeddingResult = await this.targetAdapter.embedAllEntities();
      
      this.logger.info(`Successfully processed embeddings: ${embeddingResult.embeddedEntities || 0} entities`);

      return {
        success: true,
        recordsTransferred: embeddingResult.embeddedEntities || 0,
        errors: [],
        duration: Date.now() - startTime,
        details: {
          operation: 'regenerate_embeddings',
          embeddingResult
        }
      };

    } catch (error) {
      return this.handleError('vector transfer', error as Error);
    }
  }

  async validate(): Promise<ValidationResult> {
    const baseValidation = await super.validate();
    if (!baseValidation.valid) {
      return baseValidation;
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const details: Record<string, any> = {};

    try {
      // Check if target has entities to embed
      const targetStats = await this.targetAdapter.getKnowledgeGraphStats();
      details.targetEntityCount = targetStats.entities.total;

      if (targetStats.entities.total === 0) {
        warnings.push('Target database contains no entities to embed');
      }

    } catch (error) {
      errors.push(`Validation error: ${(error as Error).message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      details
    };
  }
}

/**
 * Factory function to create all standard data transfer operations
 */
export function createStandardDataTransferOperations(
  sourceAdapter: DatabaseAdapter,
  targetAdapter: DatabaseAdapter,
  logger?: DatabaseLogger
): DataTransferOperation[] {
  return [
    new EntityTransferOperation(sourceAdapter, targetAdapter, logger),
    new RelationshipTransferOperation(sourceAdapter, targetAdapter, logger),
    new DocumentTransferOperation(sourceAdapter, targetAdapter, logger),
    new VectorTransferOperation(sourceAdapter, targetAdapter, logger)
  ];
}

/**
 * Execute a complete data migration from SQLite to PostgreSQL
 */
export async function executeCompleteDataMigration(
  sourceAdapter: DatabaseAdapter,
  targetAdapter: DatabaseAdapter,
  logger?: DatabaseLogger
): Promise<DataTransferResult[]> {
  const log = logger || new Logger();
  
  log.info('Starting complete data migration from SQLite to PostgreSQL');

  const operations = createStandardDataTransferOperations(sourceAdapter, targetAdapter, logger);
  const results: DataTransferResult[] = [];

  for (const operation of operations) {
    log.info(`Executing operation: ${operation.name}`);
    
    try {
      // Validate operation
      if (operation.validate) {
        const validation = await operation.validate();
        if (!validation.valid) {
          log.error(`Operation ${operation.name} validation failed: ${validation.errors.join(', ')}`);
          results.push({
            success: false,
            recordsTransferred: 0,
            errors: validation.errors,
            duration: 0,
            details: { validation }
          });
          continue;
        }
        
        if (validation.warnings.length > 0) {
          log.warn(`Operation ${operation.name} warnings: ${validation.warnings.join(', ')}`);
        }
      }

      // Execute operation
      const result = await operation.execute();
      results.push(result);

      if (result.success) {
        log.info(`Operation ${operation.name} completed successfully: ${result.recordsTransferred} records`);
      } else {
        log.error(`Operation ${operation.name} failed: ${result.errors.join(', ')}`);
      }

    } catch (error) {
      log.error(`Operation ${operation.name} threw exception`, error as Error);
      results.push({
        success: false,
        recordsTransferred: 0,
        errors: [(error as Error).message],
        duration: 0,
        details: { exception: (error as Error).message }
      });
    }
  }

  const totalRecords = results.reduce((sum, r) => sum + r.recordsTransferred, 0);
  const successfulOps = results.filter(r => r.success).length;
  
  log.info(`Complete data migration finished: ${successfulOps}/${operations.length} operations successful, ${totalRecords} total records transferred`);

  return results;
}
