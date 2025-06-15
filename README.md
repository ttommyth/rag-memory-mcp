# rag-memory-mcp

[![npm version](https://img.shields.io/npm/v/rag-memory-mcp)](https://www.npmjs.com/package/rag-memory-mcp)
[![npm downloads](https://img.shields.io/npm/dm/rag-memory-mcp)](https://www.npmjs.com/package/rag-memory-mcp)
[![GitHub license](https://img.shields.io/github/license/ttommyth/rag-memory-mcp)](https://github.com/ttommyth/rag-memory-mcp/blob/main/LICENSE)
[![Platforms](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/ttommyth/rag-memory-mcp)
[![GitHub last commit](https://img.shields.io/github/last-commit/ttommyth/rag-memory-mcp)](https://github.com/ttommyth/rag-memory-mcp/commits/main)

An advanced MCP server for **RAG-enabled memory** through a knowledge graph with **vector search** capabilities. This server extends the basic memory concepts with semantic search, document processing, and hybrid retrieval for more intelligent memory management.

**🆕 NEW: Full PostgreSQL Support** - Now supports both SQLite (default) and PostgreSQL databases with automatic adapter switching, production-ready performance optimizations, and pgvector integration for enterprise deployments.

**Inspired by:** [Knowledge Graph Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) from the Model Context Protocol project.

**Note:** This server is designed to run locally alongside MCP clients (e.g., Claude Desktop, VS Code) and requires local file system access for database storage.

## ✨ Key Features

- **🧠 Knowledge Graph Memory**: Persistent entities, relationships, and observations
- **🔍 Vector Search**: Semantic similarity search using sentence transformers
- **📄 Document Processing**: RAG-enabled document chunking and embedding
- **🔗 Hybrid Search**: Combines vector similarity with graph traversal
- **🗄️ Dual Database Support**: 
  - **SQLite**: Fast local storage with sqlite-vec for vector operations (default)
  - **PostgreSQL**: Production-ready with pgvector, JSONB, and advanced indexing
- **🎯 Entity Extraction**: Automatic term extraction from documents
- **🔄 Automated Database Migrations**: Multi-database migration system with schema versioning
- **⚡ Production Ready**: Connection pooling, transaction management, and performance optimizations

## Tools

This server provides comprehensive memory management through the Model Context Protocol (MCP):

### 📚 Document Management
- `storeDocument`: Store documents with automatic chunking and embedding generation
- `extractTerms`: Extract potential entity terms from documents
- `linkEntitiesToDocument`: Create explicit entity-document associations
- `deleteDocuments`: Remove documents and associated data
- `listDocuments`: View all stored documents with metadata

### 🧠 Knowledge Graph
- `createEntities`: Create new entities with observations and types
- `createRelations`: Establish relationships between entities. (If linked entities don't exist, they are automatically created).
- `addObservations`: Add contextual information to existing entities
- `deleteEntities`: Remove entities and their relationships
- `deleteRelations`: Remove specific relationships
- `deleteObservations`: Remove specific observations from entities
- `reEmbedEverything`: Re-embed all entities, document chunks, and knowledge graph chunks (e.g., after an embedding model update or for data consistency).

### 🔍 Search & Retrieval
- `hybridSearch`: Advanced search that first performs a semantic search for relevant nodes (entities and/or document chunks via the enhanced `searchNodes` tool) and then, if enabled via its `useGraph` parameter, enhances these results with knowledge graph traversal for superior contextual understanding.
- `searchNodes`: Finds nodes (entities, document chunks, etc.) using semantic vector similarity based on a natural language query. Can specify `nodeTypesToSearch` (e.g., `["entity"]`, `["documentChunk"]`) or defaults to searching both.
- `openNodes`: Retrieve specific entities and their relationships
- `readGraph`: Get complete knowledge graph structure
- `getDetailedContext`: Retrieve detailed context for a specific chunk, including surrounding content (often used after `hybridSearch`).

### 📊 Analytics
- `getKnowledgeGraphStats`: Comprehensive statistics about the knowledge base and RAG system.

## Usage Scenarios

This server is ideal for scenarios requiring intelligent memory and document understanding:

- **Research and Documentation**: Store, process, and intelligently retrieve research papers
- **Knowledge Base Construction**: Build interconnected knowledge from documents
- **Conversational Memory**: Remember context across chat sessions with semantic understanding
- **Content Analysis**: Extract and relate concepts from large document collections
- **Intelligent Assistance**: Provide contextually aware responses based on stored knowledge

## Client Configuration

This section explains how to configure MCP clients to use the `rag-memory-mcp` server.

### Usage with Claude Desktop / Cursor

Add the following configuration to your `claude_desktop_config.json` (Claude Desktop) or `mcp.json` (Cursor):

```json
{
  "mcpServers": {
    "rag-memory": {
      "command": "npx",
      "args": ["-y", "rag-memory-mcp"]
    }
  }
}
```

**With specific version:**
```json
{
  "mcpServers": {
    "rag-memory": {
      "command": "npx",
      "args": ["-y", "rag-memory-mcp@1.0.0"]
    }
  }
}
```

**With custom database path:**
```json
{
  "mcpServers": {
    "rag-memory": {
      "command": "npx",
      "args": ["-y", "rag-memory-mcp"],
      "env": {
        "MEMORY_DB_PATH": "/path/to/custom/memory.db"
      }
    }
  }
}
```

### Usage with VS Code

Add the following configuration to your User Settings (JSON) file or `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "rag-memory-mcp": {
        "command": "npx",
        "args": ["-y", "rag-memory-mcp"]
      }
    }
  }
}
```

## Core Concepts

### Entities
Entities are the primary nodes in the knowledge graph. Each entity has:
- A unique name (identifier)
- An entity type (e.g., "PERSON", "CONCEPT", "TECHNOLOGY")
- A list of observations (contextual information)

Example:
```json
{
  "name": "Machine Learning",
  "entityType": "CONCEPT",
  "observations": [
    "Subset of artificial intelligence",
    "Focuses on learning from data",
    "Used in recommendation systems"
  ]
}
```

### Relations
Relations define directed connections between entities, describing how they interact:

Example:
```json
{
  "from": "React",
  "to": "JavaScript",
  "relationType": "BUILT_WITH"
}
```

### Observations
Observations are discrete pieces of information about entities:
- Stored as strings
- Attached to specific entities
- Can be added or removed independently
- Should be atomic (one fact per observation)

### Documents & Vector Search
Documents are automatically processed through:
1. **Storage**: Raw text with metadata
2. **Chunking**: Automatically split into manageable pieces
3. **Embedding**: Automatically convert to vector representations
4. **Linking**: Associate with relevant entities

This enables **hybrid search** that combines:
- Vector similarity (semantic matching)
- Graph traversal (conceptual relationships)

## Database Configuration

This server supports both SQLite and PostgreSQL databases with automatic adapter switching based on environment configuration.

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

### Docker PostgreSQL Setup
Quick start with Docker:

```bash
# Start PostgreSQL with pgvector
docker-compose up -d

# Or manually:
docker run --name rag-postgres \
  -e POSTGRES_DB=rag_memory \
  -e POSTGRES_USER=rag_user \
  -e POSTGRES_PASSWORD=rag_password \
  -p 5432:5432 \
  -d pgvector/pgvector:pg16
```

### Environment Variables

**SQLite Configuration:**
- `DB_TYPE`: Set to `"sqlite"` (default if not specified)
- `DB_FILE_PATH`: Path to SQLite database file (default: `rag-memory.db`)
- `VECTOR_DIMENSIONS`: Vector embedding dimensions (default: 384)

**PostgreSQL Configuration:**
- `DB_TYPE`: Set to `"postgresql"`
- `PG_HOST`: PostgreSQL server host
- `PG_PORT`: PostgreSQL server port (default: 5432)
- `PG_DATABASE`: Database name
- `PG_USERNAME`: Database username
- `PG_PASSWORD`: Database password
- `PG_SSL`: SSL configuration ("true"/"false", default: "false")

**Performance Tuning:**
- `SQLITE_ENABLE_WAL`: Enable WAL mode for SQLite (default: true)
- `SQLITE_BUSY_TIMEOUT`: SQLite busy timeout in ms (default: 5000)
- `SQLITE_CACHE_SIZE`: SQLite cache size in KB (default: -2000)

## Development Setup

This section is for developers looking to modify or contribute to the server.

### Prerequisites
- **Node.js**: Check `package.json` for version compatibility
- **npm**: Used for package management

### Installation (Developers)

1. Clone the repository:
```bash
git clone https://github.com/ttommyth/rag-memory-mcp.git
cd rag-memory-mcp
```

2. Install dependencies:
```bash
npm install
```

### Building
```bash
npm run build
```

### Running (Development)
```bash
npm run watch  # For development with auto-rebuild
```

## Development Commands

- **Build**: `npm run build`
- **Watch**: `npm run watch`
- **Prepare**: `npm run prepare`

## Usage Example

Here's a typical workflow for building and querying a knowledge base:

```javascript
// 1. Store a document (automatically chunked and embedded)
await storeDocument({
  id: "ml_intro",
  content: "Machine learning is a subset of AI...",
  metadata: { type: "educational", topic: "ML" }
});

// 2. Extract and create entities
const terms = await extractTerms({ documentId: "ml_intro" });
await createEntities({
  entities: [
    {
      name: "Machine Learning",
      entityType: "CONCEPT",
      observations: ["Subset of artificial intelligence", "Learns from data"]
    }
  ]
});

// 3. Search with hybrid approach
const results = await hybridSearch({
  query: "artificial intelligence applications",
  limit: 10,
  useGraph: true
});
```

## System Prompt Suggestions

For optimal memory utilization, consider using this system prompt:

```
You have access to a RAG-enabled memory system with knowledge graph capabilities. Follow these guidelines:

1. **Information Storage**:
   - Store important documents using the document management tools
   - Create entities for people, concepts, organizations, and technologies
   - Build relationships between related concepts

2. **Information Retrieval**:
   - Use hybrid search for comprehensive information retrieval
   - Leverage both semantic similarity and graph relationships
   - Search entities before creating duplicates

3. **Memory Maintenance**:
   - Add observations to enrich entity context
   - Link documents to relevant entities for better discoverability
   - Use statistics to monitor knowledge base growth

4. **Processing Workflow**:
   - Store (automatic chunking & embedding) → Extract → Link
   - Documents are automatically processed for optimal search results
```

## Contributing

Contributions are welcome! Please follow standard development practices and ensure all tests pass before submitting pull requests.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

**Built with**: TypeScript, SQLite, PostgreSQL, sqlite-vec, pgvector, Hugging Face Transformers, Model Context Protocol SDK

**Database Support**: SQLite (sqlite-vec) , PostgreSQL (pgvector)
