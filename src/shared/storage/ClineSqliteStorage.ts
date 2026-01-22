import * as fs from "node:fs"
import os from "node:os"
import * as path from "node:path"
import Database from "better-sqlite3"
import { ClineStorage } from "./ClineStorage"

/**
 * A storage implementation that uses SQLite database to store key-value pairs.
 * Uses better-sqlite3 for synchronous, high-performance database operations.
 */
export class ClineSqliteStorage extends ClineStorage {
	override name = "ClineSqliteStorage"

	private static store: ClineSqliteStorage | null = null
	static get instance(): ClineSqliteStorage {
		if (!ClineSqliteStorage.store) {
			ClineSqliteStorage.store = new ClineSqliteStorage()
		}
		return ClineSqliteStorage.store
	}

	private db: Database.Database | undefined
	private dbPath: string | undefined

	private constructor() {
		super()
	}

	/**
	 * Initialize the storage with a client name.
	 * Must be called before using the storage.
	 * If already initialized with different client, closes current connection first.
	 */
	public init(client: string, dbPath?: string): ClineSqliteStorage {
		const dir = dbPath || process.env.CLINE_DIR || path.join(os.homedir(), ".cline")
		const newDbPath = path.join(dir, "data", "users", client, "cline_storage_test.db")
		// If already initialized with the same path, skip
		if (this.db && this.dbPath === newDbPath) {
			return this
		}

		// Close existing connection if initializing with different path
		if (this.db) {
			this.close()
		}

		this.dbPath = newDbPath
		this.initializeDatabase()
		return this
	}

	private ensureInitialized(): void {
		if (!this.db || !this.dbPath) {
			throw new Error("[ClineSqliteStorage] init() must be called before using the storage")
		}
	}

	private initializeDatabase(): void {
		if (!this.dbPath) {
			throw new Error("[ClineSqliteStorage] dbPath not set")
		}
		console.log("[ClineSqliteStorage] Initializing database at:", this.dbPath)
		try {
			// Ensure directory exists
			const dir = path.dirname(this.dbPath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}

			// Open database connection
			this.db = new Database(this.dbPath)

			// Create table if it doesn't exist
			this.db.exec(`
				CREATE TABLE IF NOT EXISTS storage (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL
				)
			`)

			// Enable WAL mode for better concurrent access
			this.db.pragma("journal_mode = WAL")
		} catch (error) {
			console.error("[ClineSqliteStorage] initialization failed:", error)
			throw error
		}
	}

	protected _keys(): readonly string[] {
		this.ensureInitialized()

		try {
			const stmt = this.db!.prepare("SELECT key FROM storage")
			const rows = stmt.all() as { key: string }[]
			return rows.map((row) => row.key)
		} catch (error) {
			console.error("[ClineSqliteStorage] failed to get keys:", error)
			return []
		}
	}

	/**
	 * Synchronous get method - better-sqlite3 supports synchronous operations
	 */
	protected override _getSync(key: string): string | undefined {
		this.ensureInitialized()

		try {
			const stmt = this.db!.prepare("SELECT value FROM storage WHERE key = ?")
			const row = stmt.get(key) as { value: string } | undefined
			const value = row?.value
			console.log(`[ClineSqliteStorage] Get key '${key}': ${value ? value.substring(0, 50) : "undefined"}`)
			return value
		} catch (error) {
			console.error(`[ClineSqliteStorage] failed to get '${key}':`, error)
			return undefined
		}
	}

	protected async _get(key: string): Promise<string | undefined> {
		// Delegate to synchronous version since better-sqlite3 is synchronous
		return this._getSync(key)
	}

	protected async _store(key: string, value: string): Promise<void> {
		this.ensureInitialized()

		try {
			console.log(`[ClineSqliteStorage] Storing key '${key}' with value:`, value.substring(0, 100))
			const stmt = this.db!.prepare("INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?)")
			stmt.run(key, value)
			console.log(`[ClineSqliteStorage] Successfully stored key '${key}'`)
		} catch (error) {
			console.error(`[ClineSqliteStorage] failed to store '${key}':`, error)
			throw error
		}
	}

	protected async _delete(key: string): Promise<void> {
		this.ensureInitialized()

		try {
			const stmt = this.db!.prepare("DELETE FROM storage WHERE key = ?")
			stmt.run(key)
		} catch (error) {
			console.error(`[ClineSqliteStorage] failed to delete '${key}':`, error)
			throw error
		}
	}

	/**
	 * Get all keys stored in the database.
	 */
	public async getAllKeys(): Promise<string[]> {
		this.ensureInitialized()

		try {
			const stmt = this.db!.prepare("SELECT key FROM storage")
			const rows = stmt.all() as { key: string }[]
			return rows.map((row) => row.key)
		} catch (error) {
			console.error("[ClineSqliteStorage] failed to get all keys:", error)
			return []
		}
	}

	/**
	 * Get all key-value pairs stored in the database.
	 */
	public async getAll(): Promise<Record<string, string>> {
		this.ensureInitialized()

		try {
			const stmt = this.db!.prepare("SELECT key, value FROM storage")
			const rows = stmt.all() as { key: string; value: string }[]
			return rows.reduce(
				(acc, row) => {
					acc[row.key] = row.value
					return acc
				},
				{} as Record<string, string>,
			)
		} catch (error) {
			console.error("[ClineSqliteStorage] failed to get all entries:", error)
			return {}
		}
	}

	/**
	 * Clear all entries from the database.
	 */
	public async clear(): Promise<void> {
		this.ensureInitialized()

		try {
			this.db!.exec("DELETE FROM storage")
		} catch (error) {
			console.error("[ClineSqliteStorage] failed to clear storage:", error)
			throw error
		}
	}

	/**
	 * Close the database connection.
	 * Should be called when the storage is no longer needed.
	 */
	public close(): void {
		if (this.db) {
			try {
				this.db.close()
			} catch (error) {
				console.error("[ClineSqliteStorage] failed to close database:", error)
			} finally {
				this.db = undefined
				this.dbPath = undefined
			}
		}
	}

	/**
	 * Get database statistics.
	 */
	public getStats(): { totalKeys: number; dbSizeBytes: number } {
		this.ensureInitialized()

		try {
			const countStmt = this.db!.prepare("SELECT COUNT(*) as count FROM storage")
			const countRow = countStmt.get() as { count: number }

			const dbSizeBytes = fs.existsSync(this.dbPath!) ? fs.statSync(this.dbPath!).size : 0

			return {
				totalKeys: countRow.count,
				dbSizeBytes,
			}
		} catch (error) {
			console.error("[ClineSqliteStorage] failed to get stats:", error)
			return { totalKeys: 0, dbSizeBytes: 0 }
		}
	}
}

/**
 * Singleton instance of ClineSqliteStorage
 */
export const sqliteStorage = ClineSqliteStorage.instance
