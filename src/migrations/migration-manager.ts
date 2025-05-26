import Database from 'better-sqlite3';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
  down?: (db: Database.Database) => void;
}

export class MigrationManager {
  private db: Database.Database;
  private migrations: Migration[] = [];

  constructor(db: Database.Database) {
    this.db = db;
    this.initializeMigrationTable();
  }

  private initializeMigrationTable(): void {
    // Create migrations table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  addMigration(migration: Migration): void {
    this.migrations.push(migration);
  }

  getCurrentVersion(): number {
    const result = this.db.prepare(`
      SELECT MAX(version) as version FROM schema_migrations
    `).get() as { version: number | null };
    
    return result.version || 0;
  }

  getPendingMigrations(): Migration[] {
    const currentVersion = this.getCurrentVersion();
    return this.migrations
      .filter(m => m.version > currentVersion)
      .sort((a, b) => a.version - b.version);
  }

  async runMigrations(): Promise<{ applied: number; currentVersion: number }> {
    const pendingMigrations = this.getPendingMigrations();
    
    if (pendingMigrations.length === 0) {
      console.error('📊 Database schema is up to date');
      return { applied: 0, currentVersion: this.getCurrentVersion() };
    }

    console.error(`🔄 Running ${pendingMigrations.length} pending migrations...`);

    let appliedCount = 0;
    
    for (const migration of pendingMigrations) {
      try {
        console.error(`  ├─ Applying migration ${migration.version}: ${migration.description}`);
        
        // Run migration in a transaction
        this.db.transaction(() => {
          migration.up(this.db);
          
          // Record the migration
          this.db.prepare(`
            INSERT INTO schema_migrations (version, description)
            VALUES (?, ?)
          `).run(migration.version, migration.description);
        })();
        
        appliedCount++;
        console.error(`  ├─ ✅ Migration ${migration.version} applied successfully`);
        
      } catch (error) {
        console.error(`  ├─ ❌ Migration ${migration.version} failed:`, error);
        throw new Error(`Migration ${migration.version} failed: ${error}`);
      }
    }

    const newVersion = this.getCurrentVersion();
    console.error(`✅ Migrations completed: ${appliedCount} applied, current version: ${newVersion}`);
    
    return { applied: appliedCount, currentVersion: newVersion };
  }

  rollback(targetVersion: number): void {
    const currentVersion = this.getCurrentVersion();
    
    if (targetVersion >= currentVersion) {
      console.error('⚠️ Target version is not lower than current version');
      return;
    }

    const migrationsToRollback = this.migrations
      .filter(m => m.version > targetVersion && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version); // Reverse order for rollback

    console.error(`🔄 Rolling back ${migrationsToRollback.length} migrations...`);

    for (const migration of migrationsToRollback) {
      if (!migration.down) {
        throw new Error(`Migration ${migration.version} does not support rollback`);
      }

      try {
        console.error(`  ├─ Rolling back migration ${migration.version}: ${migration.description}`);
        
        this.db.transaction(() => {
          migration.down!(this.db);
          
          // Remove migration record
          this.db.prepare(`
            DELETE FROM schema_migrations WHERE version = ?
          `).run(migration.version);
        })();
        
        console.error(`  ├─ ✅ Migration ${migration.version} rolled back successfully`);
        
      } catch (error) {
        console.error(`  ├─ ❌ Rollback ${migration.version} failed:`, error);
        throw new Error(`Rollback ${migration.version} failed: ${error}`);
      }
    }

    console.error(`✅ Rollback completed to version ${targetVersion}`);
  }

  listMigrations(): Array<{ version: number; description: string; applied: boolean; applied_at?: string }> {
    const appliedMigrations = this.db.prepare(`
      SELECT version, description, applied_at FROM schema_migrations ORDER BY version
    `).all() as Array<{ version: number; description: string; applied_at: string }>;

    const appliedVersions = new Set(appliedMigrations.map(m => m.version));

    const allMigrations = this.migrations.map(migration => ({
      version: migration.version,
      description: migration.description,
      applied: appliedVersions.has(migration.version),
      applied_at: appliedMigrations.find(m => m.version === migration.version)?.applied_at
    }));

    return allMigrations.sort((a, b) => a.version - b.version);
  }
} 