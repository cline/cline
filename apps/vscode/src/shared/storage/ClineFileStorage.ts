import * as fs from "node:fs"
import * as path from "node:path"
import { isRefactoringEnabled } from "../services/feature-flags/refactoring-flags"
import { Logger } from "../services/Logger"
import { ClineJsonlStorage } from "./ClineJsonlStorage"
import { ClineSyncStorage } from "./ClineStorage"

export interface ClineFileStorageOptions {
	/**
	 * File permissions mode (e.g., 0o600 for owner read/write only).
	 * If not set, uses the system default.
	 */
	fileMode?: number
}

/**
 * Synchronous file-backed JSON storage.
 * Stores any JSON-serializable values with sync read and write.
 * Used for VSCode Memento compatibility and CLI environments.
 *
 * ## JSONL Mode (Feature Flag)
 * When `CLINE_REFACTORING_FLAGS=jsonlStorage=true`, writes are appended as
 * individual JSON lines to a `.jsonl` file instead of rewriting the full JSON
 * on every `_set()`. This eliminates O(n) I/O blocking for frequently-changed
 * keys. Reads replay the JSONL from start (last-writer-wins per key).
 * A background `compact()` rewrites the accumulated entries into a fresh
 * compacted file when the entry count exceeds `compactThreshold`.
 */
export class ClineFileStorage<T = any> extends ClineSyncStorage<T> {
	protected name: string
	private data: Record<string, T>
	private readonly fsPath: string
	private readonly fileMode?: number

	/** JSONL-backed storage layer when the feature flag is enabled. */
	private readonly jsonlStore: ClineJsonlStorage | null

	constructor(filePath: string, name = "ClineFileStorage", options?: ClineFileStorageOptions) {
		super()
		this.fsPath = filePath
		this.name = name
		this.fileMode = options?.fileMode

		// If JSONL feature flag is enabled, use ClineJsonlStorage for writes
		// The .jsonl file sits alongside the .json file so both formats coexist
		// during migration — ClineFileStorage reads from JSON and writes to JSONL.
		if (isRefactoringEnabled("jsonlStorage")) {
			const jsonlPath = filePath.replace(/\.json$/, ".jsonl") || `${filePath}.jsonl`
			this.jsonlStore = new ClineJsonlStorage(jsonlPath, {
				fileMode: options?.fileMode,
			})
			// On first load with JSONL enabled, hydrate from JSONL if it exists;
			// otherwise fall through to the legacy JSON path for backward compat.
			this.data = this.readFromDisk()
		} else {
			this.jsonlStore = null
			this.data = this.readFromDisk()
		}
	}

	protected _get(key: string): T | undefined {
		return this.data[key]
	}

	protected _set(key: string, value: T | undefined): void {
		// Use setBatch for consistency - all writes go through one path
		this.setBatch({ [key]: value })
	}

	protected _delete(key: string): void {
		this.setBatch({ [key]: undefined })
	}

	/**
	 * Set multiple keys in a single write operation.
	 * More efficient than calling set() for each key individually,
	 * since it only writes to disk once.
	 *
	 * When JSONL mode is active, writes are appended as individual JSON lines
	 * instead of rewriting the full file. The in-memory cache is updated
	 * synchronously for immediate reads; the JSONL append is async-friendly
	 * and orders-of-magnitude cheaper for frequent small writes.
	 */
	public setBatch(entries: Record<string, T | undefined>): Thenable<void> {
		const changedKeys: string[] = []
		for (const [key, value] of Object.entries(entries)) {
			if (value === undefined) {
				if (key in this.data) {
					delete this.data[key]
					changedKeys.push(key)
				}
			} else {
				this.data[key] = value
				changedKeys.push(key)
			}
		}
		if (changedKeys.length > 0) {
			// JSONL mode: append individual lines instead of full-rewrite
			if (this.jsonlStore) {
				const jsonlEntries: Record<string, T | undefined> = {}
				for (const key of changedKeys) {
					jsonlEntries[key] = this.data[key]
				}
				this.jsonlStore.setBatch(jsonlEntries as Record<string, unknown | undefined>)
			} else {
				this.writeToDisk()
			}
			for (const key of changedKeys) {
				this.fireChange(key)
			}
		}
		return Promise.resolve()
	}

	protected _keys(): readonly string[] {
		return Object.keys(this.data)
	}

	private readFromDisk(): Record<string, T> {
		try {
			// JSONL mode: read from JSONL file (fall back to legacy .json if JSONL doesn't exist)
			if (this.jsonlStore) {
				return this.jsonlStore.readAll() as Record<string, T>
			}
			// Legacy mode: read full JSON file
			if (fs.existsSync(this.fsPath)) {
				return JSON.parse(fs.readFileSync(this.fsPath, "utf-8"))
			}
		} catch (error) {
			Logger.error(`[${this.name}] failed to read from disk:`, error)
		}
		return {}
	}

	private writeToDisk(): void {
		try {
			const dir = path.dirname(this.fsPath)
			fs.mkdirSync(dir, { recursive: true })
			atomicWriteFileSync(this.fsPath, JSON.stringify(this.data, null, 2), this.fileMode)
		} catch (error) {
			Logger.error(`[${this.name}] failed to write to ${this.fsPath}:`, error)
		}
	}
}

/**
 * Synchronously, atomically write data to a file using temp file + rename pattern.
 * Prefer core/storage's async atomicWriteFile to this.
 */
function atomicWriteFileSync(filePath: string, data: string, mode?: fs.Mode | undefined): void {
	const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}.json`
	try {
		fs.writeFileSync(tmpPath, data, {
			flag: "wx",
			encoding: "utf-8",
			mode,
		})
		// Rename temp file to target (atomic in most cases)
		fs.renameSync(tmpPath, filePath)
	} catch (error) {
		// Clean up temp file if it exists
		try {
			fs.unlinkSync(tmpPath)
		} catch {}
		throw error
	}
}
