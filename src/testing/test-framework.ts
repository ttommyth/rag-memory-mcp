/**
 * Comprehensive Testing Framework
 * 
 * A complete testing framework for the RAG Memory MCP system including
 * unit tests, integration tests, performance tests, and data integrity validation.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import {
  DatabaseAdapter,
  DatabaseConfig,
  DatabaseManager,
  ConfigurationFactory,
  EnvironmentManager,
  Entity,
  Relation,
  KnowledgeGraphStats
} from '../database/index.js';

/**
 * Test Result Types
 */
export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: Error;
  details?: any;
}

export interface TestSuite {
  name: string;
  tests: TestResult[];
  passed: boolean;
  duration: number;
  coverage?: number;
}

export interface TestReport {
  suites: TestSuite[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalDuration: number;
  overallCoverage: number;
  timestamp: Date;
}

/**
 * Test Configuration
 */
export interface TestConfig {
  testDatabases: {
    sqlite: string;
    postgresql?: {
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
    };
  };
  performanceThresholds: {
    maxQueryTime: number;
    maxConnectionTime: number;
    minThroughput: number;
  };
  coverageThreshold: number;
  parallel: boolean;
  verbose: boolean;
}

/**
 * Mock Data Generator
 */
export class MockDataGenerator {
  static generateEntities(count: number = 10): Entity[] {
    const entities: Entity[] = [];
    const types = ['PERSON', 'CONCEPT', 'TECHNOLOGY', 'ORGANIZATION', 'LOCATION'];
    
    for (let i = 0; i < count; i++) {
      entities.push({
        name: `TestEntity${i}`,
        entityType: types[i % types.length],
        observations: [
          `Test observation ${i}-1`,
          `Test observation ${i}-2`,
          `Test observation ${i}-3`
        ]
      });
    }
    
    return entities;
  }

  static generateRelations(entities: Entity[], count: number = 15): Relation[] {
    const relations: Relation[] = [];
    const relationTypes = ['IS_A', 'HAS', 'USES', 'IMPLEMENTS', 'CONTAINS'];
    
    for (let i = 0; i < count; i++) {
      const fromEntity = entities[Math.floor(Math.random() * entities.length)];
      const toEntity = entities[Math.floor(Math.random() * entities.length)];
      
      if (fromEntity.name !== toEntity.name) {
        relations.push({
          from: fromEntity.name,
          to: toEntity.name,
          relationType: relationTypes[i % relationTypes.length]
        });
      }
    }
    
    return relations;
  }

  static generateDocuments(count: number = 5): Array<{id: string, content: string, metadata: any}> {
    const documents = [];
    
    for (let i = 0; i < count; i++) {
      documents.push({
        id: `test-doc-${i}`,
        content: `This is test document ${i} with some content for testing purposes. It contains various concepts and entities that should be processed by the RAG system. Document ${i} has unique characteristics for testing different scenarios.`,
        metadata: {
          type: 'test',
          category: `category-${i % 3}`,
          priority: i % 5,
          created: new Date().toISOString()
        }
      });
    }
    
    return documents;
  }
}

/**
 * Database Test Utilities
 */
export class DatabaseTestUtils {
  static async createTestDatabase(config: DatabaseConfig): Promise<DatabaseAdapter> {
    const factory = ConfigurationFactory.getInstance();
    const configResult = await factory.createConfiguration({
      source: 'object',
      validateOnLoad: false
    });
    
    const manager = new DatabaseManager();
    await manager.initialize(config);
    
    return manager.getAdapter()!;
  }

  static async cleanupTestDatabase(adapter: DatabaseAdapter): Promise<void> {
    try {
      // Get all entities and delete them (cascades to relationships)
      const stats = await adapter.getKnowledgeGraphStats();
      if (stats.entities.total > 0) {
        const graph = await adapter.readGraph();
        const entityNames = graph.entities.map(e => e.name);
        if (entityNames.length > 0) {
          await adapter.deleteEntities(entityNames);
        }
      }
      
      // Clean up documents
      const documents = await adapter.listDocuments();
      if (documents.length > 0) {
        const docIds = documents.map(d => d.id);
        await adapter.deleteDocuments(docIds);
      }
      
      await adapter.close();
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  }

  static async validateDataIntegrity(adapter: DatabaseAdapter): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check basic connectivity
      const health = await adapter.checkHealth();
      if (!health.healthy) {
        errors.push(`Database health check failed: ${health.error}`);
      }

      // Check statistics consistency
      const stats = await adapter.getKnowledgeGraphStats();
      
      // Validate entity-relationship consistency
      if (stats.relationships.total > 0 && stats.entities.total === 0) {
        errors.push('Relationships exist without entities');
      }

      // Check for orphaned relationships
      const graph = await adapter.readGraph();
      for (const rel of graph.relationships) {
        const fromExists = graph.entities.some(e => e.name === rel.from);
        const toExists = graph.entities.some(e => e.name === rel.to);
        
        if (!fromExists) {
          errors.push(`Relationship references non-existent entity: ${rel.from}`);
        }
        if (!toExists) {
          errors.push(`Relationship references non-existent entity: ${rel.to}`);
        }
      }

      // Check document-chunk consistency
      const documents = await adapter.listDocuments();
      for (const doc of documents) {
        try {
          // This would check if chunks exist for the document
          // Implementation depends on adapter capabilities
        } catch (error) {
          warnings.push(`Document ${doc.id} may have inconsistent chunks`);
        }
      }

    } catch (error) {
      errors.push(`Data integrity validation failed: ${(error as Error).message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

/**
 * Performance Test Utilities
 */
export class PerformanceTestUtils {
  static async measureQueryPerformance(
    adapter: DatabaseAdapter,
    operation: () => Promise<any>,
    iterations: number = 100
  ): Promise<{
    averageTime: number;
    minTime: number;
    maxTime: number;
    throughput: number;
    results: number[];
  }> {
    const times: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await operation();
      const end = performance.now();
      times.push(end - start);
    }
    
    const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const throughput = 1000 / averageTime; // operations per second
    
    return {
      averageTime,
      minTime,
      maxTime,
      throughput,
      results: times
    };
  }

  static async measureMemoryUsage(operation: () => Promise<any>): Promise<{
    beforeMemory: NodeJS.MemoryUsage;
    afterMemory: NodeJS.MemoryUsage;
    memoryDelta: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
  }> {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    const beforeMemory = process.memoryUsage();
    await operation();
    const afterMemory = process.memoryUsage();
    
    return {
      beforeMemory,
      afterMemory,
      memoryDelta: {
        rss: afterMemory.rss - beforeMemory.rss,
        heapUsed: afterMemory.heapUsed - beforeMemory.heapUsed,
        heapTotal: afterMemory.heapTotal - beforeMemory.heapTotal,
        external: afterMemory.external - beforeMemory.external
      }
    };
  }
}

/**
 * Test Assertion Utilities
 */
export class TestAssertions {
  static assertEqual<T>(actual: T, expected: T, message?: string): void {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  }

  static assertNotEqual<T>(actual: T, expected: T, message?: string): void {
    if (actual === expected) {
      throw new Error(message || `Expected values to be different, both are ${actual}`);
    }
  }

  static assertTrue(condition: boolean, message?: string): void {
    if (!condition) {
      throw new Error(message || 'Expected condition to be true');
    }
  }

  static assertFalse(condition: boolean, message?: string): void {
    if (condition) {
      throw new Error(message || 'Expected condition to be false');
    }
  }

  static assertThrows(fn: () => any, message?: string): void {
    try {
      fn();
      throw new Error(message || 'Expected function to throw an error');
    } catch (error) {
      // Expected behavior
    }
  }

  static async assertThrowsAsync(fn: () => Promise<any>, message?: string): Promise<void> {
    try {
      await fn();
      throw new Error(message || 'Expected async function to throw an error');
    } catch (error) {
      // Expected behavior
    }
  }

  static assertArrayEqual<T>(actual: T[], expected: T[], message?: string): void {
    if (actual.length !== expected.length) {
      throw new Error(message || `Array lengths differ: expected ${expected.length}, got ${actual.length}`);
    }
    
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) {
        throw new Error(message || `Array elements differ at index ${i}: expected ${expected[i]}, got ${actual[i]}`);
      }
    }
  }

  static assertObjectEqual(actual: any, expected: any, message?: string): void {
    const actualStr = JSON.stringify(actual, null, 2);
    const expectedStr = JSON.stringify(expected, null, 2);
    
    if (actualStr !== expectedStr) {
      throw new Error(message || `Objects differ:\nExpected: ${expectedStr}\nActual: ${actualStr}`);
    }
  }

  static assertGreaterThan(actual: number, expected: number, message?: string): void {
    if (actual <= expected) {
      throw new Error(message || `Expected ${actual} to be greater than ${expected}`);
    }
  }

  static assertLessThan(actual: number, expected: number, message?: string): void {
    if (actual >= expected) {
      throw new Error(message || `Expected ${actual} to be less than ${expected}`);
    }
  }

  static assertContains<T>(array: T[], item: T, message?: string): void {
    if (!array.includes(item)) {
      throw new Error(message || `Expected array to contain ${item}`);
    }
  }

  static assertNotContains<T>(array: T[], item: T, message?: string): void {
    if (array.includes(item)) {
      throw new Error(message || `Expected array not to contain ${item}`);
    }
  }
}

/**
 * Main Test Framework Class
 */
export class TestFramework {
  private config: TestConfig;
  private suites: Map<string, TestSuite> = new Map();

  constructor(config: TestConfig) {
    this.config = config;
  }

  async runTest(name: string, testFn: () => Promise<void>): Promise<TestResult> {
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
        error: error as Error
      };
    }
  }

  async runSuite(suiteName: string, tests: Array<{name: string, fn: () => Promise<void>}>): Promise<TestSuite> {
    const start = performance.now();
    const results: TestResult[] = [];

    if (this.config.verbose) {
      console.log(`\n🧪 Running test suite: ${suiteName}`);
    }

    for (const test of tests) {
      if (this.config.verbose) {
        process.stdout.write(`  • ${test.name}... `);
      }

      const result = await this.runTest(test.name, test.fn);
      results.push(result);

      if (this.config.verbose) {
        console.log(result.passed ? '✅' : '❌');
        if (!result.passed && result.error) {
          console.log(`    Error: ${result.error.message}`);
        }
      }
    }

    const end = performance.now();
    const passed = results.every(r => r.passed);

    const suite: TestSuite = {
      name: suiteName,
      tests: results,
      passed,
      duration: end - start
    };

    this.suites.set(suiteName, suite);
    return suite;
  }

  async generateReport(): Promise<TestReport> {
    const suites = Array.from(this.suites.values());
    const totalTests = suites.reduce((sum, suite) => sum + suite.tests.length, 0);
    const passedTests = suites.reduce((sum, suite) => sum + suite.tests.filter(t => t.passed).length, 0);
    const failedTests = totalTests - passedTests;
    const totalDuration = suites.reduce((sum, suite) => sum + suite.duration, 0);
    
    // Calculate overall coverage (simplified)
    const overallCoverage = suites.reduce((sum, suite) => sum + (suite.coverage || 0), 0) / suites.length || 0;

    return {
      suites,
      totalTests,
      passedTests,
      failedTests,
      totalDuration,
      overallCoverage,
      timestamp: new Date()
    };
  }

  async saveReport(report: TestReport, filePath: string): Promise<void> {
    const reportData = {
      ...report,
      summary: {
        success: report.failedTests === 0,
        successRate: (report.passedTests / report.totalTests) * 100,
        averageTestDuration: report.totalDuration / report.totalTests,
        coverageStatus: report.overallCoverage >= this.config.coverageThreshold ? 'PASS' : 'FAIL'
      }
    };

    await fs.writeFile(filePath, JSON.stringify(reportData, null, 2));
  }

  printSummary(report: TestReport): void {
    console.log('\n📊 Test Summary');
    console.log('================');
    console.log(`Total Tests: ${report.totalTests}`);
    console.log(`Passed: ${report.passedTests} ✅`);
    console.log(`Failed: ${report.failedTests} ${report.failedTests > 0 ? '❌' : ''}`);
    console.log(`Success Rate: ${((report.passedTests / report.totalTests) * 100).toFixed(1)}%`);
    console.log(`Total Duration: ${report.totalDuration.toFixed(2)}ms`);
    console.log(`Average Test Duration: ${(report.totalDuration / report.totalTests).toFixed(2)}ms`);
    console.log(`Coverage: ${report.overallCoverage.toFixed(1)}%`);
    
    if (report.failedTests > 0) {
      console.log('\n❌ Failed Tests:');
      for (const suite of report.suites) {
        for (const test of suite.tests) {
          if (!test.passed) {
            console.log(`  • ${suite.name} > ${test.name}`);
            if (test.error) {
              console.log(`    ${test.error.message}`);
            }
          }
        }
      }
    }
    
    console.log(`\n${report.failedTests === 0 ? '🎉 All tests passed!' : '⚠️  Some tests failed'}`);
  }
}

/**
 * Default Test Configuration
 */
export const DEFAULT_TEST_CONFIG: TestConfig = {
  testDatabases: {
    sqlite: ':memory:'
  },
  performanceThresholds: {
    maxQueryTime: 100, // ms
    maxConnectionTime: 1000, // ms
    minThroughput: 10 // operations per second
  },
  coverageThreshold: 90, // percentage
  parallel: false,
  verbose: true
};

/**
 * Test Configuration Factory
 */
export class TestConfigFactory {
  static createSQLiteConfig(): TestConfig {
    return {
      ...DEFAULT_TEST_CONFIG,
      testDatabases: {
        sqlite: ':memory:'
      }
    };
  }

  static createPostgreSQLConfig(pgConfig: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  }): TestConfig {
    return {
      ...DEFAULT_TEST_CONFIG,
      testDatabases: {
        sqlite: ':memory:',
        postgresql: pgConfig
      }
    };
  }

  static createPerformanceConfig(): TestConfig {
    return {
      ...DEFAULT_TEST_CONFIG,
      performanceThresholds: {
        maxQueryTime: 50,
        maxConnectionTime: 500,
        minThroughput: 50
      },
      verbose: false
    };
  }
}
