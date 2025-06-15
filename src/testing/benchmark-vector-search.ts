/**
 * Vector Search Performance Benchmarking
 * Compares SQLite vs PostgreSQL performance for vector operations
 */

import { DatabaseFactory } from '../database/database-factory.js';
import { DatabaseConfig } from '../database/interfaces.js';
import { performance } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';

interface BenchmarkResult {
  database: string;
  operation: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  throughput: number;
}

class VectorSearchBenchmark {
  private results: BenchmarkResult[] = [];
  
  async runBenchmarks() {
    console.log('🚀 Starting Vector Search Performance Benchmarking...\n');
    
    // Test configurations
    const configs = [
      {
        name: 'SQLite (baseline)',
        config: {
          type: 'sqlite' as const,
          sqlite: {
            filePath: ':memory:',
            enableWAL: false
          },
          vectorDimensions: 384,
          enableLogging: false
        }
      },
      {
        name: 'PostgreSQL (Docker)',
        config: {
          type: 'postgresql' as const,
          postgresql: {
            host: 'localhost',
            port: 5432,
            database: 'rag_memory',
            username: 'rag_user',
            password: 'rag_secure_password',
            ssl: false
          },
          vectorDimensions: 384,
          enableLogging: false
        }
      }
    ];
    
    // Test data sizes
    const testSizes = [10, 50, 100, 500];
    
    for (const dbConfig of configs) {
      console.log(`\n📊 Testing ${dbConfig.name}...`);
      
      const factory = DatabaseFactory.getInstance();
      const db = await factory.createAdapter(dbConfig.config);
      await db.initialize(dbConfig.config);
      
      // Run benchmarks for different data sizes
      for (const size of testSizes) {
        console.log(`\n  Testing with ${size} entities...`);
        
        // 1. Entity Creation Performance
        await this.benchmarkEntityCreation(db, dbConfig.name, size);
        
        // 2. Vector Embedding Performance
        await this.benchmarkVectorEmbedding(db, dbConfig.name, size);
        
        // 3. Vector Search Performance
        await this.benchmarkVectorSearch(db, dbConfig.name, size);
        
        // 4. Hybrid Search Performance
        await this.benchmarkHybridSearch(db, dbConfig.name, size);
        
        // Clean up for next test
        await this.cleanupTestData(db);
      }
      
      await db.close();
    }
    
    // Generate report
    await this.generateReport();
  }
  
  private async benchmarkEntityCreation(db: any, dbName: string, count: number) {
    const times: number[] = [];
    
    for (let i = 0; i < count; i++) {
      const start = performance.now();
      
      await db.createEntity({
        name: `TestEntity_${i}`,
        type: 'BENCHMARK_ENTITY',
        observations: [`Test entity ${i} for performance benchmarking`]
      });
      
      const end = performance.now();
      times.push(end - start);
    }
    
    this.recordResult(dbName, 'Entity Creation', times);
  }
  
  private async benchmarkVectorEmbedding(db: any, dbName: string, count: number) {
    const times: number[] = [];
    const iterations = Math.min(count, 20); // Limit embedding operations
    
    // Create test chunks
    const chunkIds: string[] = [];
    for (let i = 0; i < iterations; i++) {
      const chunkId = await db.createChunk({
        documentId: 'benchmark_doc',
        content: `This is test content ${i} for vector embedding benchmarking. It contains enough text to create meaningful embeddings.`,
        startPos: i * 100,
        endPos: (i + 1) * 100,
        metadata: { index: i }
      });
      chunkIds.push(chunkId);
    }
    
    // Benchmark embedding generation
    for (const chunkId of chunkIds) {
      const start = performance.now();
      
      // Generate mock embedding (in real scenario, this would use the actual embedding model)
      const embedding = new Array(384).fill(0).map(() => Math.random());
      await db.updateChunkEmbedding(chunkId, embedding);
      
      const end = performance.now();
      times.push(end - start);
    }
    
    this.recordResult(dbName, 'Vector Embedding', times);
  }
  
  private async benchmarkVectorSearch(db: any, dbName: string, count: number) {
    const times: number[] = [];
    const searchIterations = 10;
    
    // Ensure we have embeddings to search
    await this.setupSearchData(db, count);
    
    // Benchmark vector searches
    for (let i = 0; i < searchIterations; i++) {
      const queryEmbedding = new Array(384).fill(0).map(() => Math.random());
      
      const start = performance.now();
      
      await db.searchChunksByVector(queryEmbedding, 10);
      
      const end = performance.now();
      times.push(end - start);
    }
    
    this.recordResult(dbName, 'Vector Search', times);
  }
  
  private async benchmarkHybridSearch(db: any, dbName: string, count: number) {
    const times: number[] = [];
    const searchIterations = 10;
    
    // Benchmark hybrid searches (vector + graph)
    for (let i = 0; i < searchIterations; i++) {
      const queryEmbedding = new Array(384).fill(0).map(() => Math.random());
      
      const start = performance.now();
      
      // Simulate hybrid search
      const vectorResults = await db.searchChunksByVector(queryEmbedding, 10);
      const entities = await db.searchEntitiesByEmbedding(queryEmbedding, 5);
      
      const end = performance.now();
      times.push(end - start);
    }
    
    this.recordResult(dbName, 'Hybrid Search', times);
  }
  
  private async setupSearchData(db: any, count: number) {
    // Create entities with embeddings
    for (let i = 0; i < Math.min(count, 50); i++) {
      const entityId = await db.createEntity({
        name: `SearchEntity_${i}`,
        type: 'SEARCH_ENTITY',
        observations: [`Entity for search benchmarking ${i}`]
      });
      
      const embedding = new Array(384).fill(0).map(() => Math.random());
      await db.updateEntityEmbedding(`SearchEntity_${i}`, embedding);
    }
    
    // Create chunks with embeddings
    for (let i = 0; i < Math.min(count, 50); i++) {
      const chunkId = await db.createChunk({
        documentId: 'search_doc',
        content: `Search content ${i} with enough text for meaningful search results.`,
        startPos: i * 50,
        endPos: (i + 1) * 50,
        metadata: { searchIndex: i }
      });
      
      const embedding = new Array(384).fill(0).map(() => Math.random());
      await db.updateChunkEmbedding(chunkId, embedding);
    }
  }
  
  private async cleanupTestData(db: any) {
    // Clean up test entities
    const entities = await db.getEntities();
    for (const entity of entities) {
      if (entity.name.startsWith('TestEntity_') || 
          entity.name.startsWith('SearchEntity_')) {
        await db.deleteEntity(entity.name);
      }
    }
    
    // Clean up test documents
    const docs = await db.getDocuments();
    for (const doc of docs) {
      if (doc.id === 'benchmark_doc' || doc.id === 'search_doc') {
        await db.deleteDocument(doc.id);
      }
    }
  }
  
  private recordResult(database: string, operation: string, times: number[]) {
    const totalTime = times.reduce((a, b) => a + b, 0);
    const avgTime = totalTime / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const throughput = (times.length / totalTime) * 1000; // ops/second
    
    this.results.push({
      database,
      operation,
      iterations: times.length,
      totalTime,
      avgTime,
      minTime,
      maxTime,
      throughput
    });
    
    console.log(`    ✓ ${operation}: ${avgTime.toFixed(2)}ms avg, ${throughput.toFixed(1)} ops/sec`);
  }
  
  private async generateReport() {
    console.log('\n\n📈 PERFORMANCE BENCHMARK RESULTS\n');
    console.log('=' .repeat(80));
    
    // Group results by operation
    const operations = [...new Set(this.results.map(r => r.operation))];
    
    for (const operation of operations) {
      console.log(`\n${operation}:`);
      console.log('-'.repeat(40));
      
      const opResults = this.results.filter(r => r.operation === operation);
      
      // Create comparison table
      console.log('Database           | Avg Time (ms) | Throughput (ops/s) | Min (ms) | Max (ms)');
      console.log('-------------------|---------------|--------------------|-----------|---------');
      
      for (const result of opResults) {
        console.log(
          `${result.database.padEnd(18)} | ` +
          `${result.avgTime.toFixed(2).padStart(13)} | ` +
          `${result.throughput.toFixed(1).padStart(18)} | ` +
          `${result.minTime.toFixed(2).padStart(8)} | ` +
          `${result.maxTime.toFixed(2).padStart(7)}`
        );
      }
      
      // Calculate performance comparison
      const sqliteResult = opResults.find(r => r.database.includes('SQLite'));
      const pgResult = opResults.find(r => r.database.includes('PostgreSQL'));
      
      if (sqliteResult && pgResult) {
        const speedup = sqliteResult.avgTime / pgResult.avgTime;
        const throughputGain = (pgResult.throughput - sqliteResult.throughput) / sqliteResult.throughput * 100;
        
        console.log(`\nPerformance Analysis:`);
        if (speedup > 1) {
          console.log(`  ✅ PostgreSQL is ${speedup.toFixed(2)}x faster`);
        } else {
          console.log(`  ⚠️  SQLite is ${(1/speedup).toFixed(2)}x faster`);
        }
        console.log(`  📊 Throughput difference: ${throughputGain > 0 ? '+' : ''}${throughputGain.toFixed(1)}%`);
      }
    }
    
    // Save detailed results
    const reportPath = path.join(process.cwd(), 'benchmark-results.json');
    await fs.writeFile(reportPath, JSON.stringify(this.results, null, 2));
    console.log(`\n💾 Detailed results saved to: ${reportPath}`);
    
    // Overall verdict
    console.log('\n\n🏁 OVERALL VERDICT:');
    console.log('=' .repeat(80));
    
    const pgFasterCount = this.results.filter((r, i) => {
      const sqliteEquiv = this.results.find(
        sr => sr.operation === r.operation && sr.database.includes('SQLite')
      );
      return r.database.includes('PostgreSQL') && sqliteEquiv && r.avgTime < sqliteEquiv.avgTime;
    }).length;
    
    const totalComparisons = operations.length;
    const pgWinRate = (pgFasterCount / totalComparisons) * 100;
    
    console.log(`PostgreSQL outperformed SQLite in ${pgFasterCount}/${totalComparisons} operations (${pgWinRate.toFixed(0)}%)`);
    
    if (pgWinRate >= 50) {
      console.log('✅ PostgreSQL meets or exceeds SQLite performance baseline!');
    } else {
      console.log('⚠️  PostgreSQL performance needs optimization for some operations.');
    }
  }
}

// Run benchmarks
async function main() {
  try {
    const benchmark = new VectorSearchBenchmark();
    await benchmark.runBenchmarks();
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

main();