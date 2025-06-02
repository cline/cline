import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"

// This is need to set properties on the extension context, because they are read-only in the vscode API.
export function setContextProperty<K extends keyof vscode.ExtensionContext>(
	context: any,
	propertyName: K,
	value: vscode.ExtensionContext[K],
) {
	Object.defineProperty(context, propertyName, {
		value,
		writable: true,
		configurable: true,
	})
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

export class JsonKeyValueStore {
	// A simple key-value store for secrets backed by a JSON file. This is not secure, and it is not thread-safe.
	private data = new Map<string, string>()
	private filePath: string

	constructor(dir: string, fileName: string) {
		this.filePath = path.join(dir, fileName)
		this.load()
	}

	get(key: string): string | undefined {
		return this.data.get(key)
	}

	put(key: string, value: string): void {
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
				if (typeof v === "string") {
					this.data.set(k, v)
				}
			})
		}
	}
	private save(): void {
		fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.data), null, 2))
	}
}
