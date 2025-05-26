import { z } from 'zod';
import { ToolDefinition, MCPTool } from './types.js';
import { knowledgeGraphTools } from './knowledge-graph-tools.js';
import { ragTools } from './rag-tools.js';
import { graphQueryTools } from './graph-query-tools.js';
// Note: migrationTools are kept internal and not exposed to users

// Central registry of all tools
export const allTools = {
  ...knowledgeGraphTools,
  ...ragTools,
  ...graphQueryTools,
  // Migration tools are handled internally and not exposed
};

// Global settings for tool descriptions
export const globalSettings = {
  version: '1.0.0',
  systemName: 'RAG Knowledge Graph MCP Server',
  defaultTimeout: 60,
};

/**
 * Convert a structured ToolDefinition to MCP tool format
 */
export function convertToMCPTool(name: string, toolDef: ToolDefinition): MCPTool {
  // Convert Zod schema to JSON schema properties
  const properties: Record<string, any> = {};
  const required: string[] = [];
  
  for (const [key, zodType] of Object.entries(toolDef.schema)) {
    // Extract the JSON schema representation from Zod
    const jsonSchema = zodTypeToJsonSchema(zodType, key);
    properties[key] = jsonSchema;
    
    // Check if required (not optional)
    if (!zodType.isOptional?.()) {
      required.push(key);
    }
  }
  
  return {
    name,
    description: toolDef.description(globalSettings),
    inputSchema: {
      type: 'object',
      properties,
      required,
    },
  };
}

/**
 * Convert Zod type to JSON schema (simplified)
 */
function zodTypeToJsonSchema(zodType: any, fieldName: string): any {
  // Handle common Zod types
  if (zodType._def) {
    const def = zodType._def;
    
    switch (def.typeName) {
      case 'ZodString':
        return {
          type: 'string',
          description: def.description || `${fieldName} parameter`,
        };
      
      case 'ZodNumber':
        return {
          type: 'number',
          description: def.description || `${fieldName} parameter`,
          ...(def.default !== undefined && { default: def.default }),
        };
      
      case 'ZodBoolean':
        return {
          type: 'boolean',
          description: def.description || `${fieldName} parameter`,
          ...(def.default !== undefined && { default: def.default }),
        };
      
      case 'ZodArray':
        return {
          type: 'array',
          description: def.description || `Array of ${fieldName}`,
          items: zodTypeToJsonSchema(def.type, `${fieldName} item`),
        };
      
      case 'ZodObject':
        const objectProperties: Record<string, any> = {};
        const objectRequired: string[] = [];
        
        for (const [key, value] of Object.entries(def.shape())) {
          objectProperties[key] = zodTypeToJsonSchema(value, key);
          if (!(value as any).isOptional?.()) {
            objectRequired.push(key);
          }
        }
        
        return {
          type: 'object',
          description: def.description || `${fieldName} object`,
          properties: objectProperties,
          required: objectRequired,
        };
      
      case 'ZodRecord':
        return {
          type: 'object',
          description: def.description || `${fieldName} record`,
          additionalProperties: true,
        };
      
      case 'ZodOptional':
        const innerSchema = zodTypeToJsonSchema(def.innerType, fieldName);
        return {
          ...innerSchema,
          optional: true,
        };
      
      case 'ZodDefault':
        const defaultSchema = zodTypeToJsonSchema(def.innerType, fieldName);
        return {
          ...defaultSchema,
          default: def.defaultValue(),
        };
      
      default:
        console.warn(`Unknown Zod type: ${def.typeName} for field ${fieldName}`);
        return {
          type: 'string',
          description: `${fieldName} parameter (fallback)`,
        };
    }
  }
  
  // Fallback for unknown types
  return {
    type: 'string',
    description: `${fieldName} parameter`,
  };
}

/**
 * Get all tools in MCP format
 */
export function getAllMCPTools(): MCPTool[] {
  return Object.entries(allTools).map(([name, toolDef]) => 
    convertToMCPTool(name, toolDef)
  );
}

/**
 * Get a specific tool definition by name
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return (allTools as any)[name];
}

/**
 * Validate tool arguments using Zod schema
 */
export function validateToolArgs<T>(toolName: string, args: any): T {
  const toolDef = getToolDefinition(toolName);
  if (!toolDef) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  
  const schema = z.object(toolDef.schema);
  return schema.parse(args) as T;
}

/**
 * Get tool names organized by category
 */
export function getToolsByCategory() {
  return {
    knowledgeGraph: Object.keys(knowledgeGraphTools),
    rag: Object.keys(ragTools),
    graphQuery: Object.keys(graphQueryTools),
    // migration tools are internal only
    all: Object.keys(allTools),
  };
}

/**
 * Get comprehensive tool documentation
 */
export function getToolDocumentation(toolName: string): string {
  const toolDef = getToolDefinition(toolName);
  if (!toolDef) {
    return `Tool '${toolName}' not found`;
  }
  
  return toolDef.description(globalSettings);
}

/**
 * Get system information and tool summary
 */
export function getSystemInfo() {
  const categories = getToolsByCategory();
  return {
    system: globalSettings,
    toolCounts: {
      knowledgeGraph: categories.knowledgeGraph.length,
      rag: categories.rag.length,
      graphQuery: categories.graphQuery.length,
      total: categories.all.length,
    },
    availableTools: categories,
  };
} 