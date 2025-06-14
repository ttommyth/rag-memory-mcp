/**
 * Performance and Load Testing Framework
 * 
 * Comprehensive performance testing suite for database operations,
 * vector search, and system throughput validation.
 */

import {
  TestFramework,
  TestAssertions,
  MockDataGenerator,
  DatabaseTestUtils,
  PerformanceTestUtils,
  DEFAULT_TEST_CONFIG
} from './test-framework.js';

import {
  DatabaseConfig,
  DatabaseManager
} from '../database/index.js';

/**
 * Performance Test Configuration
 */
export interface PerformanceTestConfig {
  entityCounts: number[];
  relationshipCounts: number[];
  documentCounts: number[];
  iterationCounts: number[];
  concurrencyLevels: number[];
  timeoutMs: number;
  memoryThresholdMB: number;
}

export const DEFAULT_PERFORMANCE_CONFIG: PerformanceTestConfig = {
  entityCounts: [10, 50, 100, 500],
  relationshipCounts: [20, 100, 200, 1000],
  documentCounts: [5, 25, 50, 100],
  iterationCounts: [10, 50, 100],
  concurrencyLevels: [1, 5, 10, 20],
  timeoutMs: 30000,
  memoryThresholdMB: 100
};

/**
 * Performance Metrics Collection
 */
export interface PerformanceMetrics {
  operation: string;
  dataSize: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  throughput: number;
  memoryUsage: number;
  errorRate: number;
  timestamp: Date;
}

/**
 * Database Performance Tests
 */
export class DatabasePerformanceTests {
  private framework: TestFramework;
  private testConfig: DatabaseConfig;
  private perfConfig: PerformanceTestConfig;
  private metrics: PerformanceMetrics[] = [];

  constructor(perfConfig: PerformanceTestConfig = DEFAULT_PERFORMANCE_CONFIG) {
    this.framework = new TestFramework(DEFAULT_TEST_CONFIG);
    this.perfConfig = perfConfig;
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
    await this.runEntityPerformanceTests();
    await this.runRelationshipPerformanceTests();
    await this.runDocumentPerformanceTests();
    await this.runQueryPerformanceTests();
    await this.runConcurrencyTests();
    await this.runMemoryTests();
  }

  private async runEntityPerformanceTests(): Promise<void> {
    const tests = [];

    for (const count of this.perfConfig.entityCounts) {
      tests.push({
        name: `should create ${count} entities within performance threshold`,
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;

          const entities = MockDataGenerator.generateEntities(count);

          const perfResult = await PerformanceTestUtils.measureQueryPerformance(
            adapter,
            async () => await adapter.createEntities(entities),
            1 // Single iteration for large datasets
          );

          // Record metrics
          this.metrics.push({
            operation: 'createEntities',
            dataSize: count,
            averageTime: perfResult.averageTime,
            minTime: perfResult.minTime,
            maxTime: perfResult.maxTime,
            throughput: perfResult.throughput,
            memoryUsage: 0, // Will be measured separately
            errorRate: 0,
            timestamp: new Date()
          });

          // Performance assertions
          const maxTimePerEntity = count > 100 ? 10 : 5; // ms per entity
          TestAssertions.assertLessThan(
            perfResult.averageTime,
            count * maxTimePerEntity,
            `Entity creation should be under ${maxTimePerEntity}ms per entity`
          );

          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      });
    }

    await this.framework.runSuite('Entity Performance Tests', tests);
  }

  private async runRelationshipPerformanceTests(): Promise<void> {
    const tests = [];

    for (const count of this.perfConfig.relationshipCounts) {
      tests.push({
        name: `should create ${count} relationships within performance threshold`,
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;

          // Setup entities first
          const entityCount = Math.min(count / 2, 100);
          const entities = MockDataGenerator.generateEntities(entityCount);
          await adapter.createEntities(entities);

          const relations = MockDataGenerator.generateRelations(entities, count);

          const perfResult = await PerformanceTestUtils.measureQueryPerformance(
            adapter,
            async () => await adapter.createRelations(relations),
            1
          );

          // Record metrics
          this.metrics.push({
            operation: 'createRelations',
            dataSize: count,
            averageTime: perfResult.averageTime,
            minTime: perfResult.minTime,
            maxTime: perfResult.maxTime,
            throughput: perfResult.throughput,
            memoryUsage: 0,
            errorRate: 0,
            timestamp: new Date()
          });

          // Performance assertions
          const maxTimePerRelation = count > 200 ? 5 : 2; // ms per relationship
          TestAssertions.assertLessThan(
            perfResult.averageTime,
            count * maxTimePerRelation,
            `Relationship creation should be under ${maxTimePerRelation}ms per relationship`
          );

          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      });
    }

    await this.framework.runSuite('Relationship Performance Tests', tests);
  }

  private async runDocumentPerformanceTests(): Promise<void> {
    const tests = [];

    for (const count of this.perfConfig.documentCounts) {
      tests.push({
        name: `should store ${count} documents within performance threshold`,
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;

          const documents = MockDataGenerator.generateDocuments(count);

          const perfResult = await PerformanceTestUtils.measureQueryPerformance(
            adapter,
            async () => {
              for (const doc of documents) {
                await adapter.storeDocument(doc.id, doc.content, doc.metadata);
              }
            },
            1
          );

          // Record metrics
          this.metrics.push({
            operation: 'storeDocuments',
            dataSize: count,
            averageTime: perfResult.averageTime,
            minTime: perfResult.minTime,
            maxTime: perfResult.maxTime,
            throughput: perfResult.throughput,
            memoryUsage: 0,
            errorRate: 0,
            timestamp: new Date()
          });

          // Performance assertions
          const maxTimePerDoc = count > 50 ? 50 : 20; // ms per document
          TestAssertions.assertLessThan(
            perfResult.averageTime,
            count * maxTimePerDoc,
            `Document storage should be under ${maxTimePerDoc}ms per document`
          );

          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      });
    }

    await this.framework.runSuite('Document Performance Tests', tests);
  }

  private async runQueryPerformanceTests(): Promise<void> {
    const tests = [
      {
        name: 'should read knowledge graph within performance threshold',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;

          // Setup test data
          const entities = MockDataGenerator.generateEntities(100);
          const relations = MockDataGenerator.generateRelations(entities, 200);
          await adapter.createEntities(entities);
          await adapter.createRelations(relations);

          const perfResult = await PerformanceTestUtils.measureQueryPerformance(
            adapter,
            async () => await adapter.readGraph(),
            10
          );

          // Record metrics
          this.metrics.push({
            operation: 'readGraph',
            dataSize: 100,
            averageTime: perfResult.averageTime,
            minTime: perfResult.minTime,
            maxTime: perfResult.maxTime,
            throughput: perfResult.throughput,
            memoryUsage: 0,
            errorRate: 0,
            timestamp: new Date()
          });

          TestAssertions.assertLessThan(perfResult.averageTime, 100, 'Graph read should be under 100ms');

          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      },
      {
        name: 'should get statistics within performance threshold',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;

          // Setup test data
          const entities = MockDataGenerator.generateEntities(200);
          await adapter.createEntities(entities);

          const perfResult = await PerformanceTestUtils.measureQueryPerformance(
            adapter,
            async () => await adapter.getKnowledgeGraphStats(),
            20
          );

          TestAssertions.assertLessThan(perfResult.averageTime, 50, 'Statistics query should be under 50ms');

          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      }
    ];

    await this.framework.runSuite('Query Performance Tests', tests);
  }

  private async runConcurrencyTests(): Promise<void> {
    const tests = [];

    for (const concurrency of this.perfConfig.concurrencyLevels) {
      tests.push({
        name: `should handle ${concurrency} concurrent operations`,
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;

          const operations = [];
          for (let i = 0; i < concurrency; i++) {
            const entities = MockDataGenerator.generateEntities(10).map(e => ({
              ...e,
              name: `${e.name}_${i}`
            }));
            operations.push(adapter.createEntities(entities));
          }

          const start = performance.now();
          const results = await Promise.all(operations);
          const end = performance.now();

          const duration = end - start;
          const totalEntities = concurrency * 10;

          // Verify all operations succeeded
          for (const result of results) {
            TestAssertions.assertEqual(result.entitiesCreated, 10);
          }

          // Performance assertion
          const maxTimePerOperation = 1000; // 1 second max
          TestAssertions.assertLessThan(
            duration,
            maxTimePerOperation,
            `${concurrency} concurrent operations should complete within ${maxTimePerOperation}ms`
          );

          // Record metrics
          this.metrics.push({
            operation: 'concurrentCreateEntities',
            dataSize: totalEntities,
            averageTime: duration,
            minTime: duration,
            maxTime: duration,
            throughput: totalEntities / (duration / 1000),
            memoryUsage: 0,
            errorRate: 0,
            timestamp: new Date()
          });

          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      });
    }

    await this.framework.runSuite('Concurrency Performance Tests', tests);
  }

  private async runMemoryTests(): Promise<void> {
    const tests = [
      {
        name: 'should not exceed memory threshold during large operations',
        fn: async () => {
          const manager = new DatabaseManager();
          await manager.initialize(this.testConfig);
          const adapter = manager.getAdapter()!;

          const entities = MockDataGenerator.generateEntities(1000);

          const memoryResult = await PerformanceTestUtils.measureMemoryUsage(async () => {
            await adapter.createEntities(entities);
          });

          const memoryIncreaseMB = memoryResult.memoryDelta.heapUsed / (1024 * 1024);

          TestAssertions.assertLessThan(
            memoryIncreaseMB,
            this.perfConfig.memoryThresholdMB,
            `Memory usage should not exceed ${this.perfConfig.memoryThresholdMB}MB`
          );

          await DatabaseTestUtils.cleanupTestDatabase(adapter);
          await manager.close();
        }
      }
    ];

    await this.framework.runSuite('Memory Performance Tests', tests);
  }

  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  generatePerformanceReport(): {
    summary: any;
    metrics: PerformanceMetrics[];
    recommendations: string[];
  } {
    const summary = {
      totalTests: this.metrics.length,
      averagePerformance: this.metrics.reduce((sum, m) => sum + m.averageTime, 0) / this.metrics.length,
      totalThroughput: this.metrics.reduce((sum, m) => sum + m.throughput, 0),
      operationBreakdown: this.getOperationBreakdown()
    };

    const recommendations = this.generateRecommendations();

    return {
      summary,
      metrics: this.metrics,
      recommendations
    };
  }

  private getOperationBreakdown(): Record<string, any> {
    const breakdown: Record<string, any> = {};

    for (const metric of this.metrics) {
      if (!breakdown[metric.operation]) {
        breakdown[metric.operation] = {
          count: 0,
          totalTime: 0,
          totalThroughput: 0,
          maxDataSize: 0
        };
      }

      breakdown[metric.operation].count++;
      breakdown[metric.operation].totalTime += metric.averageTime;
      breakdown[metric.operation].totalThroughput += metric.throughput;
      breakdown[metric.operation].maxDataSize = Math.max(
        breakdown[metric.operation].maxDataSize,
        metric.dataSize
      );
    }

    // Calculate averages
    for (const op of Object.keys(breakdown)) {
      breakdown[op].averageTime = breakdown[op].totalTime / breakdown[op].count;
      breakdown[op].averageThroughput = breakdown[op].totalThroughput / breakdown[op].count;
    }

    return breakdown;
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    // Analyze entity creation performance
    const entityMetrics = this.metrics.filter(m => m.operation === 'createEntities');
    if (entityMetrics.length > 0) {
      const avgTime = entityMetrics.reduce((sum, m) => sum + m.averageTime, 0) / entityMetrics.length;
      if (avgTime > 1000) {
        recommendations.push('Consider batch optimization for entity creation operations');
      }
    }

    // Analyze relationship creation performance
    const relationMetrics = this.metrics.filter(m => m.operation === 'createRelations');
    if (relationMetrics.length > 0) {
      const avgTime = relationMetrics.reduce((sum, m) => sum + m.averageTime, 0) / relationMetrics.length;
      if (avgTime > 2000) {
        recommendations.push('Consider indexing optimization for relationship operations');
      }
    }

    // Analyze concurrency performance
    const concurrentMetrics = this.metrics.filter(m => m.operation === 'concurrentCreateEntities');
    if (concurrentMetrics.length > 0) {
      const maxThroughput = Math.max(...concurrentMetrics.map(m => m.throughput));
      if (maxThroughput < 50) {
        recommendations.push('Consider connection pooling optimization for concurrent operations');
      }
    }

    return recommendations;
  }
}

/**
 * Performance Test Runner Function
 */
export async function runPerformanceTests(): Promise<void> {
  console.log('⚡ Starting Performance Tests');
  console.log('=============================');

  const perfTests = new DatabasePerformanceTests();

  try {
    await perfTests.runAllTests();

    const report = await perfTests.framework.generateReport();
    const perfReport = perfTests.generatePerformanceReport();

    perfTests.framework.printSummary(report);

    console.log('\n📊 Performance Summary');
    console.log('======================');
    console.log(`Average Performance: ${perfReport.summary.averagePerformance.toFixed(2)}ms`);
    console.log(`Total Throughput: ${perfReport.summary.totalThroughput.toFixed(2)} ops/sec`);

    if (perfReport.recommendations.length > 0) {
      console.log('\n💡 Performance Recommendations:');
      for (const rec of perfReport.recommendations) {
        console.log(`  • ${rec}`);
      }
    }

    // Save detailed reports
    await perfTests.framework.saveReport(report, './test-results/performance-tests-report.json');
    await require('fs').promises.writeFile(
      './test-results/performance-metrics.json',
      JSON.stringify(perfReport, null, 2)
    );

  } catch (error) {
    console.error('❌ Performance tests failed:', error);
    throw error;
  }
}
