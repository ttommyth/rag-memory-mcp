/**
 * SQLite Adapter Core Operations
 * 
 * Core database operations with proper null handling and TypeScript safety.
 */

import Database from 'better-sqlite3';
import {
  Entity,
  Relation,
  KnowledgeGraph,
  KnowledgeGraphStats,
  DocumentInfo,
  ObservationAddition,
  ObservationDeletion,
  DatabaseLogger
} from './interfaces.js';

/**
 * Core SQLite operations with proper error handling
 */
export class SQLiteAdapterCore {
  constructor(
    private db: Database.Database,
    private logger: DatabaseLogger
  ) {}

  /**
   * Create entities with proper error handling
   */
  async createEntities(entities: Entity[]): Promise<Entity[]> {
    this.logger.debug(`Creating ${entities.length} entities`);
    
    const insertEntity = this.db.prepare(`
      INSERT OR REPLACE INTO entities (id, name, entityType, observations, mentions, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((entities: Entity[]) => {
      for (const entity of entities) {
        const entityId = `entity_${entity.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
        insertEntity.run(
          entityId,
          entity.name,
          entity.entityType,
          JSON.stringify(entity.observations),
          0,
          JSON.stringify({}),
          new Date().toISOString()
        );
      }
    });

    try {
      transaction(entities);
      this.logger.info(`Successfully created ${entities.length} entities`);
      return entities;
    } catch (error) {
      this.logger.error('Failed to create entities', error as Error);
      throw error;
    }
  }

  /**
   * Delete entities with proper cleanup
   */
  async deleteEntities(entityNames: string[]): Promise<void> {
    this.logger.debug(`Deleting ${entityNames.length} entities`);
    
    const deleteEntity = this.db.prepare(`DELETE FROM entities WHERE name = ?`);
    const deleteRelationsBySource = this.db.prepare(`DELETE FROM relationships WHERE source_entity IN (SELECT id FROM entities WHERE name = ?)`);
    const deleteRelationsByTarget = this.db.prepare(`DELETE FROM relationships WHERE target_entity IN (SELECT id FROM entities WHERE name = ?)`);

    const transaction = this.db.transaction((entityNames: string[]) => {
      for (const entityName of entityNames) {
        // Delete relationships first
        deleteRelationsBySource.run(entityName);
        deleteRelationsByTarget.run(entityName);
        
        // Delete the entity
        deleteEntity.run(entityName);
      }
    });

    try {
      transaction(entityNames);
      this.logger.info(`Successfully deleted ${entityNames.length} entities`);
    } catch (error) {
      this.logger.error('Failed to delete entities', error as Error);
      throw error;
    }
  }

  /**
   * Create relations with proper validation
   */
  async createRelations(relations: Relation[]): Promise<void> {
    this.logger.debug(`Creating ${relations.length} relations`);
    
    const insertRelation = this.db.prepare(`
      INSERT OR REPLACE INTO relationships (id, source_entity, target_entity, relationType, confidence, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const getEntityId = this.db.prepare('SELECT id FROM entities WHERE name = ?');

    const transaction = this.db.transaction((relations: Relation[]) => {
      for (const relation of relations) {
        // Get entity IDs with null checks
        const sourceResult = getEntityId.get(relation.from);
        const targetResult = getEntityId.get(relation.to);
        
        if (!sourceResult) {
          this.logger.warn(`Source entity not found: ${relation.from}`);
          continue;
        }
        
        if (!targetResult) {
          this.logger.warn(`Target entity not found: ${relation.to}`);
          continue;
        }

        const sourceEntity = sourceResult as { id: string };
        const targetEntity = targetResult as { id: string };
        const relationId = `${sourceEntity.id}-${relation.relationType}-${targetEntity.id}`;
        
        insertRelation.run(
          relationId,
          sourceEntity.id,
          targetEntity.id,
          relation.relationType,
          1.0,
          JSON.stringify({}),
          new Date().toISOString()
        );
      }
    });

    try {
      transaction(relations);
      this.logger.info(`Successfully created ${relations.length} relations`);
    } catch (error) {
      this.logger.error('Failed to create relations', error as Error);
      throw error;
    }
  }

  /**
   * Read complete knowledge graph
   */
  async readGraph(): Promise<KnowledgeGraph> {
    this.logger.debug('Reading complete knowledge graph');
    
    try {
      const entityRows = this.db.prepare(`
        SELECT id, name, entityType, observations, mentions, metadata, created_at 
        FROM entities
      `).all();
      
      const relationRows = this.db.prepare(`
        SELECT r.id, r.relationType, r.confidence, r.metadata, r.created_at,
               e1.name as source_name, e2.name as target_name
        FROM relationships r
        JOIN entities e1 ON r.source_entity = e1.id
        JOIN entities e2 ON r.target_entity = e2.id
      `).all();

      const entities: Entity[] = (entityRows as any[]).map(row => ({
        name: row.name,
        entityType: row.entityType,
        observations: JSON.parse(row.observations || '[]')
      }));

      const relations: Relation[] = (relationRows as any[]).map(row => ({
        from: row.source_name,
        to: row.target_name,
        relationType: row.relationType
      }));

      this.logger.info(`Retrieved complete graph: ${entities.length} entities, ${relations.length} relations`);
      
      return { entities, relations };
    } catch (error) {
      this.logger.error('Failed to read graph', error as Error);
      throw error;
    }
  }

  /**
   * Get knowledge graph statistics
   */
  async getKnowledgeGraphStats(): Promise<KnowledgeGraphStats> {
    this.logger.debug('Getting knowledge graph statistics');
    
    try {
      // Get counts with proper null handling
      const entityCount = this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number } | undefined;
      const relationCount = this.db.prepare('SELECT COUNT(*) as count FROM relationships').get() as { count: number } | undefined;
      const documentCount = this.db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number } | undefined;
      const chunkCount = this.db.prepare('SELECT COUNT(*) as count FROM chunk_metadata').get() as { count: number } | undefined;

      // Get type breakdowns
      const entityTypes = this.db.prepare(`
        SELECT entityType, COUNT(*) as count
        FROM entities 
        GROUP BY entityType
      `).all() as any[];

      const relationTypes = this.db.prepare(`
        SELECT relationType, COUNT(*) as count
        FROM relationships 
        GROUP BY relationType
      `).all() as any[];

      const entityTypeBreakdown: Record<string, number> = {};
      entityTypes.forEach(stat => {
        entityTypeBreakdown[stat.entityType] = stat.count;
      });

      const relationTypeBreakdown: Record<string, number> = {};
      relationTypes.forEach(stat => {
        relationTypeBreakdown[stat.relationType] = stat.count;
      });

      const stats: KnowledgeGraphStats = {
        entities: {
          total: entityCount?.count || 0,
          byType: entityTypeBreakdown
        },
        relationships: {
          total: relationCount?.count || 0,
          byType: relationTypeBreakdown
        },
        documents: {
          total: documentCount?.count || 0
        },
        chunks: {
          total: chunkCount?.count || 0,
          embedded: 0
        }
      };

      this.logger.info(`Statistics: ${stats.entities.total} entities, ${stats.relationships.total} relations`);
      
      return stats;
    } catch (error) {
      this.logger.error('Failed to get statistics', error as Error);
      throw error;
    }
  }

  /**
   * Store document
   */
  async storeDocument(id: string, content: string, metadata?: Record<string, any>): Promise<void> {
    this.logger.debug(`Storing document: ${id}`);
    
    const insertDocument = this.db.prepare(`
      INSERT OR REPLACE INTO documents (id, content, metadata, created_at)
      VALUES (?, ?, ?, ?)
    `);

    try {
      insertDocument.run(
        id,
        content,
        JSON.stringify(metadata || {}),
        new Date().toISOString()
      );
      
      this.logger.info(`Successfully stored document: ${id}`);
    } catch (error) {
      this.logger.error(`Failed to store document: ${id}`, error as Error);
      throw error;
    }
  }

  /**
   * List documents
   */
  async listDocuments(includeMetadata?: boolean): Promise<DocumentInfo[]> {
    this.logger.debug('Listing documents');
    
    try {
      const query = includeMetadata 
        ? 'SELECT id, metadata, created_at FROM documents'
        : 'SELECT id, created_at FROM documents';
        
      const rows = this.db.prepare(query).all() as any[];
      
      const documents: DocumentInfo[] = rows.map(row => ({
        id: row.id,
        metadata: includeMetadata ? JSON.parse(row.metadata || '{}') : undefined,
        created_at: row.created_at
      }));
      
      this.logger.info(`Retrieved ${documents.length} documents`);
      return documents;
    } catch (error) {
      this.logger.error('Failed to list documents', error as Error);
      throw error;
    }
  }

  /**
   * Add observations to entities
   */
  async addObservations(observations: ObservationAddition[]): Promise<void> {
    this.logger.debug(`Adding observations to ${observations.length} entities`);
    
    const getEntity = this.db.prepare('SELECT id, observations FROM entities WHERE name = ?');
    const updateEntity = this.db.prepare('UPDATE entities SET observations = ? WHERE name = ?');

    const transaction = this.db.transaction((observations: ObservationAddition[]) => {
      for (const obs of observations) {
        const entityResult = getEntity.get(obs.entityName);
        
        if (entityResult) {
          const entity = entityResult as { id: string; observations: string };
          const existingObs = JSON.parse(entity.observations || '[]') as string[];
          const newObs = obs.contents.filter(content => !existingObs.includes(content));
          const updatedObs = [...existingObs, ...newObs];
          
          updateEntity.run(JSON.stringify(updatedObs), obs.entityName);
        } else {
          this.logger.warn(`Entity not found: ${obs.entityName}`);
        }
      }
    });

    try {
      transaction(observations);
      this.logger.info(`Successfully added observations to ${observations.length} entities`);
    } catch (error) {
      this.logger.error('Failed to add observations', error as Error);
      throw error;
    }
  }

  /**
   * Delete observations from entities
   */
  async deleteObservations(deletions: ObservationDeletion[]): Promise<void> {
    this.logger.debug(`Deleting observations from ${deletions.length} entities`);
    
    const getEntity = this.db.prepare('SELECT id, observations FROM entities WHERE name = ?');
    const updateEntity = this.db.prepare('UPDATE entities SET observations = ? WHERE name = ?');

    const transaction = this.db.transaction((deletions: ObservationDeletion[]) => {
      for (const deletion of deletions) {
        const entityResult = getEntity.get(deletion.entityName);
        
        if (entityResult) {
          const entity = entityResult as { id: string; observations: string };
          const existingObs = JSON.parse(entity.observations || '[]') as string[];
          const updatedObs = existingObs.filter(obs => !deletion.observations.includes(obs));
          
          updateEntity.run(JSON.stringify(updatedObs), deletion.entityName);
        } else {
          this.logger.warn(`Entity not found: ${deletion.entityName}`);
        }
      }
    });

    try {
      transaction(deletions);
      this.logger.info(`Successfully deleted observations from ${deletions.length} entities`);
    } catch (error) {
      this.logger.error('Failed to delete observations', error as Error);
      throw error;
    }
  }

  /**
   * Delete relations
   */
  async deleteRelations(relations: Relation[]): Promise<void> {
    this.logger.debug(`Deleting ${relations.length} relations`);
    
    const deleteRelation = this.db.prepare(`
      DELETE FROM relationships 
      WHERE source_entity = (SELECT id FROM entities WHERE name = ?) 
        AND target_entity = (SELECT id FROM entities WHERE name = ?) 
        AND relationType = ?
    `);

    const transaction = this.db.transaction((relations: Relation[]) => {
      for (const relation of relations) {
        deleteRelation.run(relation.from, relation.to, relation.relationType);
      }
    });

    try {
      transaction(relations);
      this.logger.info(`Successfully deleted ${relations.length} relations`);
    } catch (error) {
      this.logger.error('Failed to delete relations', error as Error);
      throw error;
    }
  }

  /**
   * Open specific nodes with their relationships
   */
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    this.logger.debug(`Opening ${names.length} nodes`);
    
    if (names.length === 0) {
      return { entities: [], relations: [] };
    }
    
    try {
      const placeholders = names.map(() => '?').join(',');
      
      const entityRows = this.db.prepare(`
        SELECT id, name, entityType, observations, mentions, metadata, created_at 
        FROM entities 
        WHERE name IN (${placeholders})
      `).all(...names);
      
      const relationRows = this.db.prepare(`
        SELECT r.id, r.relationType, r.confidence, r.metadata, r.created_at,
               e1.name as source_name, e2.name as target_name
        FROM relationships r
        JOIN entities e1 ON r.source_entity = e1.id
        JOIN entities e2 ON r.target_entity = e2.id
        WHERE e1.name IN (${placeholders}) 
           OR e2.name IN (${placeholders})
      `).all(...names, ...names);

      const entities: Entity[] = (entityRows as any[]).map(row => ({
        name: row.name,
        entityType: row.entityType,
        observations: JSON.parse(row.observations || '[]')
      }));

      const relations: Relation[] = (relationRows as any[]).map(row => ({
        from: row.source_name,
        to: row.target_name,
        relationType: row.relationType
      }));

      this.logger.info(`Retrieved ${entities.length} entities and ${relations.length} relations`);
      
      return { entities, relations };
    } catch (error) {
      this.logger.error('Failed to open nodes', error as Error);
      throw error;
    }
  }
}
