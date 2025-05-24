import { z } from 'zod';

// Tool capability information (corresponds to MCP tool schema)
export interface ToolCapabilityInfo {
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      optional?: boolean;
      items?: { type: string };
      additionalProperties?: boolean;
      default?: any;
    }>;
    required: string[];
  };
}

// Tool registration description (rich documentation)
export type ToolRegistrationDescription = (globalSettings?: any) => string;

// Combined tool definition
export interface ToolDefinition {
  capability: ToolCapabilityInfo;
  description: ToolRegistrationDescription;
  schema: z.ZodRawShape;
}

// MCP Tool for registration
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
} 