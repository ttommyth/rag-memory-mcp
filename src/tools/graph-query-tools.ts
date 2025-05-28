import { z } from 'zod';
import { ToolDefinition, ToolCapabilityInfo, ToolRegistrationDescription } from './types.js';

// === READ GRAPH TOOL ===

const readGraphCapability: ToolCapabilityInfo = {
  description: 'Read and retrieve the entire knowledge graph structure',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

const readGraphDescription: ToolRegistrationDescription = () => `<description>
Read and retrieve the complete knowledge graph structure including all entities and relationships.
**Provides comprehensive view of your entire knowledge base structure.**
Essential for understanding graph composition, debugging, and exporting knowledge.
</description>

<importantNotes>
- (!important!) **Returns complete graph** - may be large for extensive knowledge bases
- (!important!) Includes all entities with their observations and metadata
- (!important!) Shows all relationships with their types and directions
- (!important!) **Use with caution** on very large graphs - consider search_nodes for targeted queries
</importantNotes>

<whenToUseThisTool>
- When you need a complete overview of your knowledge graph
- For debugging relationship structures and entity compositions
- **Before major restructuring** - to understand current state
- When exporting knowledge graph data to other systems
- For generating comprehensive reports or visualizations
- When validating graph integrity and completeness
</whenToUseThisTool>

<features>
- Complete entity enumeration with full details
- Comprehensive relationship mapping with types
- Structured output suitable for processing or visualization
- Includes entity observations and metadata
- Shows relationship directionality and semantics
- Real-time reflection of current graph state
</features>

<bestPractices>
- Use search_nodes or open_nodes for large graphs to avoid overwhelming output
- Consider filtering results post-retrieval for specific analysis needs
- Cache results if doing multiple operations on static graph state
- Use for periodic backup or version control of knowledge structure
- Combine with statistics tools for comprehensive analysis
- Consider performance impact on very large graphs
</bestPractices>

<parameters>
- None required - returns complete knowledge graph structure
</parameters>

<examples>
- Complete export: {} (no parameters needed)
- Pre-analysis snapshot: {} (capture current state before modifications)
- Debug investigation: {} (understand full graph structure for troubleshooting)
</examples>`;

const readGraphSchema: z.ZodRawShape = {};

export const readGraphTool: ToolDefinition = {
  capability: readGraphCapability,
  description: readGraphDescription,
  schema: readGraphSchema,
};

// === SEARCH NODES TOOL ===

const searchNodesCapability: ToolCapabilityInfo = {
  description: 'Search for nodes (entities, document chunks, etc.) in the knowledge base using semantic vector similarity',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query for semantic similarity matching'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return',
        default: 10
      },
      nodeTypesToSearch: {
        type: 'array',
        description: 'Array of node types to search (e.g., "entity", "documentChunk"). Defaults to ["entity", "documentChunk"]',
        items: {
          type: 'string'
        },
        default: ['entity', 'documentChunk']
      }
    },
    required: ['query'],
  },
};

const searchNodesDescription: ToolRegistrationDescription = () => `<description>
Search for specific nodes (e.g., entities, document chunks) in the knowledge base using semantic vector similarity.
**Perfect for intelligent discovery using natural language queries across different types of stored information.**
Uses semantic embeddings to find conceptually similar nodes, even without exact keyword matches.
</description>

<importantNotes>
- (!important!) **Semantic vector search** - finds conceptually similar nodes, not just keyword matches
- (!important!) **Requires node embeddings** - nodes (entities, document chunks) are automatically embedded when created/processed
- (!important!) **Returns similarity scores** with matching nodes and their relevant details (e.g., entity relationships, document context)
- (!important!) More intelligent than traditional pattern matching - understands context and meaning
- (!important!) Specify 'nodeTypesToSearch' to target specific types like 'entity' or 'documentChunk', or search both by default.
</importantNotes>

<whenToUseThisTool>
- When looking for entities or documents conceptually related to your query
- **Before creating new entities** - to discover existing similar concepts
- When exploring knowledge domains using natural language across different data types
- For intelligent discovery without knowing exact names or locations
- When building semantic subgraphs or collections around particular concepts
- For content-aware exploration and research across entities and documents
</whenToUseThisTool>

<features>
- Semantic similarity search using sentence transformers
- Natural language query processing for node discovery
- Filter by node types (e.g., "entity", "documentChunk")
- Similarity scoring for result ranking and relevance
- Returns complete node information (e.g., entity observations, document text)
- Includes relationships for entity nodes
- Configurable result limits for focused or broad exploration
</features>

<bestPractices>
- Use natural language descriptions rather than exact keywords
- Try conceptual queries like "artificial intelligence frameworks" or "database technologies impact on healthcare"
- Utilize 'nodeTypesToSearch' to focus your search if needed (e.g., only 'entity' or only 'documentChunk')
- Start with broader queries, then refine based on similarity scores and node types
- Nodes are automatically embedded when created/processed
- Review similarity scores to understand conceptual relevance
- Combine with openNodes (for entities) or getDetailedContext (for documents) for detailed analysis of interesting findings
</bestPractices>

<parameters>
- query: Natural language search query for semantic node discovery (string, required)
- limit: Maximum number of similar nodes to return, default 10 (number, optional)
- nodeTypesToSearch: Array of node types to include in the search (e.g., "entity", "documentChunk"). Defaults to ["entity", "documentChunk"] (string[], optional)
</parameters>

<examples>
- Conceptual search (entities & documents): {"query": "machine learning frameworks", "limit": 5}
- Entity-only search: {"query": "web development tools", "nodeTypesToSearch": ["entity"]}
- Document-only search: {"query": "impact of AI on climate change", "nodeTypesToSearch": ["documentChunk"]}
- Domain exploration (entities & documents): {"query": "quantum physics concepts", "limit": 15}
- Semantic similarity (entities & documents): {"query": "data visualization libraries"}
- Research queries (entities & documents): {"query": "renewable energy technologies and their economic feasibility"}
</examples>`;

const searchNodesSchema: z.ZodRawShape = {
  query: z.string().describe('Natural language search query for semantic node discovery'),
  limit: z.number().optional().default(10).describe('Maximum number of similar nodes to return'),
  nodeTypesToSearch: z.array(z.string()).optional().default(['entity', 'documentChunk']).describe('Array of node types to search (e.g., "entity", "documentChunk"). Defaults to ["entity", "documentChunk"]'),
};

export const searchNodesTool: ToolDefinition = {
  capability: searchNodesCapability,
  description: searchNodesDescription,
  schema: searchNodesSchema,
};

// === OPEN NODES TOOL ===

const openNodesCapability: ToolCapabilityInfo = {
  description: 'Retrieve specific entities and their relationships by exact names',
  parameters: {
    type: 'object',
    properties: {
      names: {
        type: 'array',
        description: 'Array of exact entity names to retrieve'
      }
    },
    required: ['names'],
  },
};

const openNodesDescription: ToolRegistrationDescription = () => `<description>
Retrieve specific entities and their interconnected relationships by providing exact entity names.
**Ideal for focused analysis of known entities and their connection patterns.**
Returns detailed subgraph showing how specified entities relate to each other.
</description>

<importantNotes>
- (!important!) **Requires exact entity names** - use search_nodes first if uncertain
- (!important!) Returns entities with full details and observations
- (!important!) **Shows relationships between specified entities** - perfect for connection analysis
- (!important!) More precise than search - use when you know exactly what you want
</importantNotes>

<whenToUseThisTool>
- When you have specific entity names and want detailed information
- **For analyzing relationships** between known entities
- When building focused subgraphs around particular entities
- For validating specific entity data and connections
- When following up on search results with detailed exploration
- For debugging specific entity or relationship issues
</whenToUseThisTool>

<features>
- Exact entity retrieval by name
- Complete entity details including all observations
- Relationship mapping between specified entities
- Structured output showing entity interconnections
- Efficient lookup for known entity names
- Suitable for building focused knowledge subsets
</features>

<bestPractices>
- Use exact entity names as they appear in your knowledge graph
- Combine related entities in single request for relationship analysis
- Use after search_nodes to explore interesting findings in detail
- Verify entity names if you get empty results
- Group logically related entities for coherent subgraph analysis
- Use for validating entity relationships and data quality
</bestPractices>

<parameters>
- names: Array of exact entity names to retrieve with relationships (string[], required)
</parameters>

<examples>
- Single entity: {"names": ["Albert Einstein"]}
- Related entities: {"names": ["React", "JavaScript", "Facebook"]}
- Research analysis: {"names": ["Machine Learning", "Neural Networks", "Deep Learning"]}
- Validation check: {"names": ["Entity1", "Entity2", "Entity3"]}
</examples>`;

const openNodesSchema: z.ZodRawShape = {
  names: z.array(z.string()).describe('Array of exact entity names to retrieve with their relationships'),
};

export const openNodesTool: ToolDefinition = {
  capability: openNodesCapability,
  description: openNodesDescription,
  schema: openNodesSchema,
};

// === DELETE ENTITIES TOOL ===

const deleteEntitiesCapability: ToolCapabilityInfo = {
  description: 'Delete multiple entities and their associated relationships from the knowledge graph',
  parameters: {
    type: 'object',
    properties: {
      entityNames: {
        type: 'array',
        description: 'Array of entity names to delete from the knowledge graph'
      }
    },
    required: ['entityNames'],
  },
};

const deleteEntitiesDescription: ToolRegistrationDescription = () => `<description>
Delete multiple entities and their associated relationships from the knowledge graph.
**Permanent operation that removes entities and all their connections.**
Use with caution as this operation cannot be undone and affects graph structure.
</description>

<importantNotes>
- (!important!) **Permanent deletion** - cannot be undone without backup
- (!important!) **Removes all relationships** involving the deleted entities
- (!important!) Affects graph connectivity - may orphan related entities
- (!important!) **Use search_nodes first** to verify entities before deletion
</importantNotes>

<whenToUseThisTool>
- When removing obsolete or incorrect entities from your graph
- **After careful verification** of entities to be deleted
- When cleaning up duplicate or redundant entities
- When restructuring knowledge domains
- When removing entities that are no longer relevant
- For knowledge base maintenance and cleanup operations
</whenToUseThisTool>

<features>
- Batch deletion of multiple entities
- Automatic cleanup of associated relationships
- Maintains graph integrity after deletion
- Cascading removal of entity references
- Safe handling of dependencies and connections
- Efficient bulk deletion operations
</features>

<bestPractices>
- ALWAYS verify entity names and impact before deletion
- Use search_nodes to understand entity connections first
- Consider archiving instead of deleting for important historical data
- Backup your knowledge graph before major deletion operations
- Delete in small batches for large cleanup operations
- Review relationship impacts on remaining entities
</bestPractices>

<parameters>
- entityNames: Array of exact entity names to delete (string[], required)
</parameters>

<examples>
- Remove duplicates: {"entityNames": ["Duplicate Entity 1", "Duplicate Entity 2"]}
- Clean obsolete: {"entityNames": ["Old Technology", "Deprecated Framework"]}
- Single removal: {"entityNames": ["Incorrect Entity"]}
</examples>`;

const deleteEntitiesSchema: z.ZodRawShape = {
  entityNames: z.array(z.string()).describe('Array of exact entity names to permanently delete'),
};

export const deleteEntitiesTool: ToolDefinition = {
  capability: deleteEntitiesCapability,
  description: deleteEntitiesDescription,
  schema: deleteEntitiesSchema,
};

// === DELETE RELATIONS TOOL ===

const deleteRelationsCapability: ToolCapabilityInfo = {
  description: 'Delete specific relationships from the knowledge graph while preserving entities',
  parameters: {
    type: 'object',
    properties: {
      relations: {
        type: 'array',
        description: 'Array of specific relationships to delete'
      }
    },
    required: ['relations'],
  },
};

const deleteRelationsDescription: ToolRegistrationDescription = () => `<description>
Delete specific relationships from the knowledge graph while preserving the entities themselves.
**Precise operation for removing incorrect or obsolete connections.**
Allows fine-tuned graph structure modification without losing entity information.
</description>

<importantNotes>
- (!important!) **Entities remain intact** - only relationships are removed
- (!important!) Requires exact relationship specification (from, to, type)
- (!important!) **May affect graph connectivity** - could isolate entities
- (!important!) Permanent operation - verify relationships before deletion
</importantNotes>

<whenToUseThisTool>
- When correcting incorrect relationships between entities
- **For fine-tuning graph structure** without losing entities
- When relationships become obsolete but entities remain valid
- When restructuring relationship types or semantics
- For removing duplicate or redundant relationships
- When debugging relationship connectivity issues
</whenToUseThisTool>

<features>
- Precise relationship removal by exact specification
- Preserves entities while modifying connections
- Batch deletion of multiple relationships
- Maintains entity integrity during relationship removal
- Supports complex relationship cleanup operations
- Safe handling of graph structure modifications
</features>

<bestPractices>
- Verify relationship details before deletion using search tools
- Consider impact on graph connectivity and traversal paths
- Use read_graph or open_nodes to understand relationship context
- Delete relationships in logical groups for coherent operations
- Test relationship queries after deletion to verify expected behavior
- Document reasons for relationship removal for future reference
</bestPractices>

<parameters>
- relations: Array of relationship objects to delete, each containing:
  - from: Name of the source entity (string, required)
  - to: Name of the target entity (string, required)  
  - relationType: Type of relationship to delete (string, required)
</parameters>

<examples>
- Remove incorrect: {"relations": [{"from": "Entity A", "to": "Entity B", "relationType": "INCORRECT_RELATION"}]}
- Clean duplicates: {"relations": [{"from": "React", "to": "JavaScript", "relationType": "DUPLICATE_USES"}]}
- Restructure: {"relations": [{"from": "Old Connection", "to": "Target", "relationType": "OBSOLETE"}]}
</examples>`;

const deleteRelationsSchema: z.ZodRawShape = {
  relations: z.array(z.object({
    from: z.string().describe('Name of the source entity in the relationship to delete'),
    to: z.string().describe('Name of the target entity in the relationship to delete'),
    relationType: z.string().describe('Type of relationship to delete'),
  })).describe('Array of specific relationships to delete'),
};

export const deleteRelationsTool: ToolDefinition = {
  capability: deleteRelationsCapability,
  description: deleteRelationsDescription,
  schema: deleteRelationsSchema,
};

// === DELETE OBSERVATIONS TOOL ===

const deleteObservationsCapability: ToolCapabilityInfo = {
  description: 'Delete specific observations from entities while preserving the entities themselves',
  parameters: {
    type: 'object',
    properties: {
      deletions: {
        type: 'array',
        description: 'Array of observation deletions for specific entities'
      }
    },
    required: ['deletions'],
  },
};

const deleteObservationsDescription: ToolRegistrationDescription = () => `<description>
Delete specific observations from entities while preserving the entities and other observations.
**Precise content management for refining entity information.**
Allows selective removal of outdated, incorrect, or redundant observations.
</description>

<importantNotes>
- (!important!) **Entities remain intact** - only specified observations are removed
- (!important!) Requires exact observation text matching
- (!important!) **Other observations preserved** - selective removal only
- (!important!) Use carefully - observations provide entity context and evidence
</importantNotes>

<whenToUseThisTool>
- When removing outdated or incorrect observations from entities
- **For content quality management** and information accuracy
- When observations become irrelevant or superseded
- When correcting entity information without full rebuilding
- For removing duplicate or redundant observations
- When refining entity descriptions for clarity
</whenToUseThisTool>

<features>
- Selective observation removal by exact text matching
- Preserves entities and other observations
- Batch processing of multiple observation deletions
- Maintains entity integrity during content updates
- Supports precise information management
- Safe handling of entity content modifications
</features>

<bestPractices>
- Verify exact observation text before deletion using search or open tools
- Consider whether updating is better than deleting observations
- Remove observations that are clearly incorrect or outdated
- Maintain enough observations to preserve entity context
- Group related observation deletions for coherent operations
- Document reasons for observation removal when significant
</bestPractices>

<parameters>
- deletions: Array of observation deletion objects, each containing:
  - entityName: Name of the entity containing observations to delete (string, required)
  - observations: Array of exact observation texts to remove (string[], required)
</parameters>

<examples>
- Remove outdated: {"deletions": [{"entityName": "Technology X", "observations": ["Discontinued in 2020", "No longer supported"]}]}
- Fix errors: {"deletions": [{"entityName": "Person Y", "observations": ["Incorrect birth year 1980"]}]}
- Clean duplicates: {"deletions": [{"entityName": "Concept Z", "observations": ["Duplicate description text"]}]}
</examples>`;

const deleteObservationsSchema: z.ZodRawShape = {
  deletions: z.array(z.object({
    entityName: z.string().describe('Name of the entity containing observations to delete'),
    observations: z.array(z.string()).describe('Array of exact observation texts to remove'),
  })).describe('Array of observation deletion specifications'),
};

export const deleteObservationsTool: ToolDefinition = {
  capability: deleteObservationsCapability,
  description: deleteObservationsDescription,
  schema: deleteObservationsSchema,
};

// Export all graph query tools
export const graphQueryTools = {
  readGraph: readGraphTool,
  searchNodes: searchNodesTool,
  openNodes: openNodesTool,
  deleteEntities: deleteEntitiesTool,
  deleteRelations: deleteRelationsTool,
  deleteObservations: deleteObservationsTool,
}; 