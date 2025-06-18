# feat: Add PostgreSQL support with multi-database architecture

## Summary
- Add full PostgreSQL support alongside existing SQLite functionality
- Implement multi-database adapter pattern with automatic switching
- Add comprehensive migration system supporting both databases
- Include SQLite to PostgreSQL data migration tools
- Maintain backward compatibility with existing SQLite installations

## Key Features
- 🗄️ **Dual Database Support**: SQLite (default) and PostgreSQL with automatic adapter switching
- 🔄 **Multi-DB Migration System**: Version-isolated migrations (SQLite: 1-4, PostgreSQL: 5-7)
- 🏗️ **Adapter Pattern**: Clean separation between database implementations
- ⚙️ **Environment Configuration**: Easy switching via `DB_TYPE` environment variable
- 🔒 **Production Ready**: Connection pooling, transaction management, SSL support
- 📊 **Advanced PostgreSQL Features**: JSONB support, GIN indexes, trigram search

## Migration Support
- 🔄 **SQLite to PostgreSQL Migration**: Built-in CLI tool for seamless data transfer
- 📊 **Data Validation**: Comprehensive validation to ensure migration integrity
- ⚡ **Vector Migration**: Automatic conversion from sqlite-vec to pgvector format
- 🛡️ **Transaction Safety**: All migration operations wrapped in transactions with rollback support

## Database Configuration

### SQLite (Default)
Perfect for development and lightweight deployments:

```json
{
  "mcpServers": {
    "rag-memory": {
      "command": "npx",
      "args": ["-y", "rag-memory-mcp"],
      "env": {
        "DB_TYPE": "sqlite",
        "DB_FILE_PATH": "/path/to/custom/memory.db"
      }
    }
  }
}
```

### PostgreSQL (Production)
Ideal for production environments with advanced features:

**Benefits:**
- 🔒 **ACID Compliance**: Full transaction support with rollback capabilities  
- 📊 **Advanced Types**: JSONB for efficient metadata storage and querying
- 🔄 **Concurrent Access**: Multi-user support with connection pooling
- 📈 **Scalability**: Handle larger datasets with better memory management
- 🛡️ **Production Features**: SSL, authentication, monitoring, and backup support
- 🚧 **Vector Indexing**: HNSW vector indexes planned for improved search performance

```json
{
  "mcpServers": {
    "rag-memory": {
      "command": "npx", 
      "args": ["-y", "rag-memory-mcp"],
      "env": {
        "DB_TYPE": "postgresql",
        "PG_HOST": "localhost",
        "PG_PORT": "5432",
        "PG_DATABASE": "rag_memory",
        "PG_USERNAME": "your_user",
        "PG_PASSWORD": "your_password",
        "PG_SSL": "false"
      }
    }
  }
}
```

## Migration Usage

### Command-Line Migration Tool
The system provides a comprehensive CLI tool with the following commands:

```bash
# Check migration status
migration-cli status --sqlite-file=./memory.db

# Run migrations on PostgreSQL
migration-cli migrate --pg-host=localhost --pg-port=5432 --pg-db=rag_memory --pg-user=rag_user --pg-pass=password

# Transfer existing SQLite data to PostgreSQL
migration-cli transfer --sqlite-file=./memory.db --pg-host=localhost --pg-port=5432 --pg-db=rag_memory --pg-user=rag_user --pg-pass=password

# Validate migration completeness
migration-cli validate --sqlite-file=./memory.db --pg-host=localhost --pg-port=5432 --pg-db=rag_memory --pg-user=rag_user --pg-pass=password
```

### Available Commands
- `status` - Show migration status for a database
- `migrate` - Run pending migrations
- `rollback` - Rollback migrations to a specific version
- `transfer` - Transfer data from SQLite to PostgreSQL
- `validate` - Validate data consistency between databases
- `help` - Show help information

## Migration Strategy
- Legacy SQLite migrations (1-4) remain unchanged (SOLID principle)
- New PostgreSQL migrations (5-7) provide equivalent schema functionality
- Automatic database type detection and appropriate migration execution
- Complete data transfer: entities, relationships, documents, and vector embeddings

## Backward Compatibility
- Existing SQLite installations continue working without changes
- No breaking changes to existing MCP tool interfaces
- Automatic fallback to SQLite if PostgreSQL configuration fails

## Production Features
- **Transaction Safety** - All operations wrapped in transactions
- **Progress Monitoring** - Detailed logging and progress reporting
- **Rollback Support** - Migration rollback capabilities
- **Performance Optimization** - Batch processing and connection pooling
- **Error Recovery** - Comprehensive error handling and reporting

## Test plan
- [x] Verify SQLite functionality remains intact
- [x] Test PostgreSQL connection and schema creation
- [x] Validate migration system with both databases
- [x] Confirm environment variable configuration
- [x] Test database adapter switching
- [x] Verify production deployment scenarios
- [x] Test data migration from SQLite to PostgreSQL
- [x] Validate vector embedding migration
- [x] Confirm transaction safety and rollback capabilities

🤖 Generated with [Claude Code](https://claude.ai/code)