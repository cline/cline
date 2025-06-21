import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export class DatabaseClient {
  private static instance: DatabaseClient;
  private db: Database.Database;
  private dbPath: string;

  private constructor() {
    // Get database path from environment or use default
    this.dbPath = process.env.DIFF_EVALS_DB_PATH || path.join(__dirname, '../evals.db');
    
    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Initialize database connection
    this.db = new Database(this.dbPath);
    
    // Enable WAL mode for concurrent access
    this.db.pragma('journal_mode = WAL');
    
    // Enable foreign key constraints
    this.db.pragma('foreign_keys = ON');
    
    // Initialize schema if needed
    this.initializeSchema();
  }

  static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  private initializeSchema(): void {
    // Check if tables exist by trying to query one of them
    try {
      this.db.prepare('SELECT COUNT(*) FROM system_prompts LIMIT 1').get();
      // If we get here, tables exist
      return;
    } catch (error) {
      // Tables don't exist, create them
      console.log('Initializing database schema...');
      this.createTables();
    }
  }

  private createTables(): void {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute the entire schema as one block
    this.db.transaction(() => {
      this.db.exec(schema);
    })();

    console.log('Database schema initialized successfully');
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  // Utility method to generate SHA-256 hash
  static generateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // Utility method to generate UUID-like ID
  static generateId(): string {
    return crypto.randomUUID();
  }

  // Transaction wrapper
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Close database connection (for cleanup)
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }

  // Get database info
  getInfo(): { path: string; size: number; tables: string[] } {
    const stats = fs.statSync(this.dbPath);
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row: any) => row.name);

    return {
      path: this.dbPath,
      size: stats.size,
      tables
    };
  }

  // Vacuum database (cleanup and optimize)
  vacuum(): void {
    this.db.exec('VACUUM');
  }

  // Get database statistics
  getStats(): { [tableName: string]: number } {
    const tables = ['system_prompts', 'processing_functions', 'files', 'runs', 'cases', 'results'];
    const stats: { [tableName: string]: number } = {};

    for (const table of tables) {
      try {
        const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        stats[table] = result.count;
      } catch (error) {
        stats[table] = 0;
      }
    }

    return stats;
  }
}

// Export singleton instance getter
export const getDatabase = () => DatabaseClient.getInstance();
