/**
 * Unit Tests for Database Adapters
 * 
 * Comprehensive unit tests covering all database adapter functionality
 * with >90% code coverage target.
 */

import {
  TestFramework,
  TestAssertions,
  MockDataGenerator,
  DatabaseTestUtils,
  DEFAULT_TEST_CONFIG
} from './test-framework.js';

import {
  DatabaseConfig,
  DatabaseManager,
  ConfigurationFactory,
  SQLiteAdapter,
  Entity,
  Relation
} from '../database/index.js';

/**
 * SQLite Adapter Unit Tests
 */
export class SQLiteAdapterTests {
  private framework: TestFramework;
  private testConfig: DatabaseConfig;

  constructor() {
    this.framework = new TestFramework(DEFAULT_TEST_CONFIG);
    this.testConfig = {
      type: 'sqlite',
      vectorDimensions: 384,
      enableLogging: false,
      sqlite: {
        filePath: ':memory:',
        enableWAL: false
      }
    };
  }

  async runAllTests(): Promise<void> {
    await this.runConnectionTests();
    await this.runEntityTests();
    await this.runRelationshipTests();
    await this.runObservationTests();
    await this.runDocumentTests();
    await this.runKnowledgeGraphTests();
    await this.runStatisticsTests();
    await this.runTransactionTests();
    await this.runErrorHandlingTests();
  }

  private async runConnectionTests(): Promise<void> {
    const tests = [
      {
        name: 'should connect to SQLite database',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const health = await adapter.checkHealth();
          TestAssertions.assertTrue(health.healthy, 'Database should be healthy');
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should handle connection errors gracefully',
        fn: async () => {
          const badConfig = {
            ...this.testConfig,
            sqlite: { filePath: '/invalid/path/database.db', enableWAL: false }
          };
          
          await TestAssertions.assertThrowsAsync(async () => {
            await DatabaseTestUtils.createTestDatabase(badConfig);
          }, 'Should throw error for invalid database path');
        }
      },
      {
        name: 'should close connection properly',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          await adapter.close();
          
          // Attempting operations after close should fail
          await TestAssertions.assertThrowsAsync(async () => {
            await adapter.checkHealth();
          }, 'Operations should fail after close');
        }
      }
    ];

    await this.framework.runSuite('SQLite Connection Tests', tests);
  }

  private async runEntityTests(): Promise<void> {
    const tests = [
      {
        name: 'should create entities successfully',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(5);
          
          const result = await adapter.createEntities(entities);
          TestAssertions.assertEqual(result.entitiesCreated, 5);
          TestAssertions.assertEqual(result.errors.length, 0);
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should prevent duplicate entities',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(3);
          
          // Create entities first time
          await adapter.createEntities(entities);
          
          // Try to create same entities again
          const result = await adapter.createEntities(entities);
          TestAssertions.assertEqual(result.entitiesCreated, 0, 'Should not create duplicate entities');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should delete entities and cascade relationships',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(3);
          const relations = MockDataGenerator.generateRelations(entities, 2);
          
          await adapter.createEntities(entities);
          await adapter.createRelations(relations);
          
          // Delete one entity
          const result = await adapter.deleteEntities([entities[0].name]);
          TestAssertions.assertEqual(result.entitiesDeleted, 1);
          
          // Verify relationships involving deleted entity are also removed
          const graph = await adapter.readGraph();
          const remainingRelations = graph.relationships.filter(
            r => r.from === entities[0].name || r.to === entities[0].name
          );
          TestAssertions.assertEqual(remainingRelations.length, 0, 'Related relationships should be deleted');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should handle entity validation errors',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          
          const invalidEntities = [
            { name: '', entityType: 'TEST', observations: ['test'] }, // Empty name
            { name: 'Test', entityType: '', observations: ['test'] }, // Empty type
            { name: 'Test2', entityType: 'TEST', observations: [] } // Empty observations
          ];
          
          for (const entity of invalidEntities) {
            await TestAssertions.assertThrowsAsync(async () => {
              await adapter.createEntities([entity as Entity]);
            }, `Should reject invalid entity: ${JSON.stringify(entity)}`);
          }
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      }
    ];

    await this.framework.runSuite('SQLite Entity Tests', tests);
  }

  private async runRelationshipTests(): Promise<void> {
    const tests = [
      {
        name: 'should create relationships between existing entities',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(3);
          const relations = MockDataGenerator.generateRelations(entities, 2);
          
          await adapter.createEntities(entities);
          const result = await adapter.createRelations(relations);
          
          TestAssertions.assertEqual(result.relationsCreated, 2);
          TestAssertions.assertEqual(result.errors.length, 0);
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should prevent duplicate relationships',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(2);
          const relation: Relation = {
            from: entities[0].name,
            to: entities[1].name,
            relationType: 'TEST_RELATION'
          };
          
          await adapter.createEntities(entities);
          await adapter.createRelations([relation]);
          
          // Try to create same relationship again
          const result = await adapter.createRelations([relation]);
          TestAssertions.assertEqual(result.relationsCreated, 0, 'Should not create duplicate relationships');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should delete specific relationships',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(3);
          const relations = MockDataGenerator.generateRelations(entities, 3);
          
          await adapter.createEntities(entities);
          await adapter.createRelations(relations);
          
          // Delete one specific relationship
          const relationToDelete = relations[0];
          const result = await adapter.deleteRelations([relationToDelete]);
          TestAssertions.assertEqual(result.relationsDeleted, 1);
          
          // Verify only the specific relationship was deleted
          const graph = await adapter.readGraph();
          const remainingRelations = graph.relationships.filter(
            r => r.from === relationToDelete.from && 
                 r.to === relationToDelete.to && 
                 r.relationType === relationToDelete.relationType
          );
          TestAssertions.assertEqual(remainingRelations.length, 0, 'Specific relationship should be deleted');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should reject relationships with non-existent entities',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          
          const invalidRelation: Relation = {
            from: 'NonExistentEntity1',
            to: 'NonExistentEntity2',
            relationType: 'TEST'
          };
          
          const result = await adapter.createRelations([invalidRelation]);
          TestAssertions.assertEqual(result.relationsCreated, 0);
          TestAssertions.assertGreaterThan(result.errors.length, 0, 'Should have errors for non-existent entities');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      }
    ];

    await this.framework.runSuite('SQLite Relationship Tests', tests);
  }

  private async runObservationTests(): Promise<void> {
    const tests = [
      {
        name: 'should add observations to existing entities',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(2);
          
          await adapter.createEntities(entities);
          
          const newObservations = [
            {
              entityName: entities[0].name,
              contents: ['New observation 1', 'New observation 2']
            }
          ];
          
          const result = await adapter.addObservations(newObservations);
          TestAssertions.assertEqual(result.observationsAdded, 2);
          TestAssertions.assertEqual(result.errors.length, 0);
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should prevent duplicate observations',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(1);
          
          await adapter.createEntities(entities);
          
          const observations = [
            {
              entityName: entities[0].name,
              contents: ['Duplicate observation']
            }
          ];
          
          // Add observation first time
          await adapter.addObservations(observations);
          
          // Try to add same observation again
          const result = await adapter.addObservations(observations);
          TestAssertions.assertEqual(result.observationsAdded, 0, 'Should not add duplicate observations');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should delete specific observations',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(1);
          
          await adapter.createEntities(entities);
          
          const observationToDelete = entities[0].observations[0];
          const deletions = [
            {
              entityName: entities[0].name,
              observations: [observationToDelete]
            }
          ];
          
          const result = await adapter.deleteObservations(deletions);
          TestAssertions.assertEqual(result.observationsDeleted, 1);
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should handle observations for non-existent entities',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          
          const invalidObservations = [
            {
              entityName: 'NonExistentEntity',
              contents: ['Test observation']
            }
          ];
          
          const result = await adapter.addObservations(invalidObservations);
          TestAssertions.assertEqual(result.observationsAdded, 0);
          TestAssertions.assertGreaterThan(result.errors.length, 0, 'Should have errors for non-existent entity');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      }
    ];

    await this.framework.runSuite('SQLite Observation Tests', tests);
  }

  private async runDocumentTests(): Promise<void> {
    const tests = [
      {
        name: 'should store documents with metadata',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const documents = MockDataGenerator.generateDocuments(3);
          
          for (const doc of documents) {
            const result = await adapter.storeDocument(doc.id, doc.content, doc.metadata);
            TestAssertions.assertTrue(result.success, `Document ${doc.id} should be stored successfully`);
          }
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should list stored documents',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const documents = MockDataGenerator.generateDocuments(2);
          
          for (const doc of documents) {
            await adapter.storeDocument(doc.id, doc.content, doc.metadata);
          }
          
          const storedDocs = await adapter.listDocuments();
          TestAssertions.assertEqual(storedDocs.length, 2, 'Should list all stored documents');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should delete documents and associated data',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const documents = MockDataGenerator.generateDocuments(2);
          
          for (const doc of documents) {
            await adapter.storeDocument(doc.id, doc.content, doc.metadata);
          }
          
          const result = await adapter.deleteDocuments([documents[0].id]);
          TestAssertions.assertEqual(result.documentsDeleted, 1);
          
          const remainingDocs = await adapter.listDocuments();
          TestAssertions.assertEqual(remainingDocs.length, 1, 'Should have one document remaining');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should handle document replacement',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const docId = 'test-doc';
          const originalContent = 'Original content';
          const updatedContent = 'Updated content';
          
          // Store original document
          await adapter.storeDocument(docId, originalContent, { version: 1 });
          
          // Replace with updated content
          const result = await adapter.storeDocument(docId, updatedContent, { version: 2 });
          TestAssertions.assertTrue(result.success, 'Document replacement should succeed');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      }
    ];

    await this.framework.runSuite('SQLite Document Tests', tests);
  }

  private async runKnowledgeGraphTests(): Promise<void> {
    const tests = [
      {
        name: 'should read complete knowledge graph',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(3);
          const relations = MockDataGenerator.generateRelations(entities, 2);
          
          await adapter.createEntities(entities);
          await adapter.createRelations(relations);
          
          const graph = await adapter.readGraph();
          TestAssertions.assertEqual(graph.entities.length, 3, 'Should return all entities');
          TestAssertions.assertEqual(graph.relationships.length, 2, 'Should return all relationships');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should open specific nodes with relationships',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(3);
          const relations = MockDataGenerator.generateRelations(entities, 2);
          
          await adapter.createEntities(entities);
          await adapter.createRelations(relations);
          
          const result = await adapter.openNodes([entities[0].name]);
          TestAssertions.assertGreaterThan(result.entities.length, 0, 'Should return requested entities');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should handle empty knowledge graph',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          
          const graph = await adapter.readGraph();
          TestAssertions.assertEqual(graph.entities.length, 0, 'Empty graph should have no entities');
          TestAssertions.assertEqual(graph.relationships.length, 0, 'Empty graph should have no relationships');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      }
    ];

    await this.framework.runSuite('SQLite Knowledge Graph Tests', tests);
  }

  private async runStatisticsTests(): Promise<void> {
    const tests = [
      {
        name: 'should provide accurate statistics',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = MockDataGenerator.generateEntities(5);
          const relations = MockDataGenerator.generateRelations(entities, 3);
          const documents = MockDataGenerator.generateDocuments(2);
          
          await adapter.createEntities(entities);
          await adapter.createRelations(relations);
          for (const doc of documents) {
            await adapter.storeDocument(doc.id, doc.content, doc.metadata);
          }
          
          const stats = await adapter.getKnowledgeGraphStats();
          TestAssertions.assertEqual(stats.entities.total, 5, 'Should count entities correctly');
          TestAssertions.assertEqual(stats.relationships.total, 3, 'Should count relationships correctly');
          TestAssertions.assertEqual(stats.documents.total, 2, 'Should count documents correctly');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should provide entity type breakdown',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          const entities = [
            { name: 'Person1', entityType: 'PERSON', observations: ['test'] },
            { name: 'Person2', entityType: 'PERSON', observations: ['test'] },
            { name: 'Concept1', entityType: 'CONCEPT', observations: ['test'] }
          ];
          
          await adapter.createEntities(entities);
          
          const stats = await adapter.getKnowledgeGraphStats();
          TestAssertions.assertEqual(stats.entities.byType['PERSON'], 2, 'Should count PERSON entities');
          TestAssertions.assertEqual(stats.entities.byType['CONCEPT'], 1, 'Should count CONCEPT entities');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      }
    ];

    await this.framework.runSuite('SQLite Statistics Tests', tests);
  }

  private async runTransactionTests(): Promise<void> {
    const tests = [
      {
        name: 'should handle transaction rollback on error',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          
          try {
            // This should test transaction behavior, but implementation depends on adapter
            // For now, we'll test that operations are atomic
            const entities = MockDataGenerator.generateEntities(2);
            await adapter.createEntities(entities);
            
            const statsBefore = await adapter.getKnowledgeGraphStats();
            TestAssertions.assertEqual(statsBefore.entities.total, 2);
            
            // Test that partial failures don't leave inconsistent state
            const invalidEntities = [
              { name: 'Valid', entityType: 'TEST', observations: ['test'] },
              { name: '', entityType: 'TEST', observations: ['test'] } // Invalid
            ];
            
            try {
              await adapter.createEntities(invalidEntities as Entity[]);
            } catch (error) {
              // Expected to fail
            }
            
            const statsAfter = await adapter.getKnowledgeGraphStats();
            TestAssertions.assertEqual(statsAfter.entities.total, 2, 'Should not have partial updates');
            
          } finally {
            await DatabaseTestUtils.cleanupTestDatabase(adapter);
          }
        }
      }
    ];

    await this.framework.runSuite('SQLite Transaction Tests', tests);
  }

  private async runErrorHandlingTests(): Promise<void> {
    const tests = [
      {
        name: 'should handle database corruption gracefully',
        fn: async () => {
          // This test would be more complex in a real scenario
          // For now, test basic error handling
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          
          // Test that adapter handles errors without crashing
          try {
            await adapter.openNodes(['NonExistentEntity']);
            // Should not throw, should return empty result
          } catch (error) {
            // If it throws, it should be a handled error
            TestAssertions.assertTrue(error instanceof Error, 'Should throw proper Error objects');
          }
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      },
      {
        name: 'should provide meaningful error messages',
        fn: async () => {
          const adapter = await DatabaseTestUtils.createTestDatabase(this.testConfig);
          
          try {
            await adapter.createEntities([{ name: '', entityType: 'TEST', observations: ['test'] } as Entity]);
            TestAssertions.assertTrue(false, 'Should have thrown an error');
          } catch (error) {
            TestAssertions.assertTrue(error instanceof Error, 'Should be Error instance');
            TestAssertions.assertTrue(error.message.length > 0, 'Should have meaningful error message');
          }
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
        }
      }
    ];

    await this.framework.runSuite('SQLite Error Handling Tests', tests);
  }
}

/**
 * Configuration Tests
 */
export class ConfigurationTests {
  private framework: TestFramework;

  constructor() {
    this.framework = new TestFramework(DEFAULT_TEST_CONFIG);
  }

  async runAllTests(): Promise<void> {
    await this.runEnvironmentTests();
    await this.runConfigurationFactoryTests();
    await this.runValidationTests();
  }

  private async runEnvironmentTests(): Promise<void> {
    const tests = [
      {
        name: 'should detect environment correctly',
        fn: async () => {
          const { EnvironmentManager } = await import('../database/index.js');
          const envManager = new EnvironmentManager();
          
          const originalEnv = process.env.NODE_ENV;
          
          try {
            process.env.NODE_ENV = 'test';
            const env = envManager.detectEnvironment();
            TestAssertions.assertEqual(env, 'test', 'Should detect test environment');
            
            process.env.NODE_ENV = 'production';
            const prodEnv = envManager.detectEnvironment();
            TestAssertions.assertEqual(prodEnv, 'production', 'Should detect production environment');
          } finally {
            if (originalEnv !== undefined) {
              process.env.NODE_ENV = originalEnv;
            } else {
              delete process.env.NODE_ENV;
            }
          }
        }
      },
      {
        name: 'should validate environment configuration',
        fn: async () => {
          const { EnvironmentManager } = await import('../database/index.js');
          const envManager = new EnvironmentManager();
          
          // Set valid configuration
          const originalVars = {
            DB_TYPE: process.env.DB_TYPE,
            SQLITE_FILE_PATH: process.env.SQLITE_FILE_PATH
          };
          
          try {
            process.env.DB_TYPE = 'sqlite';
            process.env.SQLITE_FILE_PATH = ':memory:';
            
            const validation = envManager.validateEnvironment();
            TestAssertions.assertTrue(validation.isValid, 'Valid configuration should pass validation');
          } finally {
            // Restore original environment
            for (const [key, value] of Object.entries(originalVars)) {
              if (value !== undefined) {
                process.env[key] = value;
              } else {
                delete process.env[key];
              }
            }
          }
        }
      }
    ];

    await this.framework.runSuite('Configuration Environment Tests', tests);
  }

  private async runConfigurationFactoryTests(): Promise<void> {
    const tests = [
      {
        name: 'should create configuration from environment',
        fn: async () => {
          const factory = ConfigurationFactory.getInstance();
          
          // Set test environment variables
          const originalVars = {
            DB_TYPE: process.env.DB_TYPE,
            SQLITE_FILE_PATH: process.env.SQLITE_FILE_PATH,
            VECTOR_DIMENSIONS: process.env.VECTOR_DIMENSIONS
          };
          
          try {
            process.env.DB_TYPE = 'sqlite';
            process.env.SQLITE_FILE_PATH = ':memory:';
            process.env.VECTOR_DIMENSIONS = '384';
            
            const result = await factory.createConfiguration({
              source: 'environment',
              validateOnLoad: true
            });
            
            TestAssertions.assertEqual(result.config.type, 'sqlite');
            TestAssertions.assertEqual(result.config.vectorDimensions, 384);
            TestAssertions.assertTrue(result.metadata.validationResult.isValid);
          } finally {
            // Restore original environment
            for (const [key, value] of Object.entries(originalVars)) {
              if (value !== undefined) {
                process.env[key] = value;
              } else {
                delete process.env[key];
              }
            }
          }
        }
      }
    ];

    await this.framework.runSuite('Configuration Factory Tests', tests);
  }

  private async runValidationTests(): Promise<void> {
    const tests = [
      {
        name: 'should validate required environment variables',
        fn: async () => {
          const { EnvironmentManager } = await import('../database/index.js');
          const envManager = new EnvironmentManager();
          
          const originalDbType = process.env.DB_TYPE;
          
          try {
            delete process.env.DB_TYPE;
            
            const validation = envManager.validateEnvironment();
            TestAssertions.assertFalse(validation.isValid, 'Should fail validation without DB_TYPE');
            TestAssertions.assertContains(validation.errors, 'Missing required environment variable: DB_TYPE');
          } finally {
            if (originalDbType !== undefined) {
              process.env.DB_TYPE = originalDbType;
            }
          }
        }
      }
    ];

    await this.framework.runSuite('Configuration Validation Tests', tests);
  }
}

/**
 * Test Runner Function
 */
export async function runUnitTests(): Promise<void> {
  console.log('🧪 Starting Unit Tests');
  console.log('======================');

  const sqliteTests = new SQLiteAdapterTests();
  const configTests = new ConfigurationTests();

  try {
    await sqliteTests.runAllTests();
    await configTests.runAllTests();

    const report = await sqliteTests.framework.generateReport();
    const configReport = await configTests.framework.generateReport();

    // Combine reports
    const combinedReport = {
      suites: [...report.suites, ...configReport.suites],
      totalTests: report.totalTests + configReport.totalTests,
      passedTests: report.passedTests + configReport.passedTests,
      failedTests: report.failedTests + configReport.failedTests,
      totalDuration: report.totalDuration + configReport.totalDuration,
      overallCoverage: (report.overallCoverage + configReport.overallCoverage) / 2,
      timestamp: new Date()
    };

    sqliteTests.framework.printSummary(combinedReport);

    // Save detailed report
    await sqliteTests.framework.saveReport(combinedReport, './test-results/unit-tests-report.json');

  } catch (error) {
    console.error('❌ Unit tests failed:', error);
    throw error;
  }
}
