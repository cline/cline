import * as fs from "node:fs"
import * as path from "node:path"
import { Logger } from "../services/Logger"
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
 */
export class ClineFileStorage<T = any> extends ClineSyncStorage<T> {
	protected name: string
	private data: Record<string, T>
	private readonly fsPath: string
	private readonly fileMode?: number

	constructor(filePath: string, name = "ClineFileStorage", options?: ClineFileStorageOptions) {
		super()
		this.fsPath = filePath
		this.name = name
		this.fileMode = options?.fileMode
		this.data = this.readFromDisk()
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
			this.writeToDisk()
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
			if (fs.existsSync(this.fsPath)) {
				return JSON.parse(fs.readFileSync(this.fsPath, "utf-8"))
			}
		} catch (error) {
			Logger.error(`[${this.name}] failed to read from ${this.fsPath}:`, error)
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
