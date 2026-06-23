import * as fs from "fs"
import type { EnvironmentVariableMutator, EnvironmentVariableMutatorOptions, EnvironmentVariableScope } from "vscode"
import * as vscode from "vscode"
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
		// Use mode 0o600 to restrict file permissions to owner read/write only (fixes #7778)
		fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.data), null, 2), { mode: 0o600 })
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
