import * as vscode from "vscode"

import { EventEmitter, JsonKeyValueStore, setContextProperty } from "./vscode-context-utils"
import { extensionContext, outputChannel, postMessage } from "./vscode-context-stubs"

const DATA_DIR = process.env.DATA_DIR ?? "."

class SecretStore implements vscode.SecretStorage {
	private data = new JsonKeyValueStore(DATA_DIR, "secrets.json")
	private readonly _onDidChange = new EventEmitter<vscode.SecretStorageChangeEvent>()

	// Required by vscode.SecretStorage interface
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
class MementoStore implements vscode.Memento {
	private data: JsonKeyValueStore

	constructor(filename: string) {
		this.data = new JsonKeyValueStore(DATA_DIR, filename)
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

setContextProperty(extensionContext, "globalState", new MementoStore("globalState.json"))
setContextProperty(extensionContext, "secrets", new SecretStore())

console.log("Finished loading vscode context...")

export { extensionContext, outputChannel, postMessage }
