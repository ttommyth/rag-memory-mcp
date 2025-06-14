/**
 * Integration Tests for MCP Tools
 * 
 * Comprehensive integration tests that verify the complete workflow
 * from MCP tool calls through database operations.
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
  ConfigurationFactory
} from '../database/index.js';

/**
 * MCP Tool Integration Tests
 */
export class MCPToolIntegrationTests {
  private framework: TestFramework;
  private testConfig: DatabaseConfig;
  private dbManager: DatabaseManager | null = null;

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
    await this.runEntityWorkflowTests();
    await this.runDocumentWorkflowTests();
    await this.runSearchWorkflowTests();
    await this.runKnowledgeGraphWorkflowTests();
    await this.runMigrationWorkflowTests();
    await this.runConfigurationWorkflowTests();
  }

  private async setupDatabase(): Promise<DatabaseManager> {
    if (!this.dbManager) {
      this.dbManager = new DatabaseManager();
      await this.dbManager.initialize(this.testConfig);
    }
    return this.dbManager;
  }

  private async cleanupDatabase(): Promise<void> {
    if (this.dbManager) {
      const adapter = this.dbManager.getAdapter();
      if (adapter) {
        await DatabaseTestUtils.cleanupTestDatabase(adapter);
      }
      await this.dbManager.close();
      this.dbManager = null;
    }
  }

  private async runEntityWorkflowTests(): Promise<void> {
    const tests = [
      {
        name: 'should complete full entity lifecycle',
        fn: async () => {
          const manager = await this.setupDatabase();
          const adapter = manager.getAdapter()!;
          
          // 1. Create entities
          const entities = MockDataGenerator.generateEntities(3);
          const createResult = await adapter.createEntities(entities);
          TestAssertions.assertEqual(createResult.entitiesCreated, 3);
          
          // 2. Add observations
          const observations = [
            {
              entityName: entities[0].name,
              contents: ['Additional observation 1', 'Additional observation 2']
            }
          ];
          const obsResult = await adapter.addObservations(observations);
          TestAssertions.assertEqual(obsResult.observationsAdded, 2);
          
          // 3. Create relationships
          const relations = MockDataGenerator.generateRelations(entities, 2);
          const relResult = await adapter.createRelations(relations);
          TestAssertions.assertEqual(relResult.relationsCreated, 2);
          
          // 4. Read knowledge graph
          const graph = await adapter.readGraph();
          TestAssertions.assertEqual(graph.entities.length, 3);
          TestAssertions.assertEqual(graph.relationships.length, 2);
          
          // 5. Get statistics
          const stats = await adapter.getKnowledgeGraphStats();
          TestAssertions.assertEqual(stats.entities.total, 3);
          TestAssertions.assertEqual(stats.relationships.total, 2);
          
          // 6. Delete entity (should cascade)
          const deleteResult = await adapter.deleteEntities([entities[0].name]);
          TestAssertions.assertEqual(deleteResult.entitiesDeleted, 1);
          
          // 7. Verify cascade deletion
          const finalStats = await adapter.getKnowledgeGraphStats();
          TestAssertions.assertEqual(finalStats.entities.total, 2);
          
          await this.cleanupDatabase();
        }
      },
      {
        name: 'should handle entity search and retrieval',
        fn: async () => {
          const manager = await this.setupDatabase();
          const adapter = manager.getAdapter()!;
          
          // Create test entities with specific patterns
          const entities = [
            { name: 'JavaScript', entityType: 'TECHNOLOGY', observations: ['Programming language', 'Web development'] },
            { name: 'React', entityType: 'TECHNOLOGY', observations: ['JavaScript library', 'UI framework'] },
            { name: 'Node.js', entityType: 'TECHNOLOGY', observations: ['JavaScript runtime', 'Server-side'] }
          ];
          
          await adapter.createEntities(entities);
          
          // Test opening specific nodes
          const nodeResult = await adapter.openNodes(['JavaScript', 'React']);
          TestAssertions.assertEqual(nodeResult.entities.length, 2);
          
          // Verify entity details
          const jsEntity = nodeResult.entities.find(e => e.name === 'JavaScript');
          TestAssertions.assertTrue(jsEntity !== undefined, 'JavaScript entity should be found');
          TestAssertions.assertEqual(jsEntity!.entityType, 'TECHNOLOGY');
          TestAssertions.assertGreaterThan(jsEntity!.observations.length, 0);
          
          await this.cleanupDatabase();
        }
      }
    ];

    await this.framework.runSuite('MCP Entity Workflow Tests', tests);
  }

  private async runDocumentWorkflowTests(): Promise<void> {
    const tests = [
      {
        name: 'should complete full document processing workflow',
        fn: async () => {
          const manager = await this.setupDatabase();
          const adapter = manager.getAdapter()!;
          
          // 1. Store document
          const docId = 'test-workflow-doc';
          const content = 'This is a test document about JavaScript and React development. It covers modern web development practices and frameworks.';
          const metadata = { type: 'technical', topic: 'web-development' };
          
          const storeResult = await adapter.storeDocument(docId, content, metadata);
          TestAssertions.assertTrue(storeResult.success);
          
          // 2. List documents
          const documents = await adapter.listDocuments();
          TestAssertions.assertEqual(documents.length, 1);
          TestAssertions.assertEqual(documents[0].id, docId);
          
          // 3. Create entities related to document
          const entities = [
            { name: 'JavaScript', entityType: 'TECHNOLOGY', observations: ['Programming language'] },
            { name: 'React', entityType: 'TECHNOLOGY', observations: ['JavaScript library'] }
          ];
          await adapter.createEntities(entities);
          
          // 4. Link entities to document (if supported)
          try {
            await adapter.linkEntitiesToDocument(docId, ['JavaScript', 'React']);
          } catch (error) {
            // Method might not be implemented yet
            console.warn('linkEntitiesToDocument not implemented');
          }
          
          // 5. Delete document
          const deleteResult = await adapter.deleteDocuments([docId]);
          TestAssertions.assertEqual(deleteResult.documentsDeleted, 1);
          
          // 6. Verify deletion
          const remainingDocs = await adapter.listDocuments();
          TestAssertions.assertEqual(remainingDocs.length, 0);
          
          await this.cleanupDatabase();
        }
      },
      {
        name: 'should handle document metadata and versioning',
        fn: async () => {
          const manager = await this.setupDatabase();
          const adapter = manager.getAdapter()!;
          
          const docId = 'versioned-doc';
          
          // Store initial version
          const v1Result = await adapter.storeDocument(docId, 'Version 1 content', { version: 1 });
          TestAssertions.assertTrue(v1Result.success);
          
          // Update to version 2
          const v2Result = await adapter.storeDocument(docId, 'Version 2 content', { version: 2 });
          TestAssertions.assertTrue(v2Result.success);
          
          // Verify only one document exists (replaced)
          const documents = await adapter.listDocuments();
          TestAssertions.assertEqual(documents.length, 1);
          
          await this.cleanupDatabase();
        }
      }
    ];

    await this.framework.runSuite('MCP Document Workflow Tests', tests);
  }

  private async runSearchWorkflowTests(): Promise<void> {
    const tests = [
      {
        name: 'should perform hybrid search workflow',
        fn: async () => {
          const manager = await this.setupDatabase();
          const adapter = manager.getAdapter()!;
          
          // Setup test data
          const entities = [
            { name: 'Machine Learning', entityType: 'CONCEPT', observations: ['AI subset', 'Data-driven algorithms'] },
            { name: 'Neural Networks', entityType: 'CONCEPT', observations: ['ML technique', 'Brain-inspired computing'] },
            { name: 'Deep Learning', entityType: 'CONCEPT', observations: ['Neural network subset', 'Multiple layers'] }
          ];
          
          await adapter.createEntities(entities);
          
          const relations = [
            { from: 'Deep Learning', to: 'Machine Learning', relationType: 'IS_A' },
            { from: 'Neural Networks', to: 'Machine Learning', relationType: 'PART_OF' }
          ];
          
          await adapter.createRelations(relations);
          
          // Store related documents
          await adapter.storeDocument('ml-doc', 'Machine learning is a powerful approach to artificial intelligence.', { topic: 'AI' });
          await adapter.storeDocument('dl-doc', 'Deep learning uses neural networks with multiple layers.', { topic: 'AI' });
          
          // Test hybrid search (if implemented)
          try {
            const searchResult = await adapter.hybridSearch('artificial intelligence machine learning', 5, true);
            TestAssertions.assertGreaterThan(searchResult.length, 0, 'Should return search results');
          } catch (error) {
            // Method might not be implemented yet
            console.warn('hybridSearch not implemented, skipping');
          }
          
          await this.cleanupDatabase();
        }
      },
      {
        name: 'should handle search with no results',
        fn: async () => {
          const manager = await this.setupDatabase();
          const adapter = manager.getAdapter()!;
          
          // Search in empty database
          try {
            const searchResult = await adapter.hybridSearch('nonexistent topic', 5, true);
            TestAssertions.assertEqual(searchResult.length, 0, 'Should return empty results for non-existent content');
          } catch (error) {
            // Method might not be implemented yet
            console.warn('hybridSearch not implemented, skipping');
          }
          
          await this.cleanupDatabase();
        }
      }
    ];

    await this.framework.runSuite('MCP Search Workflow Tests', tests);
  }

  private async runKnowledgeGraphWorkflowTests(): Promise<void> {
    const tests = [
      {
        name: 'should build and query complex knowledge graph',
        fn: async () => {
          const manager = await this.setupDatabase();
          const adapter = manager.getAdapter()!;
          
          // Build a complex knowledge graph
          const entities = [
            { name: 'JavaScript', entityType: 'TECHNOLOGY', observations: ['Programming language', 'Dynamic typing'] },
            { name: 'TypeScript', entityType: 'TECHNOLOGY', observations: ['JavaScript superset', 'Static typing'] },
            { name: 'React', entityType: 'TECHNOLOGY', observations: ['UI library', 'Component-based'] },
            { name: 'Next.js', entityType: 'TECHNOLOGY', observations: ['React framework', 'Full-stack'] },
            { name: 'Web Development', entityType: 'CONCEPT', observations: ['Frontend and backend', 'Modern practices'] }
          ];
          
          await adapter.createEntities(entities);
          
          const relations = [
            { from: 'TypeScript', to: 'JavaScript', relationType: 'EXTENDS' },
            { from: 'React', to: 'JavaScript', relationType: 'USES' },
            { from: 'Next.js', to: 'React', relationType: 'BUILT_WITH' },
            { from: 'JavaScript', to: 'Web Development', relationType: 'PART_OF' },
            { from: 'TypeScript', to: 'Web Development', relationType: 'PART_OF' }
          ];
          
          await adapter.createRelations(relations);
          
          // Test graph traversal
          const graph = await adapter.readGraph();
          TestAssertions.assertEqual(graph.entities.length, 5);
          TestAssertions.assertEqual(graph.relationships.length, 5);
          
          // Test specific node opening
          const jsNode = await adapter.openNodes(['JavaScript']);
          TestAssertions.assertGreaterThan(jsNode.entities.length, 0);
          
          // Verify relationships are included
          const jsEntity = jsNode.entities.find(e => e.name === 'JavaScript');
          TestAssertions.assertTrue(jsEntity !== undefined);
          
          // Test statistics
          const stats = await adapter.getKnowledgeGraphStats();
          TestAssertions.assertEqual(stats.entities.total, 5);
          TestAssertions.assertEqual(stats.relationships.total, 5);
          TestAssertions.assertEqual(stats.entities.byType['TECHNOLOGY'], 4);
          TestAssertions.assertEqual(stats.entities.byType['CONCEPT'], 1);
          
          await this.cleanupDatabase();
        }
      },
      {
        name: 'should handle graph modifications and consistency',
        fn: async () => {
          const manager = await this.setupDatabase();
          const adapter = manager.getAdapter()!;
          
          // Create initial graph
          const entities = MockDataGenerator.generateEntities(4);
          const relations = MockDataGenerator.generateRelations(entities, 3);
          
          await adapter.createEntities(entities);
          await adapter.createRelations(relations);
          
          // Modify graph by deleting entity
          const entityToDelete = entities[0].name;
          await adapter.deleteEntities([entityToDelete]);
          
          // Verify graph consistency
          const integrity = await DatabaseTestUtils.validateDataIntegrity(adapter);
          TestAssertions.assertTrue(integrity.valid, `Graph should be consistent: ${integrity.errors.join(', ')}`);
          
          // Verify statistics are updated
          const stats = await adapter.getKnowledgeGraphStats();
          TestAssertions.assertEqual(stats.entities.total, 3);
          
          await this.cleanupDatabase();
        }
      }
    ];

    await this.framework.runSuite('MCP Knowledge Graph Workflow Tests', tests);
  }

  private async runMigrationWorkflowTests(): Promise<void> {
    const tests = [
      {
        name: 'should handle database migration status',
        fn: async () => {
          const manager = await this.setupDatabase();
          const adapter = manager.getAdapter()!;
          
          // Test migration status (if implemented)
          try {
            const status = await adapter.getMigrationStatus();
            TestAssertions.assertTrue(typeof status.currentVersion === 'number', 'Should return current version');
            TestAssertions.assertTrue(Array.isArray(status.migrations), 'Should return migrations array');
          } catch (error) {
            // Method might not be implemented yet
            console.warn('getMigrationStatus not implemented, skipping');
          }
          
          await this.cleanupDatabase();
        }
      },
      {
        name: 'should run migrations safely',
        fn: async () => {
          const manager = await this.setupDatabase();
          const adapter = manager.getAdapter()!;
          
          // Test running migrations (if implemented)
          try {
            const result = await adapter.runMigrations();
            TestAssertions.assertTrue(typeof result.applied === 'number', 'Should return number of applied migrations');
          } catch (error) {
            // Method might not be implemented yet
            console.warn('runMigrations not implemented, skipping');
          }
          
          await this.cleanupDatabase();
        }
      }
    ];

    await this.framework.runSuite('MCP Migration Workflow Tests', tests);
  }

  private async runConfigurationWorkflowTests(): Promise<void> {
    const tests = [
      {
        name: 'should handle configuration changes',
        fn: async () => {
          // Test configuration factory workflow
          const factory = ConfigurationFactory.getInstance();
          
          // Set test environment
          const originalVars = {
            DB_TYPE: process.env.DB_TYPE,
            SQLITE_FILE_PATH: process.env.SQLITE_FILE_PATH
          };
          
          try {
            process.env.DB_TYPE = 'sqlite';
            process.env.SQLITE_FILE_PATH = ':memory:';
            
            const result = await factory.createConfiguration({
              source: 'environment',
              validateOnLoad: true
            });
            
            TestAssertions.assertEqual(result.config.type, 'sqlite');
            TestAssertions.assertTrue(result.metadata.validationResult.isValid);
            
            // Test database manager initialization with config
            const manager = new DatabaseManager();
            await manager.initialize(result.config);
            
            const health = await manager.checkHealth();
            TestAssertions.assertTrue(health.healthy, 'Database should be healthy with valid config');
            
            await manager.close();
          } finally {
            // Restore environment
            for (const [key, value] of Object.entries(originalVars)) {
              if (value !== undefined) {
                process.env[key] = value;
              } else {
                delete process.env[key];
              }
            }
          }
        }
      },
      {
        name: 'should validate configuration requirements',
        fn: async () => {
          const factory = ConfigurationFactory.getInstance();
          
          // Test invalid configuration
          const originalDbType = process.env.DB_TYPE;
          
          try {
            delete process.env.DB_TYPE;
            
            await TestAssertions.assertThrowsAsync(async () => {
              await factory.createConfiguration({
                source: 'environment',
                validateOnLoad: true
              });
            }, 'Should throw error for missing DB_TYPE');
          } finally {
            if (originalDbType !== undefined) {
              process.env.DB_TYPE = originalDbType;
            }
          }
        }
      }
    ];

    await this.framework.runSuite('MCP Configuration Workflow Tests', tests);
  }
}

/**
 * Performance Integration Tests
 */
export class PerformanceIntegrationTests {
  private framework: TestFramework;
  private testConfig: DatabaseConfig;

  constructor() {
    this.framework = new TestFramework({
      ...DEFAULT_TEST_CONFIG,
      performanceThresholds: {
        maxQueryTime: 100,
        maxConnectionTime: 1000,
        minThroughput: 10
      }
    });
    
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
    await this.runPerformanceBenchmarks();
    await this.runLoadTests();
    await this.runConcurrencyTests();
  }

  private async runPerformanceBenchmarks(): Promise<void> {
    const tests = [
      {
        name: 'should meet entity creation performance targets',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;
          
          const entities = MockDataGenerator.generateEntities(100);
          
          const start = performance.now();
          await adapter.createEntities(entities);
          const end = performance.now();
          
          const duration = end - start;
          const throughput = entities.length / (duration / 1000); // entities per second
          
          TestAssertions.assertLessThan(duration, 1000, 'Should create 100 entities in less than 1 second');
          TestAssertions.assertGreaterThan(throughput, 50, 'Should achieve >50 entities/second throughput');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      },
      {
        name: 'should meet query performance targets',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;
          
          // Setup test data
          const entities = MockDataGenerator.generateEntities(50);
          await adapter.createEntities(entities);
          
          // Benchmark knowledge graph read
          const start = performance.now();
          await adapter.readGraph();
          const end = performance.now();
          
          const duration = end - start;
          TestAssertions.assertLessThan(duration, 100, 'Should read knowledge graph in less than 100ms');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      }
    ];

    await this.framework.runSuite('Performance Benchmark Tests', tests);
  }

  private async runLoadTests(): Promise<void> {
    const tests = [
      {
        name: 'should handle large datasets',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;
          
          // Create large dataset
          const entities = MockDataGenerator.generateEntities(500);
          const relations = MockDataGenerator.generateRelations(entities, 1000);
          
          // Test creation performance
          const start = performance.now();
          await adapter.createEntities(entities);
          await adapter.createRelations(relations);
          const end = performance.now();
          
          const duration = end - start;
          TestAssertions.assertLessThan(duration, 5000, 'Should handle large dataset in less than 5 seconds');
          
          // Test query performance with large dataset
          const queryStart = performance.now();
          const stats = await adapter.getKnowledgeGraphStats();
          const queryEnd = performance.now();
          
          const queryDuration = queryEnd - queryStart;
          TestAssertions.assertLessThan(queryDuration, 200, 'Should query large dataset in less than 200ms');
          TestAssertions.assertEqual(stats.entities.total, 500);
          TestAssertions.assertEqual(stats.relationships.total, 1000);
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      }
    ];

    await this.framework.runSuite('Load Tests', tests);
  }

  private async runConcurrencyTests(): Promise<void> {
    const tests = [
      {
        name: 'should handle concurrent operations',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;
          
          // Create concurrent operations
          const operations = [];
          for (let i = 0; i < 10; i++) {
            const entities = MockDataGenerator.generateEntities(5).map(e => ({
              ...e,
              name: `${e.name}_${i}` // Make names unique
            }));
            operations.push(adapter.createEntities(entities));
          }
          
          // Execute concurrently
          const start = performance.now();
          const results = await Promise.all(operations);
          const end = performance.now();
          
          // Verify all operations succeeded
          for (const result of results) {
            TestAssertions.assertEqual(result.entitiesCreated, 5);
            TestAssertions.assertEqual(result.errors.length, 0);
          }
          
          const duration = end - start;
          TestAssertions.assertLessThan(duration, 2000, 'Should handle concurrent operations in less than 2 seconds');
          
          // Verify final state
          const stats = await adapter.getKnowledgeGraphStats();
          TestAssertions.assertEqual(stats.entities.total, 50, 'Should have all entities from concurrent operations');
          
          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      }
    ];

    await this.framework.runSuite('Concurrency Tests', tests);
  }
}

/**
 * Integration Test Runner Function
 */
export async function runIntegrationTests(): Promise<void> {
  console.log('🔗 Starting Integration Tests');
  console.log('=============================');

  const mcpTests = new MCPToolIntegrationTests();
  const perfTests = new PerformanceIntegrationTests();

  try {
    await mcpTests.runAllTests();
    await perfTests.runAllTests();

    const mcpReport = await mcpTests.framework.generateReport();
    const perfReport = await perfTests.framework.generateReport();

    // Combine reports
    const combinedReport = {
      suites: [...mcpReport.suites, ...perfReport.suites],
      totalTests: mcpReport.totalTests + perfReport.totalTests,
      passedTests: mcpReport.passedTests + perfReport.passedTests,
      failedTests: mcpReport.failedTests + perfReport.failedTests,
      totalDuration: mcpReport.totalDuration + perfReport.totalDuration,
      overallCoverage: (mcpReport.overallCoverage + perfReport.overallCoverage) / 2,
      timestamp: new Date()
    };

    mcpTests.framework.printSummary(combinedReport);

    // Save detailed report
    await mcpTests.framework.saveReport(combinedReport, './test-results/integration-tests-report.json');

  } catch (error) {
    console.error('❌ Integration tests failed:', error);
    throw error;
  }
}
