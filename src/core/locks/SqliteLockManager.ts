import Database from "better-sqlite3"
import * as fs from "fs"
import { existsSync, mkdirSync, unlinkSync } from "fs"
import * as path from "path"
import type { LockRow, SqliteLockManagerOptions } from "./types"
export class SqliteLockManager {
	private db!: Database.Database
	private instanceAddress: string
	private dbPath: string
	private readonly STALE_LOCK_TIMEOUT = 1 * 60 * 1000 // 1 minute in milliseconds

	constructor(options: SqliteLockManagerOptions) {
		this.instanceAddress = options.instanceAddress
		this.dbPath = options.dbPath

		// Ensure the directory exists before creating the database
		const dbDir = path.dirname(this.dbPath)
		try {
			mkdirSync(dbDir, { recursive: true })
		} catch (error) {
			console.error(`CRITICAL ERROR: Failed to create SQLite database directory ${dbDir}:`, error)
			throw new Error(`Failed to create SQLite database directory: ${error}`)
		}

		try {
			this.initializeDatabaseWithLockSync()
		} catch (error) {
			console.error(`CRITICAL ERROR: Failed to initialize SQLite database at ${this.dbPath}:`, error)
			throw new Error(`Failed to initialize SQLite database: ${error}`)
		}
	}

	private initializeDatabaseWithLockSync(): void {
		const lockFile = `${this.dbPath}.lock`

		// Clean up stale lock files first
		this.cleanupStaleLockSync(lockFile)

		try {
			// Try to acquire exclusive file lock for database creation
			let fd: number | null = null

			try {
				fd = fs.openSync(lockFile, "wx") // Exclusive creation - fails if file exists

				// Write timestamp to lock file for stale lock detection
				fs.writeFileSync(fd, Date.now().toString())

				// Check if database already exists
				const dbExists = existsSync(this.dbPath)

				if (!dbExists) {
					// Database doesn't exist, create it
					this.db = new Database(this.dbPath)
					this.initializeDatabase()
				} else {
					// Database exists, just open it
					this.db = new Database(this.dbPath)
				}
			} finally {
				// Always clean up the lock file
				if (fd !== null) {
					fs.closeSync(fd)
				}
				try {
					unlinkSync(lockFile)
				} catch {} // Ignore errors if file was already deleted
			}
		} catch (error: any) {
			if (error.code === "EEXIST") {
				// Another process is initializing the database, wait and retry
				const delay = 100 + Math.random() * 100 // Add jitter
				this.sleepSync(delay)
				this.initializeDatabaseWithLockSync()
				return
			}
			throw error
		}
	}

	private sleepSync(ms: number) {
		// Non-spinning, synchronous sleep using Atomics.wait
		// Works in Node main thread (since v12.16+) and worker threads.
		const sab = new SharedArrayBuffer(4)
		const ia = new Int32Array(sab)
		Atomics.wait(ia, 0, 0, Math.max(0, Math.floor(ms)))
	}

	private cleanupStaleLockSync(lockFile: string): void {
		try {
			if (!existsSync(lockFile)) {
				return // Lock file doesn't exist, nothing to clean up
			}

			try {
				const timestampStr = fs.readFileSync(lockFile, "utf8").trim()
				const timestamp = parseInt(timestampStr, 10)

				if (isNaN(timestamp) || Date.now() - timestamp > this.STALE_LOCK_TIMEOUT) {
					// Stale lock, remove it
					unlinkSync(lockFile)
					console.warn(`Removed stale database lock file: ${lockFile}`)
				}
			} catch (readError) {
				// If we can't read the timestamp, assume it's stale
				unlinkSync(lockFile)
				console.warn(`Removed unreadable database lock file: ${lockFile}`)
			}
		} catch (error: any) {
			if (error.code !== "ENOENT") {
				// Lock file doesn't exist, which is fine
				console.warn(`Error checking lock file ${lockFile}:`, error)
			}
		}
	}

	private initializeDatabase() {
		// Create the locks table with the unified schema (matches cli/pkg/common/schema.go)
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS locks (
				id INTEGER PRIMARY KEY,
				held_by TEXT NOT NULL,
				lock_type TEXT NOT NULL CHECK (lock_type IN ('file', 'instance', 'folder')),
				lock_target TEXT NOT NULL,
				locked_at INTEGER NOT NULL,
				UNIQUE(lock_type, lock_target)
			);
		`)

		// Create indexes for performance (matches cli/pkg/common/schema.go)
		this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_locks_held_by ON locks(held_by);
			CREATE INDEX IF NOT EXISTS idx_locks_type ON locks(lock_type);
			CREATE INDEX IF NOT EXISTS idx_locks_target ON locks(lock_target);
		`)
	}

	/**
	 * Register this instance in the locks table
	 */
	async registerInstance(data: { hostAddress: string }): Promise<void> {
		const now = Date.now()

		// Create instance lock entry
		const insertLock = this.db.prepare(`
			INSERT OR REPLACE INTO locks (held_by, lock_type, lock_target, locked_at)
			VALUES (?, 'instance', ?, ?)
		`)

		insertLock.run(this.instanceAddress, data.hostAddress, now)
	}

	/**
	 * Update the timestamp for this instance (touch)
	 */
	touchInstance(): void {
		const now = Date.now()
		const updateLock = this.db.prepare(`
			UPDATE locks 
			SET locked_at = ? 
			WHERE held_by = ? AND lock_type = 'instance'
		`)

		updateLock.run(now, this.instanceAddress)
	}

	/**
	 * Remove this instance from the locks table
	 */
	unregisterInstance(): void {
		const deleteLock = this.db.prepare(`
			DELETE FROM locks 
			WHERE held_by = ? AND lock_type = 'instance'
		`)

		deleteLock.run(this.instanceAddress)
	}

	/**
	 * Query the registry for any instance registered on the given port
	 */
	getInstanceByPort(port: number): { instanceAddress: string; hostAddress: string } | null {
		const query = this.db.prepare(`
			SELECT held_by, lock_target 
			FROM locks 
			WHERE lock_type = 'instance' 
			AND (held_by LIKE '%:' || ? OR lock_target LIKE '%:' || ?)
		`)

		const result = query.get(port, port) as { held_by: string; lock_target: string } | undefined

		if (result) {
			return {
				instanceAddress: result.held_by,
				hostAddress: result.lock_target,
			}
		}

		return null
	}

	/**
	 * Remove a specific instance entry from the registry
	 */
	removeInstanceByAddress(instanceAddress: string): void {
		const deleteLock = this.db.prepare(`
			DELETE FROM locks 
			WHERE held_by = ? AND lock_type = 'instance'
		`)

		deleteLock.run(instanceAddress)
	}

	/**
	 * Check if another instance has a conflicting folder lock
	 */
	async getFolderLockByTarget(lockTarget: string): Promise<LockRow | null> {
		const query = this.db.prepare(`
			SELECT * FROM locks 
			WHERE lock_type = 'folder' 
			AND lock_target = ? 
		`)

		const result = query.get(lockTarget) as LockRow | undefined
		return result || null
	}

	/**
	 * Release a folder lock
	 */
	releaseFolderLockByTarget(heldBy: string, lockTarget: string): void {
		const deleteLock = this.db.prepare(`
			DELETE FROM locks 
			WHERE held_by = ? AND lock_type = 'folder' AND lock_target = ?
		`)

		// swap instance address in place of taskID
		heldBy = this.instanceAddress
		deleteLock.run(heldBy, lockTarget)
	}

	/**
	 * Register a folder lock
	 * @returns null if lock was successfully acquired, or the conflicting LockRow if lock already exists
	 */
	async registerFolderLock(heldBy: string, lockTarget: string): Promise<LockRow | null> {
		const now = Date.now()
		const insertLock = this.db.prepare(`
			INSERT OR IGNORE INTO locks (held_by, lock_type, lock_target, locked_at)
			VALUES (?, 'folder', ?, ?)
		`)

		// swap instance address in place of taskID
		heldBy = this.instanceAddress
		const insertedCount = insertLock.run(this.instanceAddress, lockTarget, now).changes

		if (insertedCount > 0) {
			return null // lock acquired
		} else {
			const existingLock = await this.getFolderLockByTarget(lockTarget)
			if (existingLock && existingLock.held_by === heldBy) {
				return null // existing lock is held by the same task
			}
			// existing lock held by other task, return the conflicting lock
			return await this.getFolderLockByTarget(lockTarget)
		}
	}

	/**
	 * Clean up folder locks that are held by tasks whose instances no longer exist.
	 * This removes locks where held_by doesn't exist in any instance-type lock.
	 */
	cleanupOrphanedFolderLocks(): void {
		const deleteOrphans = this.db.prepare(`
			DELETE FROM locks 
			WHERE lock_type = 'folder' 
			AND held_by NOT IN (
				SELECT DISTINCT held_by 
				FROM locks 
				WHERE lock_type = 'instance'
			)
		`)

		const deletedCount = deleteOrphans.run().changes

		if (deletedCount > 0) {
			console.log(`Cleaned up ${deletedCount} orphaned folder lock(s)`)
		}
	}

	/**
	 * Close the database connection
	 */
	close(): void {
		this.db.close()
	}
}
