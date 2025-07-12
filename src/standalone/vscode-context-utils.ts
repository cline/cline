import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import type { EnvironmentVariableMutatorOptions, EnvironmentVariableMutator, EnvironmentVariableScope } from "vscode"
export class SecretStore implements vscode.SecretStorage {
	private data: JsonKeyValueStore<string>
	private readonly _onDidChange = new EventEmitter<vscode.SecretStorageChangeEvent>()

	constructor(filepath: string) {
		this.data = new JsonKeyValueStore(filepath)
	}

	readonly onDidChange: vscode.Event<vscode.SecretStorageChangeEvent> = this._onDidChange.event

	get(key: string): Thenable<string | undefined> {
		return Promise.resolve(this.data.get(key))
	}

	store(key: string, value: string): Thenable<void> {
		this.data.put(key, value)
		this._onDidChange.fire({ key })
		return Promise.resolve()
	}

	delete(key: string): Thenable<void> {
		this.data.delete(key)
		this._onDidChange.fire({ key })
		return Promise.resolve()
	}
}

// Create a class that implements Memento interface with the required setKeysForSync method
export class MementoStore implements vscode.Memento {
	private data: JsonKeyValueStore<any>

	constructor(filepath: string) {
		this.data = new JsonKeyValueStore(filepath)
	}
	keys(): readonly string[] {
		return Array.from(this.data.keys())
	}
	get<T>(key: string): T | undefined {
		return this.data.get(key) as T
	}
	update(key: string, value: any): Thenable<void> {
		try {
			if (value === undefined) {
				// Remove the key if value is undefined (VSCode's behavior)
				this.data.delete(key)
			} else {
				this.data.put(key, value)
			}
			return Promise.resolve()
		} catch (error) {
			console.error(`Failed to update key '${key}' in MementoStore:`, error)
			return Promise.reject(error)
		}
	}
	setKeysForSync(_keys: readonly string[]): void {
		throw new Error("Method not implemented.")
	}
}

// Simple implementation of VSCode's EventEmitter
type EventCallback<T> = (e: T) => any
export class EventEmitter<T> {
	private listeners: EventCallback<T>[] = []

	event: vscode.Event<T> = (listener: EventCallback<T>) => {
		this.listeners.push(listener)
		return {
			dispose: () => {
				const index = this.listeners.indexOf(listener)
				if (index !== -1) {
					this.listeners.splice(index, 1)
				}
			},
		}
	}

	fire(data: T): void {
		this.listeners.forEach((listener) => listener(data))
	}
}

/** A simple key-value store for secrets backed by a JSON file. This is not secure, and it is not thread-safe. */
export class JsonKeyValueStore<T> {
	private data = new Map<string, T>()
	private filePath: string

	constructor(filePath: string) {
		this.filePath = filePath
		this.load()
	}

	get(key: string): T | undefined {
		return this.data.get(key)
	}

	put(key: string, value: T): void {
		// Disable verbose logging - only log for non-large data
		if (key !== "taskHistory" && key !== "apiConversationHistory") {
			console.log(`[JsonKeyValueStore] Setting key '${key}' to:`, typeof value === "object" ? JSON.stringify(value) : value)
		}
		this.data.set(key, value)
		this.save()
	}

	delete(key: string): void {
		console.log(`[JsonKeyValueStore] Deleting key '${key}'`)
		this.data.delete(key)
		this.save()
	}
	keys(): Iterable<string> | ArrayLike<string> {
		return this.data.keys()
	}
	private load(): void {
		if (fs.existsSync(this.filePath)) {
			try {
				const fileContent = fs.readFileSync(this.filePath, "utf-8")
				if (fileContent.trim()) {
					const data = JSON.parse(fileContent)
					if (data && typeof data === "object") {
						Object.entries(data).forEach(([k, v]) => {
							this.data.set(k, v as T)
						})
						console.log(`Successfully loaded data from ${this.filePath}`)
					} else {
						console.warn(`Invalid data format in ${this.filePath}, starting with empty store`)
					}
				} else {
					console.log(`Empty file ${this.filePath}, starting with empty store`)
				}
			} catch (error) {
				console.error(`Failed to load data from ${this.filePath}:`, error)
				// Try to load from backup
				const backupPath = this.filePath + ".backup"
				if (fs.existsSync(backupPath)) {
					try {
						const backupContent = fs.readFileSync(backupPath, "utf-8")
						if (backupContent.trim()) {
							const backupData = JSON.parse(backupContent)
							if (backupData && typeof backupData === "object") {
								Object.entries(backupData).forEach(([k, v]) => {
									this.data.set(k, v as T)
								})
								console.log(`Successfully restored data from backup: ${backupPath}`)
							}
						}
					} catch (backupError) {
						console.error(`Failed to restore from backup:`, backupError)
					}
				}
				// Continue with empty store if both main and backup fail
				console.log(`Starting with empty store for ${this.filePath}`)
			}
		} else {
			console.log(`File ${this.filePath} does not exist, starting with empty store`)
		}
	}
	private save(): void {
		try {
			// Ensure directory exists
			const dir = path.dirname(this.filePath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}

			// Create backup of existing file
			const backupPath = this.filePath + ".backup"
			if (fs.existsSync(this.filePath)) {
				fs.copyFileSync(this.filePath, backupPath)
			}

			// Write new data
			const dataToWrite = JSON.stringify(Object.fromEntries(this.data), null, 2)
			fs.writeFileSync(this.filePath, dataToWrite, "utf-8")

			// Remove backup on successful write
			if (fs.existsSync(backupPath)) {
				fs.unlinkSync(backupPath)
			}

			// Only log saves for non-large data files
			if (!this.filePath.includes("globalState.json")) {
				console.log(`Successfully saved data to ${this.filePath}`)
			}
		} catch (error) {
			console.error(`Failed to save data to ${this.filePath}:`, error)

			// Try to restore from backup
			const backupPath = this.filePath + ".backup"
			if (fs.existsSync(backupPath)) {
				try {
					fs.copyFileSync(backupPath, this.filePath)
					console.log(`Restored data from backup: ${backupPath}`)
				} catch (restoreError) {
					console.error(`Failed to restore from backup:`, restoreError)
				}
			}

			throw error
		}
	}
}

/** This is not used in cline, none of the methods are implemented. */
export class EnvironmentVariableCollection implements EnvironmentVariableCollection {
	persistent: boolean = false
	description: string | undefined = undefined
	replace(_variable: string, _value: string, _options?: EnvironmentVariableMutatorOptions): void {
		throw new Error("Method not implemented.")
	}
	append(_variable: string, _value: string, _options?: EnvironmentVariableMutatorOptions): void {
		throw new Error("Method not implemented.")
	}
	prepend(_variable: string, _value: string, _options?: EnvironmentVariableMutatorOptions): void {
		throw new Error("Method not implemented.")
	}
	get(_variable: string): EnvironmentVariableMutator | undefined {
		throw new Error("Method not implemented.")
	}
	forEach(
		_callback: (variable: string, mutator: EnvironmentVariableMutator, collection: EnvironmentVariableCollection) => any,
		_thisArg?: any,
	): void {
		throw new Error("Method not implemented.")
	}
	delete(_variable: string): void {
		throw new Error("Method not implemented.")
	}
	clear(): void {
		throw new Error("Method not implemented.")
	}
	[Symbol.iterator](): Iterator<[variable: string, mutator: EnvironmentVariableMutator], any, any> {
		throw new Error("Method not implemented.")
	}
	getScoped(_scope: EnvironmentVariableScope): EnvironmentVariableCollection {
		throw new Error("Method not implemented.")
	}
}

export function readJson(filePath: string): any {
	return JSON.parse(fs.readFileSync(filePath, "utf8"))
}
