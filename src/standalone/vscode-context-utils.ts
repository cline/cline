import * as fs from "fs"
import type { EnvironmentVariableMutator, EnvironmentVariableMutatorOptions, EnvironmentVariableScope } from "vscode"
import * as vscode from "vscode"

let keytar: any | null = null
try {
	// Runtime require to avoid bundling native module and keep VS Code build clean
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	// @ts-ignore
	keytar = require("keytar")
} catch (err) {
	console.warn("[cline] Failed to load keytar; falling back to JSON secret store.", err)
	keytar = null
}

const SERVICE_NAME = "cline"

export class SecretStore implements vscode.SecretStorage {
	private readonly _onDidChange = new EventEmitter<vscode.SecretStorageChangeEvent>()
	private readonly jsonStore: JsonKeyValueStore<string>
	private readonly jsonFilePath: string

	constructor(filepath: string) {
		// JSON store always created as fallback, even when keytar is available
		this.jsonStore = new JsonKeyValueStore<string>(filepath)
		this.jsonFilePath = filepath
		if (keytar) {
			void this.migrateSecretsToKeytarIfNeeded()
		}
	}

	readonly onDidChange: vscode.Event<vscode.SecretStorageChangeEvent> = this._onDidChange.event

	get(key: string): Thenable<string | undefined> {
		if (keytar) {
			return keytar.getPassword(SERVICE_NAME, key).then((v: string | null) => (v === null ? undefined : v))
		}
		return Promise.resolve(this.jsonStore.get(key))
	}

	store(key: string, value: string): Thenable<void> {
		if (keytar) {
			return keytar.setPassword(SERVICE_NAME, key, value).then(() => {
				this._onDidChange.fire({ key })
			})
		}
		this.jsonStore.put(key, value)
		this._onDidChange.fire({ key })
		return Promise.resolve()
	}

	delete(key: string): Thenable<void> {
		if (keytar) {
			return keytar.deletePassword(SERVICE_NAME, key).then(() => {
				this._onDidChange.fire({ key })
			})
		}
		this.jsonStore.delete(key)
		this._onDidChange.fire({ key })
		return Promise.resolve()
	}

	private async migrateSecretsToKeytarIfNeeded(): Promise<void> {
		try {
			// Skip if keytar already has secrets or no JSON file exists
			const existingSecrets = await keytar!.findCredentials(SERVICE_NAME)
			if (existingSecrets?.length > 0 || !fs.existsSync(this.jsonFilePath)) return

			const data = JSON.parse(fs.readFileSync(this.jsonFilePath, "utf-8"))
			const secrets = Object.entries(data || {}).filter(([, v]) => typeof v === "string" && (v as string).length > 0)

			if (secrets.length === 0) {
				fs.unlinkSync(this.jsonFilePath)
				return
			}

			const migratedKeys: string[] = []
			for (const [k, v] of secrets) {
				try {
					await keytar!.setPassword(SERVICE_NAME, k, v as string)
					migratedKeys.push(k)
				} catch (err) {
					console.warn(`[cline] Failed to migrate secret for key "${k}" to keytar. Rolling back.`, err)
					// Roll back any migrated keys, keep JSON intact
					await Promise.all(
						migratedKeys.map(async (mk) => {
							try {
								await keytar!.deletePassword(SERVICE_NAME, mk)
							} catch (rollbackErr) {
								console.warn(`[cline] Failed to rollback migrated key "${mk}" from keytar.`, rollbackErr)
							}
						}),
					)
					return
				}
			}

			fs.unlinkSync(this.jsonFilePath)
		} catch (err) {
			console.warn("[cline] Secret migration to keytar failed. Keeping JSON store.", err)
		}
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
		this.data.put(key, value)
		return Promise.resolve()
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
		this.data.set(key, value)
		this.save()
	}

	delete(key: string): void {
		this.data.delete(key)
		this.save()
	}
	keys(): Iterable<string> | ArrayLike<string> {
		return this.data.keys()
	}
	private load(): void {
		if (fs.existsSync(this.filePath)) {
			const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"))
			Object.entries(data).forEach(([k, v]) => {
				this.data.set(k, v as T)
			})
		}
	}
	private save(): void {
		fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.data), null, 2))
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
