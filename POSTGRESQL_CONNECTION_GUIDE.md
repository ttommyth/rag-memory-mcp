# PostgreSQL Connection Configuration Guide

This guide explains the PostgreSQL connection improvements and best practices implemented in the memory-mcp-rag project.

## Overview

The PostgreSQL connection system has been enhanced with:
- **Connection Pool Manager**: Centralized pool management with automatic recovery
- **Health Monitoring**: Proactive connection health checks
- **Retry Logic**: Automatic retry with exponential backoff
- **Better Defaults**: Optimized timeout settings for stability

## Key Components

### 1. Connection Pool Manager (`connection-pool-manager.ts`)

The `ConnectionPoolManager` provides:
- Centralized pool creation and management
- Automatic connection recovery on failures
- Connection retry with exponential backoff
- Pool statistics and health tracking

#### Key Features:
- **Auto-recovery**: Detects connection errors and automatically recreates pools
- **Retry Logic**: `getClientWithRetry()` method with configurable retry attempts
- **Health Monitoring**: Built-in health check methods
- **Statistics**: Track active, idle, and waiting connections

### 2. Connection Health Monitor (`connection-health-monitor.ts`)

The `ConnectionHealthMonitor` provides:
- Periodic health checks (default: every 30 seconds)
- Automatic failure detection
- Connection recovery triggering
- Configurable retry policies

#### Configuration:
```javascript
{
  checkIntervalMs: 30000,      // Health check interval
  maxRetries: 3,               // Max consecutive failures before recovery
  retryDelayMs: 5000,          // Delay between retries
  healthCheckTimeoutMs: 10000  // Timeout for health check queries
}
```

### 3. Environment Configuration (`environment-config.ts`)

Enhanced PostgreSQL configuration with better defaults:

#### Connection Pool Settings:
- `PG_POOL_MIN`: Minimum connections (default: 2)
- `PG_POOL_MAX`: Maximum connections (default: 20)
- `PG_POOL_IDLE_TIMEOUT`: Idle timeout (default: 300000ms = 5 minutes)
- `PG_POOL_CONNECTION_TIMEOUT`: Connection timeout (default: 15000ms = 15 seconds)

#### Why These Defaults?
- **5-minute idle timeout**: Prevents premature connection closing
- **15-second connection timeout**: Accommodates slower network conditions
- **2-20 connection range**: Balances resource usage with availability

## Best Practices

### 1. Connection Stability

The implementation includes several stability features:
- **Keep-alive**: Enabled by default with 5-second initial delay
- **Statement timeouts**: Prevents hanging queries (default: 30 seconds)
- **Client-level error handling**: Automatic client removal on errors

### 2. Error Handling

Connection errors are automatically detected and handled:
```javascript
// Recognized connection error patterns:
- 'connection terminated'
- 'connection closed'
- 'connection timeout'
- 'server closed the connection'
- 'connection refused'
- 'network error'
- 'timeout expired'
- 'connection lost'
- 'connection reset'
```

### 3. Recovery Process

When connection errors are detected:
1. Health monitor detects failure
2. Recovery is scheduled (5-second debounce)
3. Old pool is closed gracefully
4. New pool is created with same configuration
5. Health monitoring resumes

## Usage Example

```javascript
// Initialize the adapter
const adapter = new PostgreSQLAdapter(logger);
await adapter.initialize(config);

// The connection pool is automatically managed
// with health monitoring and recovery

// For direct pool access (if needed):
const client = await adapter.query('SELECT 1');
```

## Monitoring

### Health Status
```javascript
const health = await adapter.getHealth();
console.log(health);
// {
//   status: 'healthy' | 'degraded' | 'unhealthy',
//   latency: 45,
//   connections: { active: 3, idle: 7, total: 10 },
//   lastCheck: Date,
//   errors: []
// }
```

### Pool Statistics
```javascript
const stats = connectionManager.getPoolStats('default');
console.log(stats);
// {
//   totalCount: 10,
//   idleCount: 7,
//   waitingCount: 0
// }
```

## Troubleshooting

### Common Issues

1. **High Connection Latency**
   - Check network connectivity
   - Verify PostgreSQL server load
   - Consider increasing connection timeout

2. **Pool Exhaustion**
   - Increase `PG_POOL_MAX`
   - Check for connection leaks
   - Monitor long-running queries

3. **Frequent Reconnections**
   - Increase `PG_POOL_IDLE_TIMEOUT`
   - Check PostgreSQL server logs
   - Verify network stability

### Debug Logging

Enable debug logging to see detailed connection information:
```bash
ENABLE_DB_LOGGING=true npm start
```

## Performance Considerations

1. **Pool Size**: Start with defaults (2-20) and adjust based on load
2. **Idle Timeout**: 5 minutes prevents unnecessary reconnections
3. **Health Checks**: 30-second interval balances detection time vs overhead
4. **Retry Logic**: Exponential backoff prevents connection storms

## Security Notes

- Always use SSL in production (`PG_SSL=true`)
- Store credentials securely (environment variables or secrets manager)
- Monitor connection attempts for suspicious activity
- Use connection limits to prevent DoS

## Future Improvements

Potential enhancements to consider:
1. Connection pooling per database/schema
2. Read replica support
3. Connection prioritization
4. Advanced retry strategies
5. Metrics export (Prometheus/Grafana)