import { z } from 'zod';
import { ToolDefinition, ToolCapabilityInfo, ToolRegistrationDescription } from './types.js';

// === CREATE ENTITIES TOOL ===

const createEntitiesCapability: ToolCapabilityInfo = {
  description: 'Create multiple new entities in the knowledge graph with comprehensive metadata',
  parameters: {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        description: 'Array of entities to create in the knowledge graph',
        items: {
          type: 'object'
        }
      }
    },
    required: ['entities'],
  },
};

const createEntitiesDescription: ToolRegistrationDescription = () => `<description>
Create multiple new entities in the knowledge graph with comprehensive metadata and observations.
**Essential for building the foundational structure of your knowledge representation.**
Use this tool to add new concepts, people, places, or any identifiable objects to your graph.
**Automatically generates vector embeddings** for semantic search capabilities.
</description>

<importantNotes>
- (!important!) **Entities are the building blocks** of your knowledge graph - use descriptive names
- (!important!) EntityType helps categorize and filter entities (e.g., PERSON, CONCEPT, PLACE, TECHNOLOGY)
- (!important!) Observations provide context and evidence for the entity's existence or properties
- (!important!) **Avoid duplicate entities** - check if similar entities exist first using search_nodes
- (!important!) **Vector embeddings are automatically generated** for semantic search
</importantNotes>

<whenToUseThisTool>
- When introducing new concepts, people, or objects into your knowledge base
- When processing documents and need to extract and formalize key entities
- When building domain-specific knowledge representations
- When creating structured data from unstructured text
- **Before creating relationships** - ensure both entities exist
- When migrating knowledge from other systems into the graph
</whenToUseThisTool>

<features>
- Batch creation of multiple entities in a single operation
- Automatic unique ID generation based on entity names
- Support for custom entity types for domain categorization
- Rich observation arrays for evidence and context
- Automatic deduplication (existing entities are ignored)
- Metadata support for extensible entity properties
- **Automatic vector embedding generation** for semantic search
</features>

<bestPractices>
- Use consistent naming conventions (e.g., "John Smith" not "john smith")
- Choose meaningful entityTypes that reflect your domain (PERSON, TECHNOLOGY, CONCEPT, etc.)
- Include rich observations that provide context and evidence
- Group related entity creation for better performance
- Use descriptive names that uniquely identify the entity
- Consider hierarchical naming for complex domains (e.g., "JavaScript.React.Hooks")
</bestPractices>

<parameters>
- entities: Array of entity objects, each containing:
  - name: Unique identifier/name for the entity (string, required)
  - entityType: Category/classification of the entity (string, required)
  - observations: Array of contextual information and evidence (string[], required)
</parameters>

<examples>
- Adding people: {"entities": [{"name": "Albert Einstein", "entityType": "PERSON", "observations": ["Physicist who developed relativity theory", "Nobel Prize winner in 1921"]}]}
- Adding concepts: {"entities": [{"name": "Machine Learning", "entityType": "CONCEPT", "observations": ["Subset of artificial intelligence", "Focuses on learning from data"]}]}
- Adding technologies: {"entities": [{"name": "React", "entityType": "TECHNOLOGY", "observations": ["JavaScript library for building UIs", "Developed by Facebook"]}]}
</examples>`;

const createEntitiesSchema: z.ZodRawShape = {
  entities: z.array(z.object({
    name: z.string().describe('The unique name/identifier of the entity'),
    entityType: z.string().describe('The category or type of the entity (e.g., PERSON, CONCEPT, TECHNOLOGY)'),
    observations: z.array(z.string()).describe('Array of contextual observations about the entity'),
  })).describe('Array of entities to create in the knowledge graph'),
};

export const createEntitiesTool: ToolDefinition = {
  capability: createEntitiesCapability,
  description: createEntitiesDescription,
  schema: createEntitiesSchema,
};

// === CREATE RELATIONS TOOL ===

const createRelationsCapability: ToolCapabilityInfo = {
  description: 'Create multiple relationships between entities in the knowledge graph',
  parameters: {
    type: 'object',
    properties: {
      relations: {
        type: 'array',
        description: 'Array of relationships to create between existing entities',
        items: {
          type: 'object'
        }
      }
    },
    required: ['relations'],
  },
};

const createRelationsDescription: ToolRegistrationDescription = () => `<description>
Create multiple relationships between entities in the knowledge graph to establish connections and semantic links.
**Critical for building the interconnected structure that makes knowledge graphs powerful.**
Relationships define how entities relate to each other, enabling graph traversal and inference.
</description>

<importantNotes>
- (!important!) **Both entities must exist** before creating relationships - entities are auto-created if missing
- (!important!) Relationship types should be consistent and meaningful (e.g., IS_A, HAS, USES, IMPLEMENTS)
- (!important!) Direction matters: "from" → "to" represents the relationship direction
- (!important!) **Avoid redundant relationships** - check existing connections first
</importantNotes>

<whenToUseThisTool>
- When establishing semantic connections between concepts
- After creating entities that should be connected
- When processing text that implies relationships
- When building domain-specific ontologies
- When migrating relational data into graph format
- **Before querying graph paths** - ensure proper connectivity
</whenToUseThisTool>

<features>
- Batch creation of multiple relationships in one operation
- Automatic entity creation if referenced entities don't exist
- Support for custom relationship types
- Bidirectional relationship awareness
- Confidence scoring and metadata support
- Deduplication of identical relationships
</features>

<bestPractices>
- Use consistent relationship types across your domain
- Choose clear, unambiguous relationship names (IS_A, PART_OF, IMPLEMENTS)
- Consider both directions when appropriate (if A USES B, does B DEPEND_ON A?)
- Group related relationship creation for better performance
- Use verb-like relationship types that read naturally
- Document relationship semantics for complex domains
</bestPractices>

<parameters>
- relations: Array of relationship objects, each containing:
  - from: Name of the source entity (string, required)
  - to: Name of the target entity (string, required)
  - relationType: Type/category of the relationship (string, required)
</parameters>

<examples>
- Inheritance: {"relations": [{"from": "Dog", "to": "Animal", "relationType": "IS_A"}]}
- Usage: {"relations": [{"from": "React", "to": "JavaScript", "relationType": "USES"}]}
- Composition: {"relations": [{"from": "Car", "to": "Engine", "relationType": "HAS"}]}
- Multiple: {"relations": [{"from": "Einstein", "to": "Relativity", "relationType": "DEVELOPED"}, {"from": "Relativity", "to": "Physics", "relationType": "PART_OF"}]}
</examples>`;

const createRelationsSchema: z.ZodRawShape = {
  relations: z.array(z.object({
    from: z.string().describe('Name of the source entity in the relationship'),
    to: z.string().describe('Name of the target entity in the relationship'),
    relationType: z.string().describe('Type of relationship (e.g., IS_A, HAS, USES, IMPLEMENTS)'),
  })).describe('Array of relationships to create between entities'),
};

export const createRelationsTool: ToolDefinition = {
  capability: createRelationsCapability,
  description: createRelationsDescription,
  schema: createRelationsSchema,
};

// === ADD OBSERVATIONS TOOL ===

const addObservationsCapability: ToolCapabilityInfo = {
  description: 'Add new observations to existing entities to enrich their context and evidence',
  parameters: {
    type: 'object',
    properties: {
      observations: {
        type: 'array',
        description: 'Array of observation additions for specific entities',
        items: {
          type: 'object'
        }
      }
    },
    required: ['observations'],
  },
};

const addObservationsDescription: ToolRegistrationDescription = () => `<description>
Add new observations to existing entities to continuously enrich their context, evidence, and understanding.
**Essential for keeping your knowledge graph current and comprehensive.**
Observations provide the factual foundation that supports entity existence and properties.
</description>

<importantNotes>
- (!important!) **Entity must exist** - this tool only adds to existing entities
- (!important!) Only new observations are added - duplicates are automatically filtered
- (!important!) Observations are cumulative - they build the entity's knowledge base
- (!important!) **Be specific and factual** - observations should be verifiable statements
</importantNotes>

<whenToUseThisTool>
- When you discover new information about existing entities
- After processing additional documents that mention known entities
- When updating entity knowledge from new sources
- When refining and expanding entity descriptions
- **Before making knowledge-based decisions** - ensure entities have sufficient context
- When correcting or expanding incomplete entity information
</whenToUseThisTool>

<features>
- Batch addition of observations to multiple entities
- Automatic duplicate filtering - no redundant observations
- Supports rich textual observations with context
- Maintains observation history and chronology
- Integrates with document processing workflows
- Enables incremental knowledge building
</features>

<bestPractices>
- Keep observations factual and specific rather than general
- Include source context when possible ("According to paper X...")
- Use consistent terminology across observations
- Add complementary observations that provide different perspectives
- Include temporal information when relevant ("As of 2024...")
- Group related observations by topic or source
</bestPractices>

<parameters>
- observations: Array of observation addition objects, each containing:
  - entityName: Name of the existing entity to update (string, required)
  - contents: Array of new observation strings to add (string[], required)
</parameters>

<examples>
- Scientific updates: {"observations": [{"entityName": "Quantum Computing", "contents": ["IBM achieved quantum advantage in 2024", "Shows promise for cryptography applications"]}]}
- Person details: {"observations": [{"entityName": "Marie Curie", "contents": ["First woman to win Nobel Prize", "Won Nobel Prizes in two different sciences"]}]}
- Technology evolution: {"observations": [{"entityName": "React", "contents": ["React 18 introduced concurrent features", "Widely adopted for enterprise applications"]}]}
</examples>`;

const addObservationsSchema: z.ZodRawShape = {
  observations: z.array(z.object({
    entityName: z.string().describe('Name of the existing entity to add observations to'),
    contents: z.array(z.string()).describe('Array of new observation strings to add'),
  })).describe('Array of observation additions for specific entities'),
};

export const addObservationsTool: ToolDefinition = {
  capability: addObservationsCapability,
  description: addObservationsDescription,
  schema: addObservationsSchema,
};

// === HYBRID SEARCH TOOL ===

const hybridSearchCapability: ToolCapabilityInfo = {
  description: 'Perform advanced hybrid search combining an initial semantic search (across entities and/or documents) with knowledge graph traversal for enhanced results.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant information'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return',
        default: 5
      },
      useGraph: {
        type: 'boolean',
        description: 'Whether to enhance results with knowledge graph connections',
        default: true
      }
    },
    required: ['query'],
  },
};

const hybridSearchDescription: ToolRegistrationDescription = () => `<description>
Perform sophisticated hybrid search. This tool first uses semantic similarity (via the enhanced 'searchNodes' tool) to find relevant entities and/or document chunks, and then, if enabled, enhances these results with knowledge graph traversal for superior contextual understanding.
**The most powerful search tool in the system** - leverages both initial semantic similarity and structural relationships from the graph.
Perfect for complex queries that benefit from both direct content matching and broader conceptual connections.
</description>

<importantNotes>
- (!important!) **Hybrid approach is more powerful** than pure vector or graph search alone due to its two-stage process.
- (!important!) Initial semantic search leverages the versatile 'searchNodes' tool to find relevant base items (entities, documents).
- (!important!) Graph enhancement (controlled by 'useGraph') then finds related concepts and connections even if not directly matched in the initial semantic search.
- (!important!) Results include similarity scores, graph boost indicators, and hybrid rankings.
- (!important!) **Best results when knowledge graph is well-populated** with entities and relationships to support the enhancement stage.
</importantNotes>

<whenToUseThisTool>
- When you need comprehensive search across documents and knowledge, with an emphasis on graph-based connections.
- For complex queries requiring deep conceptual understanding beyond initial semantic matches.
- When exploring relationships between concepts surfaced by an initial search.
- **Before making decisions** - to gather all relevant information, including indirectly related items found via graph traversal.
- When researching topics that span multiple domains and require connecting disparate pieces of information.
- For discovery of implicit connections and patterns that simple semantic search might miss.
</whenToUseThisTool>

<features>
- Initial semantic similarity search across specified node types (entities, documents) via 'searchNodes'.
- Optional knowledge graph traversal for conceptual enhancement and discovery of related items.
- Hybrid scoring combining multiple relevance signals (initial similarity, graph boost).
- Entity association highlighting based on graph connections.
- Configurable result limits and graph usage.
- Rich result metadata with multiple ranking scores.
</features>

<bestPractices>
- Use natural language queries rather than just keywords.
- Enable graph enhancement ('useGraph': true) for better conceptual coverage and discovery of related information.
- Start with broader queries, then narrow down based on results from both semantic search and graph enhancement.
- Review entity associations to understand how graph traversal contributed to the results.
- Use appropriate limits based on your analysis needs.
- Combine with other tools like 'getDetailedContext' or 'openNodes' for comprehensive knowledge exploration of the hybrid results.
</bestPractices>

<parameters>
- query: Natural language search query (string, required) - passed to initial semantic search.
- limit: Maximum results to return, default 5 (number, optional) - influences initial search and final output.
- useGraph: Enable knowledge graph enhancement after initial semantic search, default true (boolean, optional).
</parameters>

<examples>
- Conceptual search with graph enhancement: {"query": "machine learning applications in healthcare", "limit": 10, "useGraph": true}
- Technical research with graph enhancement: {"query": "React performance optimization techniques", "useGraph": true}
- Discovery mode with graph enhancement: {"query": "Einstein's contributions to modern physics", "limit": 15, "useGraph": true}
- Semantic search of documents/entities *without* graph enhancement: {"query": "quantum computing advantages", "limit": 3, "useGraph": false} (relies on 'searchNodes' broad default)
</examples>`;

const hybridSearchSchema: z.ZodRawShape = {
  query: z.string().describe('The search query to find relevant information'),
  limit: z.number().optional().default(5).describe('Maximum number of results to return'),
  useGraph: z.boolean().optional().default(true).describe('Whether to enhance results with knowledge graph connections'),
};

export const hybridSearchTool: ToolDefinition = {
  capability: hybridSearchCapability,
  description: hybridSearchDescription,
  schema: hybridSearchSchema,
};

// embedAllEntities tool removed - entities are now automatically embedded when created

// === GET DETAILED CONTEXT TOOL ===

const getDetailedContextCapability: ToolCapabilityInfo = {
  description: 'Retrieve detailed context for a specific chunk including surrounding content',
  parameters: {
    type: 'object',
    properties: {
      chunkId: {
        type: 'string',
        description: 'ID of the chunk to get detailed context for'
      },
      includeSurrounding: {
        type: 'boolean',
        description: 'Whether to include surrounding chunks for better context',
        default: true
      }
    },
    required: ['chunkId'],
  },
};

const getDetailedContextDescription: ToolRegistrationDescription = () => `<description>
Retrieve comprehensive detailed context for a specific chunk, including the full text and surrounding content.
**Essential companion to hybridSearch** - use this to get complete context after reviewing search summaries.
Perfect drill-down tool for exploring the full content behind search result highlights.
</description>

<importantNotes>
- (!important!) **Use after hybridSearch** - to explore full context of interesting results
- (!important!) **Returns complete chunk text** - not just summaries or highlights
- (!important!) **Includes surrounding chunks** - for better context understanding
- (!important!) **Shows entity associations** - to understand knowledge graph connections
</importantNotes>

<whenToUseThisTool>
- **After reviewing hybridSearch results** - to get full context of interesting chunks
- When search summaries indicate relevant content that needs complete analysis
- When you need full text for decision making or detailed understanding
- When exploring content around a specific passage or concept
- For reading complete passages in their original document context
- When entity associations in search results warrant deeper investigation
</whenToUseThisTool>

<features>
- Complete chunk text retrieval without truncation
- Automatic surrounding chunk inclusion for context
- Entity association information for knowledge graph insights
- Document metadata and title for source identification
- Structured context with clear before/after chunk positioning
- Efficient lookup by chunk ID from search results
</features>

<bestPractices>
- Use hybridSearch first to identify relevant chunks of interest
- Review search summaries before requesting detailed context
- Use surrounding context to understand passage flow and meaning
- Pay attention to entity associations for related concept exploration
- Combine with additional searches based on detailed context insights
- Use for final verification when making knowledge-based decisions
</bestPractices>

<parameters>
- chunkId: Chunk ID from search results (string, required)
- includeSurrounding: Include before/after chunks, default true (boolean, optional)
</parameters>

<examples>
- Full context: {"chunkId": "doc1_chunk_5"}
- Context only: {"chunkId": "doc1_chunk_5", "includeSurrounding": false}
- From search: {"chunkId": "advanced_delivery_features_technical_chunk_2"}
</examples>`;

const getDetailedContextSchema: z.ZodRawShape = {
  chunkId: z.string().describe('ID of the chunk to get detailed context for'),
  includeSurrounding: z.boolean().optional().default(true).describe('Whether to include surrounding chunks for better context'),
};

export const getDetailedContextTool: ToolDefinition = {
  capability: getDetailedContextCapability,
  description: getDetailedContextDescription,
  schema: getDetailedContextSchema,
};

// === RE-EMBED EVERYTHING TOOL ===

const reEmbedEverythingCapability: ToolCapabilityInfo = {
  description: 'Re-embed all entities, document chunks, and knowledge graph chunks in the system.',
  parameters: {
    type: 'object',
    properties: {}, // No parameters needed
    required: [],
  },
};

const reEmbedEverythingDescription: ToolRegistrationDescription = () => `<description>
Trigger a full re-embedding of all entities (including their latest observations), all document chunks, and all specialized knowledge graph chunks.
**Use this tool to refresh all embeddings if the underlying embedding model has changed or if data consistency is suspected.**
This can be a long-running operation depending on the size of the knowledge base.
</description>

<importantNotes>
- (!important!) **Comprehensive Re-embedding**: Affects all entities, documents, and KG chunks.
- (!important!) **Potential for Long Duration**: Execution time depends on data volume.
- (!important!) **Ensures Consistency**: Useful after model updates or data migrations.
</importantNotes>

<whenToUseThisTool>
- After updating the embedding model used by the system.
- If you suspect embeddings might be out of sync with source data.
- Periodically for maintenance to ensure all items are embedded with the latest logic.
- Before critical analyses that rely on up-to-date semantic representations.
</whenToUseThisTool>

<features>
- Re-embeds all entities.
- Re-embeds all document chunks for all stored documents.
- Re-embeds all specialized knowledge graph chunks (entity/relationship representations).
- Provides a summary of actions taken.
</features>

<bestPractices>
- Use during off-peak hours if your knowledge base is large.
- Ensure the embedding model is stable and correctly configured before running.
- Monitor system logs for progress and any potential errors.
</bestPractices>

<parameters>
- None
</parameters>

<examples>
- Re-embed everything: {}
</examples>`;

const reEmbedEverythingSchema: z.ZodRawShape = {}; // No parameters

export const reEmbedEverythingTool: ToolDefinition = {
  capability: reEmbedEverythingCapability,
  description: reEmbedEverythingDescription,
  schema: reEmbedEverythingSchema,
};

// Export all knowledge graph tools
export const knowledgeGraphTools = {
  createEntities: createEntitiesTool,
  createRelations: createRelationsTool,
  addObservations: addObservationsTool,
  hybridSearch: hybridSearchTool,
  // embedAllEntities removed - entities are now automatically embedded when created
  getDetailedContext: getDetailedContextTool,
  reEmbedEverything: reEmbedEverythingTool, // Added new tool
}; 