// @ts-nocheck
import * as vscode from "vscode"
import open from "open"
import { log } from "./utils"

function stubUri(path: string): vscode.Uri {
	console.log(`Using file path: ${path}`)
	return {
		fsPath: path,
		scheme: "",
		authority: "",
		path: "",
		query: "",
		fragment: "",
		with: function (change: {
			scheme?: string
			authority?: string
			path?: string
			query?: string
			fragment?: string
		}): vscode.Uri {
			return stubUri(path)
		},
		toString: function (skipEncoding?: boolean): string {
			return path
		},
		toJSON: function () {
			return {}
		},
	}
}

function createMemento(): vscode.Memento {
	const store = {}
	return {
		keys: function (): readonly string[] {
			return Object.keys(store)
		},
		get: function <T>(key: string): T | undefined {
			return key in store ? store[key] : undefined
		},
		update: function (key: string, value: any): Thenable<void> {
			store[key] = value
			return Promise.resolve()
		},
	}
}

const extensionContext: vscode.ExtensionContext = {
	extensionPath: "/tmp/vscode/extension",
	extensionUri: stubUri("/tmp/vscode/extension"),

	globalStoragePath: "/tmp/vscode/global",
	globalStorageUri: stubUri("/tmp/vscode/global"),

	storagePath: "/tmp/vscode/storage",
	storageUri: stubUri("/tmp/vscode/storage"),

	logPath: "/tmp/vscode/log",
	logUri: stubUri("/tmp/vscode/log"),

	globalState: createMemento(),
	workspaceState: createMemento(),
	storageState: createMemento(),

	environmentVariableCollection: {
		getScoped: function (scope: vscode.EnvironmentVariableScope): vscode.EnvironmentVariableCollection {
			return {
				persistent: false,
				description: undefined,
				replace: function (variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {},
				append: function (variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {},
				prepend: function (variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {},
				get: function (variable: string): vscode.EnvironmentVariableMutator | undefined {
					return undefined
				},
				forEach: function (
					callback: (
						variable: string,
						mutator: vscode.EnvironmentVariableMutator,
						collection: vscode.EnvironmentVariableCollection,
					) => any,
					thisArg?: any,
				): void {},
				delete: function (variable: string): void {},
				clear: function (): void {},
				[Symbol.iterator]: function (): Iterator<
					[variable: string, mutator: vscode.EnvironmentVariableMutator],
					any,
					any
				> {
					throw new Error("environmentVariableCollection.getScoped.Iterator not implemented")
				},
			}
		},
		persistent: false,
		description: undefined,
		replace: function (variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {},
		append: function (variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {},
		prepend: function (variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {},
		get: function (variable: string): vscode.EnvironmentVariableMutator | undefined {
			return undefined
		},
		forEach: function (
			callback: (
				variable: string,
				mutator: vscode.EnvironmentVariableMutator,
				collection: vscode.EnvironmentVariableCollection,
			) => any,
			thisArg?: any,
		): void {
			throw new Error("environmentVariableCollection.forEach not implemented")
		},
		delete: function (variable: string): void {},
		clear: function (): void {},
		[Symbol.iterator]: function (): Iterator<[variable: string, mutator: vscode.EnvironmentVariableMutator], any, any> {
			throw new Error("environmentVariableCollection.Iterator not implemented")
		},
	},

	extensionMode: 1, // Development

	extension: {
		id: "your.extension.id",
		isActive: true,
		extensionPath: "/tmp/vscode/extension",
		extensionUri: stubUri("/tmp/vscode/extension"),
		packageJSON: {},
		exports: {},
		activate: async () => {},
		extensionKind: vscode.ExtensionKind.UI,
	},

	subscriptions: [],

	asAbsolutePath: (relPath) => `/tmp/vscode/extension/${relPath}`,

	secrets: {
		store: async () => {},
		get: async () => undefined,
		delete: async () => {},
		onDidChange: {},
	},
}

const outputChannel: vscode.OutputChannel = {
	append: (text) => process.stdout.write(text),
	appendLine: (line) => console.log(line),
	clear: () => {},
	show: () => {},
	hide: () => {},
	dispose: () => {},
	name: "",
	replace: function (value: string): void {},
}

function postMessage(message: ExtensionMessage): Promise<boolean> {
	log("postMessage called:", message)
	return Promise.resolve(true)
}

console.log("Finished loading vscode context...")

export { extensionContext, outputChannel, postMessage }
