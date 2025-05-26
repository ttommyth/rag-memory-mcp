import { z } from 'zod';
import { ToolDefinition } from './types.js';

export const migrationTools: Record<string, ToolDefinition> = {
  getMigrationStatus: {
    capability: {
      description: 'Get database migration status and list all migrations',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    description: (settings) => `
**Get Database Migration Status**

Shows the current database schema version and lists all available migrations with their status.

**Purpose:**
- Check which migrations have been applied
- See pending migrations that need to be run
- Verify database schema version

**Returns:**
- Current schema version
- List of all migrations with applied status
- Summary of pending migrations

**Example:**
\`\`\`json
{
  "currentVersion": 4,
  "migrations": [
    {
      "version": 1,
      "description": "Initial schema",
      "applied": true,
      "applied_at": "2024-01-01T10:00:00Z"
    },
    {
      "version": 5,
      "description": "New feature",
      "applied": false
    }
  ],
  "pendingCount": 1
}
\`\`\`

**Use Cases:**
- Before running migrations to see what will be applied
- Troubleshooting database schema issues
- Verifying successful migration completion
    `.trim(),
    schema: {},
  },

  runMigrations: {
    capability: {
      description: 'Run all pending database migrations',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    description: (settings) => `
**Run Database Migrations**

Applies all pending database migrations to bring the schema up to the latest version.

**Purpose:**
- Update database schema to support new features
- Apply incremental schema changes safely
- Maintain database version consistency

**Safety:**
- Migrations run in transactions (atomic)
- Failed migrations are rolled back automatically
- Schema version is tracked for consistency

**Returns:**
- Number of migrations applied
- New current version
- Details of applied migrations

**Example:**
\`\`\`json
{
  "applied": 2,
  "currentVersion": 5,
  "appliedMigrations": [
    {
      "version": 4,
      "description": "Add chunk_type support"
    },
    {
      "version": 5,
      "description": "Disable foreign keys"
    }
  ]
}
\`\`\`

**Use Cases:**
- After updating the application to a new version
- Setting up a fresh database
- Recovering from schema inconsistencies
    `.trim(),
    schema: {},
  },

  rollbackMigration: {
    capability: {
      description: 'Rollback database to a specific migration version',
      parameters: {
        type: 'object',
        properties: {
          targetVersion: {
            type: 'number',
            description: 'Target schema version to rollback to',
          },
        },
        required: ['targetVersion'],
      },
    },
    description: (settings) => `
**Rollback Database Migration**

Rolls back the database schema to a specific version by reversing applied migrations.

**Purpose:**
- Revert problematic schema changes
- Downgrade to a previous stable version
- Recover from migration issues

**Parameters:**
- \`targetVersion\`: The schema version to rollback to (must be lower than current)

**Safety:**
- Only migrations with rollback support can be reversed
- Rollbacks run in transactions (atomic)
- Data loss may occur depending on the migration

**Returns:**
- Number of migrations rolled back
- New current version
- Details of rolled back migrations

**Example:**
\`\`\`json
{
  "rolledBack": 1,
  "currentVersion": 3,
  "rolledBackMigrations": [
    {
      "version": 4,
      "description": "Add chunk_type support"
    }
  ]
}
\`\`\`

**Use Cases:**
- Reverting a problematic migration
- Downgrading for compatibility
- Testing migration rollback procedures

**⚠️ Warning:** Rollbacks may cause data loss. Use with caution in production.
    `.trim(),
    schema: {
      targetVersion: z.number().min(0).describe('Target schema version to rollback to'),
    },
  },
}; 