import { z } from 'zod';
import { ToolDefinition, ToolCapabilityInfo, ToolRegistrationDescription } from './types.js';

// === STORE DOCUMENT TOOL ===

const storeDocumentCapability: ToolCapabilityInfo = {
  description: 'Store a document with automatic chunking and embedding generation',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Unique identifier for the document'
      },
      content: {
        type: 'string',
        description: 'The full text content of the document'
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata for the document (optional)',
        additionalProperties: true,
        optional: true
      },
      maxTokens: {
        type: 'number',
        description: 'Maximum tokens per chunk (default: 200)',
        optional: true
      },
      overlap: {
        type: 'number',
        description: 'Number of overlapping tokens between chunks (default: 20)',
        optional: true
      }
    },
    required: ['id', 'content'],
  },
};

const storeDocumentDescription: ToolRegistrationDescription = () => `<description>
Store a document in the system with **automatic chunking and vector embedding generation**.
**Complete document processing in a single step** - ready for semantic search immediately.
Automatically chunks the document and generates vector embeddings for optimal retrieval.
</description>

<importantNotes>
- (!important!) **Document ID must be unique** - existing documents with same ID will be replaced
- (!important!) **Automatic processing** - chunks and embeds the document automatically
- (!important!) **Ready for search immediately** - no additional steps required
- (!important!) **Configurable chunking** - uses optimal defaults but can be customized
</importantNotes>

<whenToUseThisTool>
- When you want to store documents and make them immediately searchable
- **Primary tool for document ingestion** - handles all processing automatically
- When building a searchable knowledge base from documents
- When you need documents ready for hybrid search capabilities
</whenToUseThisTool>

<bestPractices>
- Use descriptive document IDs that indicate source or content type
- Include relevant metadata (author, date, source, domain, etc.)
- Consider document preprocessing before storage if needed
- Use this as the primary document ingestion tool
</bestPractices>

<examples>
- Research paper: {"id": "einstein_1905_relativity", "content": "On the Electrodynamics of Moving Bodies...", "metadata": {"author": "Albert Einstein", "year": 1905, "type": "scientific_paper"}}
- Business doc: {"id": "quarterly_report_q3", "content": "Q3 2024 Performance Summary...", "metadata": {"type": "financial", "quarter": "Q3", "year": 2024}}
- Custom chunking: {"id": "technical_manual", "content": "Technical documentation...", "maxTokens": 300, "overlap": 30, "metadata": {"type": "manual"}}
</examples>`;

const storeDocumentSchema: z.ZodRawShape = {
  id: z.string().describe('Unique identifier for the document'),
  content: z.string().describe('The full text content of the document'),
  metadata: z.record(z.any()).optional().describe('Additional metadata for the document'),
  maxTokens: z.number().default(200).optional().describe('Maximum tokens per chunk'),
  overlap: z.number().default(20).optional().describe('Number of overlapping tokens between chunks'),
};

export const storeDocumentTool: ToolDefinition = {
  capability: storeDocumentCapability,
  description: storeDocumentDescription,
  schema: storeDocumentSchema,
};

// chunkDocument and embedChunks tools removed - functionality is now automatic in storeDocument

// === EXTRACT TERMS TOOL ===

const extractTermsCapability: ToolCapabilityInfo = {
  description: 'Extract potential entities/terms from a document with configurable patterns',
  parameters: {
    type: 'object',
    properties: {
      documentId: {
        type: 'string',
        description: 'ID of the document to extract terms from'
      },
      minLength: {
        type: 'number',
        description: 'Minimum term length (default: 3)',
        optional: true
      },
      includeCapitalized: {
        type: 'boolean',
        description: 'Include capitalized words as potential entities (default: true)',
        optional: true
      },
      customPatterns: {
        type: 'array',
        description: 'Custom regex patterns for domain-specific terms (optional)',
        items: { type: 'string' },
        optional: true
      }
    },
    required: ['documentId'],
  },
};

const extractTermsDescription: ToolRegistrationDescription = () => `<description>
Extract potential entity terms from a document using configurable patterns.
**Simple, flexible term extraction without hardcoded domain bias.**
AI agents can review results and decide which terms to convert to entities.
</description>

<importantNotes>
- (!important!) **Document must be stored first** using storeDocument
- (!important!) **Configurable extraction** - no hardcoded domain assumptions
- (!important!) **Returns candidates** - AI agent decides which to use
- (!important!) **No automatic entity creation** - use createEntities for that
</importantNotes>

<whenToUseThisTool>
- When you need entity candidates from document text
- **As input for manual entity creation** decisions
- When applying domain-specific extraction patterns
- When exploring what entities might exist in documents
</whenToUseThisTool>

<bestPractices>
- Review extracted terms before creating entities
- Use domain-specific patterns for specialized documents
- Combine with manual entity creation for best results
- Filter results based on relevance to your use case
</bestPractices>

<examples>
- Basic extraction: {"documentId": "doc1"}
- Custom settings: {"documentId": "doc1", "minLength": 4, "includeCapitalized": true}
- Medical terms: {"documentId": "medical_paper", "customPatterns": ["\\\\b\\\\w+itis\\\\b", "\\\\b\\\\w+oma\\\\b"]}
</examples>`;

const extractTermsSchema: z.ZodRawShape = {
  documentId: z.string().describe('ID of the document to extract terms from'),
  minLength: z.number().default(3).optional().describe('Minimum term length'),
  includeCapitalized: z.boolean().default(true).optional().describe('Include capitalized words'),
  customPatterns: z.array(z.string()).optional().describe('Custom regex patterns for domain terms'),
};

export const extractTermsTool: ToolDefinition = {
  capability: extractTermsCapability,
  description: extractTermsDescription,
  schema: extractTermsSchema,
};

// === LINK ENTITIES TO DOCUMENT TOOL ===

const linkEntitiesToDocumentCapability: ToolCapabilityInfo = {
  description: 'Explicitly link entities to a document for graph-enhanced search',
  parameters: {
    type: 'object',
    properties: {
      documentId: {
        type: 'string',
        description: 'ID of the document to link entities to'
      },
      entityNames: {
        type: 'array',
        description: 'Names of entities to link to the document',
        items: { type: 'string' }
      }
    },
    required: ['documentId', 'entityNames'],
  },
};

const linkEntitiesToDocumentDescription: ToolRegistrationDescription = () => `<description>
Explicitly link existing entities to a document to enable graph-enhanced search.
**Creates associations between entities and documents for better search results.**
</description>

<importantNotes>
- (!important!) **Entities must exist** - create them first with createEntities
- (!important!) **Document must be stored** - use storeDocument first
- (!important!) **Explicit linking** - AI agent controls which entities are associated
</importantNotes>

<whenToUseThisTool>
- After creating entities related to a document
- **To enable graph-enhanced search** on document content
- When building explicit knowledge connections
- When entities are mentioned or relevant to the document
</whenToUseThisTool>

<bestPractices>
- Link entities that are actually mentioned in the document
- Include both explicit mentions and relevant concepts
- Use after manual entity creation for precision
- Consider both direct and indirect entity relationships
</bestPractices>

<examples>
- Link research entities: {"documentId": "ml_paper", "entityNames": ["Machine Learning", "Neural Networks", "Deep Learning"]}
- Business entities: {"documentId": "quarterly_report", "entityNames": ["Q3 2024", "Revenue", "Growth Strategy"]}
</examples>`;

const linkEntitiesToDocumentSchema: z.ZodRawShape = {
  documentId: z.string().describe('ID of the document to link entities to'),
  entityNames: z.array(z.string()).describe('Names of entities to link to the document'),
};

export const linkEntitiesToDocumentTool: ToolDefinition = {
  capability: linkEntitiesToDocumentCapability,
  description: linkEntitiesToDocumentDescription,
  schema: linkEntitiesToDocumentSchema,
};

// === GET KNOWLEDGE GRAPH STATS TOOL ===

const getStatsCapability: ToolCapabilityInfo = {
  description: 'Get comprehensive statistics about the knowledge graph and RAG system state',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

const getStatsDescription: ToolRegistrationDescription = () => `<description>
Get comprehensive statistics about your knowledge graph and RAG system to understand its current state and content.
**Essential for monitoring system health and understanding your knowledge base composition.**
Provides insights into entities, relationships, documents, and overall system utilization.
</description>

<importantNotes>
- (!important!) **Real-time statistics** - reflects current system state
- (!important!) Includes breakdowns by type for entities and relationships
- (!important!) Shows document and chunk counts for RAG system health
- (!important!) **Use regularly** to monitor system growth and balance
</importantNotes>

<whenToUseThisTool>
- **Before major operations** - to understand current system state
- When planning knowledge base expansion or optimization
- For debugging and troubleshooting system issues
- When generating reports on knowledge base contents
- After bulk operations to verify results
- When analyzing knowledge domain coverage
</whenToUseThisTool>

<features>
- Complete entity counts with type breakdowns
- Relationship statistics with type distributions
- Document and chunk inventory
- Vector index health indicators
- Knowledge graph connectivity metrics
- Growth and utilization analytics
</features>

<bestPractices>
- Check stats before and after major operations
- Monitor entity type distributions for domain balance
- Track relationship diversity for graph connectivity
- Use stats to identify knowledge gaps or imbalances
- Regular monitoring helps detect processing issues
- Document stats over time for trend analysis
</bestPractices>

<parameters>
- None required - returns comprehensive system statistics
</parameters>

<examples>
- System health check: {} (no parameters needed)
- Post-processing verification: {} (check stats after adding documents)
- Planning analysis: {} (understand current state before expansion)
</examples>`;

const getStatsSchema: z.ZodRawShape = {};

export const getKnowledgeGraphStatsTool: ToolDefinition = {
  capability: getStatsCapability,
  description: getStatsDescription,
  schema: getStatsSchema,
};

// === DELETE DOCUMENT(S) TOOL ===

const deleteDocumentsCapability: ToolCapabilityInfo = {
  description: 'Delete one or multiple documents and all their associated data',
  parameters: {
    type: 'object',
    properties: {
      documentIds: {
        type: 'array',
        description: 'Document ID(s) to delete - can be a single string or array of strings',
        items: { type: 'string' }
      }
    },
    required: ['documentIds'],
  },
};

const deleteDocumentsDescription: ToolRegistrationDescription = () => `<description>
Delete one or multiple documents and all their associated data including chunks, embeddings, and entity associations.
**Flexible tool that handles both single and bulk document deletion.**
Ensures no orphaned data remains after document removal.
</description>

<importantNotes>
- (!important!) **Permanent deletion** - cannot be undone without backup
- (!important!) **Flexible input** - accepts single document ID or array of IDs
- (!important!) **Cascades to all related data** - chunks, embeddings, entity links
- (!important!) **Continues on errors** - won't stop if some documents don't exist
</importantNotes>

<whenToUseThisTool>
- When removing one or more obsolete documents
- **After verification** of document(s) to be deleted using listDocuments
- When cleaning up test or temporary documents
- For knowledge base maintenance and cleanup operations
</whenToUseThisTool>

<features>
- Single or bulk deletion in one tool
- Automatic cascade deletion for each document
- Detailed reporting of successful/failed deletions
- Error resilience - continues processing on failures
- Maintains system integrity across all deletions
</features>

<bestPractices>
- ALWAYS verify document IDs before deletion using listDocuments
- Use getKnowledgeGraphStats to understand impact
- Consider backing up important documents before deletion
- Monitor system stats after deletion to verify cleanup
</bestPractices>

<parameters>
- documentIds: Single document ID (string) or array of document IDs (string[])
</parameters>

<examples>
- Single document: {"documentIds": "old_manual_v1"}
- Multiple documents: {"documentIds": ["test_doc_1", "test_doc_2", "test_doc_3"]}
- Clean all test docs: {"documentIds": ["demo1", "demo2", "sample1", "sample2"]}
</examples>`;

const deleteDocumentsSchema: z.ZodRawShape = {
  documentIds: z.union([
    z.string().describe('Single document ID to delete'),
    z.array(z.string()).describe('Array of document IDs to delete')
  ]).describe('Document ID(s) to delete - can be a single string or array of strings'),
};

export const deleteDocumentsTool: ToolDefinition = {
  capability: deleteDocumentsCapability,
  description: deleteDocumentsDescription,
  schema: deleteDocumentsSchema,
};

// === LIST DOCUMENTS TOOL ===

const listDocumentsCapability: ToolCapabilityInfo = {
  description: 'List all documents in the knowledge base with their metadata',
  parameters: {
    type: 'object',
    properties: {
      includeMetadata: {
        type: 'boolean',
        description: 'Include document metadata in results (default: true)',
        optional: true
      }
    },
    required: [],
  },
};

const listDocumentsDescription: ToolRegistrationDescription = () => `<description>
List all documents currently stored in the knowledge base with their IDs and metadata.
**Essential for discovering what documents exist before performing operations.**
Provides overview of document collection for maintenance and organization.
</description>

<importantNotes>
- (!important!) **Shows all documents** regardless of chunking or embedding status
- (!important!) **Includes metadata** for document identification and categorization
- (!important!) **Real-time listing** - reflects current database state
- (!important!) **Use before deletion** to verify what exists
</importantNotes>

<whenToUseThisTool>
- **Before deletion operations** to see what documents exist
- When auditing document collections
- For discovering orphaned or forgotten documents
- When planning document organization or cleanup
- For debugging document-related issues
</whenToUseThisTool>

<features>
- Complete document inventory with IDs
- Optional metadata inclusion for context
- Document creation timestamps
- Efficient listing without content retrieval
- Suitable for large document collections
</features>

<bestPractices>
- Use regularly to maintain awareness of document collection
- Check before bulk operations to verify targets
- Review metadata to identify document purposes
- Use for planning cleanup and organization strategies
- Monitor document growth over time
</bestPractices>

<parameters>
- includeMetadata: Whether to include metadata (boolean, optional, default: true)
</parameters>

<examples>
- Full listing: {} (no parameters needed)
- IDs only: {"includeMetadata": false}
- Complete inventory: {"includeMetadata": true}
</examples>`;

const listDocumentsSchema: z.ZodRawShape = {
  includeMetadata: z.boolean().default(true).optional().describe('Include document metadata in results'),
};

export const listDocumentsTool: ToolDefinition = {
  capability: listDocumentsCapability,
  description: listDocumentsDescription,
  schema: listDocumentsSchema,
};

// Export all RAG tools
export const ragTools = {
  storeDocument: storeDocumentTool,
  // chunkDocument and embedChunks are now handled automatically by storeDocument
  extractTerms: extractTermsTool,
  linkEntitiesToDocument: linkEntitiesToDocumentTool,
  getKnowledgeGraphStats: getKnowledgeGraphStatsTool,
  deleteDocuments: deleteDocumentsTool,
  listDocuments: listDocumentsTool,
}; 