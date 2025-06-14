/**
 * Fixed Simple Test Runner
 * 
 * A working test runner that validates the core functionality
 * with proper error handling and comprehensive reporting.
 */

import { promises as fs } from 'fs';
import { performance } from 'perf_hooks';
import {
  DatabaseManager,
  ConfigurationFactory,
  DatabaseConfig
} from '../database/index.js';

/**
 * Simple Test Result
 */
interface SimpleTestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

/**
 * Simple Test Suite
 */
interface SimpleTestSuite {
  name: string;
  tests: SimpleTestResult[];
  passed: boolean;
  duration: number;
}

/**
 * Simple Test Framework
 */
export class SimpleTestFramework {
  private suites: SimpleTestSuite[] = [];

  async runTest(name: string, testFn: () => Promise<void>): Promise<SimpleTestResult> {
    const start = performance.now();
    
    try {
      await testFn();
      const end = performance.now();
      
      return {
        name,
        passed: true,
        duration: end - start
      };
    } catch (error) {
      const end = performance.now();
      
      return {
        name,
        passed: false,
        duration: end - start,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async runSuite(suiteName: string, tests: Array<{name: string, fn: () => Promise<void>}>): Promise<SimpleTestSuite> {
    const start = performance.now();
    const results: SimpleTestResult[] = [];

    console.log(`\n🧪 Running test suite: ${suiteName}`);

    for (const test of tests) {
      process.stdout.write(`  • ${test.name}... `);

      const result = await this.runTest(test.name, test.fn);
      results.push(result);

      console.log(result.passed ? '✅' : '❌');
      if (!result.passed && result.error) {
        console.log(`    Error: ${result.error}`);
      }
    }

    const end = performance.now();
    const passed = results.every(r => r.passed);

    const suite: SimpleTestSuite = {
      name: suiteName,
      tests: results,
      passed,
      duration: end - start
    };

    this.suites.push(suite);
    return suite;
  }

  printSummary(): void {
    const totalTests = this.suites.reduce((sum, suite) => sum + suite.tests.length, 0);
    const passedTests = this.suites.reduce((sum, suite) => sum + suite.tests.filter(t => t.passed).length, 0);
    const failedTests = totalTests - passedTests;
    const totalDuration = this.suites.reduce((sum, suite) => sum + suite.duration, 0);

    console.log('\n📊 Test Summary');
    console.log('================');
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests} ✅`);
    console.log(`Failed: ${failedTests} ${failedTests > 0 ? '❌' : ''}`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    console.log(`Total Duration: ${totalDuration.toFixed(2)}ms`);
    
    if (failedTests > 0) {
      console.log('\n❌ Failed Tests:');
      for (const suite of this.suites) {
        for (const test of suite.tests) {
          if (!test.passed) {
            console.log(`  • ${suite.name} > ${test.name}`);
            if (test.error) {
              console.log(`    ${test.error}`);
            }
          }
        }
      }
    }
    
    console.log(`\n${failedTests === 0 ? '🎉 All tests passed!' : '⚠️  Some tests failed'}`);
  }

  async saveReport(filePath: string): Promise<void> {
    const totalTests = this.suites.reduce((sum, suite) => sum + suite.tests.length, 0);
    const passedTests = this.suites.reduce((sum, suite) => sum + suite.tests.filter(t => t.passed).length, 0);
    const failedTests = totalTests - passedTests;
    const totalDuration = this.suites.reduce((sum, suite) => sum + suite.duration, 0);

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests,
        passedTests,
        failedTests,
        successRate: ((passedTests / totalTests) * 100).toFixed(1),
        totalDuration: totalDuration.toFixed(2),
        status: failedTests === 0 ? 'PASSED' : 'FAILED'
      },
      suites: this.suites,
      failedTests: this.suites.flatMap(suite => 
        suite.tests.filter(test => !test.passed).map(test => ({
          suite: suite.name,
          test: test.name,
          error: test.error
        }))
      ),
      recommendations: this.generateRecommendations(),
      nextSteps: [
        failedTests > 0 ? 'Fix failing tests before marking STEP 7 as complete' : 'All tests passed - ready for next step',
        'Add more comprehensive test coverage (currently only basic tests)',
        'Add performance and integration tests',
        'Add entity, relationship, and document workflow tests'
      ]
    };

    await fs.writeFile(filePath, JSON.stringify(report, null, 2));
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const totalTests = this.suites.reduce((sum, suite) => sum + suite.tests.length, 0);
    const passedTests = this.suites.reduce((sum, suite) => sum + suite.tests.filter(t => t.passed).length, 0);
    const failedTests = totalTests - passedTests;

    if (failedTests > 0) {
      recommendations.push('CRITICAL: Fix failing tests before marking STEP 7 as complete');
      recommendations.push('Ensure database migrations run before testing database operations');
    }

    if (totalTests < 20) {
      recommendations.push('Add more comprehensive tests covering edge cases and error scenarios');
      recommendations.push('Current test coverage is insufficient for production readiness');
    }

    recommendations.push('Add entity management tests (create, read, update, delete)');
    recommendations.push('Add relationship management tests');
    recommendations.push('Add document processing and RAG workflow tests');
    recommendations.push('Add performance tests to validate system scalability');
    recommendations.push('Add integration tests for complete MCP tool workflows');

    return recommendations;
  }
}

/**
 * Core Database Tests
 */
export class CoreDatabaseTests {
  private framework: SimpleTestFramework;
  private testConfig: DatabaseConfig;

  constructor() {
    this.framework = new SimpleTestFramework();
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
    await this.runBasicTests();
    await this.runConfigurationTests();
    await this.runDatabaseManagerTests();
  }

  private async runBasicTests(): Promise<void> {
    const tests = [
      {
        name: 'should create database manager',
        fn: async () => {
          const manager = new DatabaseManager();
          if (!manager) {
            throw new Error('Failed to create database manager');
          }
        }
      },
      {
        name: 'should initialize database manager',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          await manager.close();
        }
      },
      {
        name: 'should get adapter from manager',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          
          const adapter = manager.getAdapter();
          if (!adapter) {
            throw new Error('Failed to get adapter from manager');
          }
          
          await manager.close();
        }
      }
    ];

    await this.framework.runSuite('Basic Database Tests', tests);
  }

  private async runConfigurationTests(): Promise<void> {
    const tests = [
      {
        name: 'should create configuration factory',
        fn: async () => {
          const factory = ConfigurationFactory.getInstance();
          if (!factory) {
            throw new Error('Failed to create configuration factory');
          }
        }
      },
      {
        name: 'should create configuration from environment',
        fn: async () => {
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
            
            const factory = ConfigurationFactory.getInstance();
            const result = await factory.createConfiguration({
              source: 'environment',
              validateOnLoad: true
            });
            
            if (result.config.type !== 'sqlite') {
              throw new Error(`Expected sqlite, got ${result.config.type}`);
            }
            
            if (result.config.vectorDimensions !== 384) {
              throw new Error(`Expected 384 dimensions, got ${result.config.vectorDimensions}`);
            }
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

    await this.framework.runSuite('Configuration Tests', tests);
  }

  private async runDatabaseManagerTests(): Promise<void> {
    const tests = [
      {
        name: 'should perform basic database operations',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          
          const adapter = manager.getAdapter();
          if (!adapter) {
            throw new Error('No adapter available');
          }

          // Test basic operations that should exist
          try {
            // CRITICAL FIX: Initialize schema by running migrations
            const { multiDbMigrations } = await import('../database/multi-db-migrations.js');
            const migration001 = multiDbMigrations[0]; // First migration contains schema
            if (migration001?.sqlite) {
              await migration001.sqlite.up(adapter);
            }
            
            // Test knowledge graph stats (this should work now with schema)
            const stats = await adapter.getKnowledgeGraphStats();
            if (typeof stats.entities?.total !== 'number') {
              throw new Error('Invalid stats format');
            }

            // Test reading empty graph
            const graph = await adapter.readGraph();
            if (!Array.isArray(graph.entities)) {
              throw new Error('Invalid graph format');
            }

            // Test document listing
            const docs = await adapter.listDocuments();
            if (!Array.isArray(docs)) {
              throw new Error('Invalid document list format');
            }

          } catch (error) {
            throw new Error(`Database operations failed: ${error}`);
          }
          
          await manager.close();
        }
      },
      {
        name: 'should handle entity operations',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          
          const adapter = manager.getAdapter();
          if (!adapter) {
            throw new Error('No adapter available');
          }

          try {
            // CRITICAL FIX: Initialize schema by running migrations
            const { multiDbMigrations } = await import('../database/multi-db-migrations.js');
            const migration001 = multiDbMigrations[0]; // First migration contains schema
            if (migration001?.sqlite) {
              await migration001.sqlite.up(adapter);
            }
            
            // Create test entities (this will test if the schema works)
            const entities = [
              {
                name: 'TestEntity1',
                entityType: 'TEST',
                observations: ['Test observation 1', 'Test observation 2']
              },
              {
                name: 'TestEntity2', 
                entityType: 'TEST',
                observations: ['Test observation 3']
              }
            ];

            await adapter.createEntities(entities);

            // Verify entities were created
            const stats = await adapter.getKnowledgeGraphStats();
            if (stats.entities.total < 2) {
              throw new Error(`Expected at least 2 entities, got ${stats.entities.total}`);
            }

            // Clean up
            await adapter.deleteEntities(['TestEntity1', 'TestEntity2']);

          } catch (error) {
            throw new Error(`Entity operations failed: ${error}`);
          }
          
          await manager.close();
        }
      }
    ];

    await this.framework.runSuite('Database Manager Tests', tests);
  }

  printResults(): void {
    this.framework.printSummary();
  }

  getFramework(): SimpleTestFramework {
    return this.framework;
  }
}

/**
 * Simple Test Runner Function
 */
export async function runSimpleTests(): Promise<void> {
  console.log('🧪 RAG Memory MCP - Enhanced Test Suite');
  console.log('=======================================');

  const coreTests = new CoreDatabaseTests();

  try {
    await coreTests.runAllTests();
    coreTests.printResults();

    // Create test results directory
    try {
      await fs.mkdir('./test-results', { recursive: true });
      
      // Save detailed test report
      await coreTests.getFramework().saveReport('./test-results/test-report.json');
      console.log('\n📄 Detailed test report saved to: ./test-results/test-report.json');

      // Save simple status report for quick reference
      const statusReport = {
        timestamp: new Date().toISOString(),
        status: 'completed',
        message: 'Enhanced test suite completed',
        testingFrameworkStatus: 'INCOMPLETE - needs more comprehensive tests',
        step7Status: 'IN PROGRESS - tests failing, framework needs enhancement',
        nextSteps: [
          'Fix failing database schema tests',
          'Add comprehensive entity, relationship, and document tests',
          'Add performance and integration tests',
          'Achieve >90% test coverage',
          'Only mark STEP 7 complete when all tests pass and coverage is adequate'
        ]
      };
      
      await fs.writeFile('./test-results/simple-test-report.json', JSON.stringify(statusReport, null, 2));
      console.log('📄 Status report saved to: ./test-results/simple-test-report.json');
      
      console.log('\n⚠️  STEP 7 STATUS: IN PROGRESS');
      console.log('Tests are failing and framework needs enhancement before completion.');
      
    } catch (error) {
      console.warn('Warning: Could not save test reports:', error);
    }

  } catch (error) {
    console.error('❌ Enhanced tests failed:', error);
    throw error;
  }
}

/**
 * Main execution when run directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  runSimpleTests().catch(console.error);
}
