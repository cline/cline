console.log("Loading stub impls...")

const { createStub, stubUri, createMemento } = require("stub-utils")
const open = require("open")

vscode.ExtensionContext = {
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
		persistent: true,
		replace: () => {},
		append: () => {},
		prepend: () => {},
		get: () => undefined,
		forEach: () => {},
		clear: () => {},
		delete: () => {},
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
	},

	subscriptions: [],

	asAbsolutePath: (relPath) => `/tmp/vscode/extension/${relPath}`,

	secrets: {
		store: async () => {},
		get: async () => undefined,
		delete: async () => {},
		onDidChange: { dispose: () => {} },
	},
}

vscode.window = {
	showInformationMessage: (...args) => {
		console.log("Stubbed showInformationMessage:", ...args)
		return Promise.resolve(undefined)
	},
	showWarningMessage: (...args) => {
		console.log("Stubbed showWarningMessage:", ...args)
		return Promise.resolve(undefined)
	},
	showErrorMessage: (...args) => {
		console.log("Stubbed showErrorMessage:", ...args)
		return Promise.resolve(undefined)
	},
	showInputBox: async (options) => {
		console.log("Stubbed showInputBox:", options)
		return ""
	},
	showOpenDialog: async (options) => {
		console.log("Stubbed showOpenDialog:", options)
		return []
	},
	showSaveDialog: async (options) => {
		console.log("Stubbed showSaveDialog:", options)
		return undefined
	},
	showTextDocument: async (...args) => {
		console.log("Stubbed showTextDocument:", ...args)
		return {}
	},
	createOutputChannel: (name) => {
		console.log("Stubbed createOutputChannel:", name)
		return {
			appendLine: console.log,
			show: () => {},
			dispose: () => {},
		}
	},
	createTerminal: (...args) => {
		console.log("Stubbed createTerminal:", ...args)
		return {
			sendText: console.log,
			show: () => {},
			dispose: () => {},
		}
	},
	activeTextEditor: undefined,
	visibleTextEditors: [],
	tabGroups: {
		all: [],
		close: async () => {},
	},
	withProgress: async (_options, task) => {
		console.log("Stubbed withProgress")
		return task({ report: () => {} })
	},
	registerUriHandler: () => ({ dispose: () => {} }),
	registerWebviewViewProvider: () => ({ dispose: () => {} }),
	onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
	createTextEditorDecorationType: () => ({ dispose: () => {} }),
	createWebviewPanel: (...args) => {
		console.log("Stubbed createWebviewPanel:", ...args)
		return {
			webview: {},
			reveal: () => {},
			dispose: () => {},
		}
	},
}
vscode.OutputChannel = {
	append: (text) => process.stdout.write(text),
	appendLine: (line) => console.log(line),
	clear: () => {},
	show: () => {},
	hide: () => {},
	dispose: () => {},
}
vscode.env = {
	uriScheme: "vscode",
	appName: "Visual Studio Code",
	appRoot: "/tmp/vscode/appRoot",
	language: "en",
	machineId: "stub-machine-id",
	remoteName: undefined,
	sessionId: "stub-session-id",
	shell: "/bin/bash",

	clipboard: createStub("vscode.env.clipboard"),
	openExternal: createStub("vscode.env.openExternal"),
	getQueryParameter: createStub("vscode.env.getQueryParameter"),
	onDidChangeTelemetryEnabled: createStub("vscode.env.onDidChangeTelemetryEnabled"),
	isTelemetryEnabled: createStub("vscode.env.isTelemetryEnabled"),
	telemetryConfiguration: createStub("vscode.env.telemetryConfiguration"),
	onDidChangeTelemetryConfiguration: createStub("vscode.env.onDidChangeTelemetryConfiguration"),
	createTelemetryLogger: createStub("vscode.env.createTelemetryLogger"),
}

vscode.Uri = {
	parse: (uriString) => {
		const url = new URL(uriString)
		return {
			scheme: url.protocol.replace(":", ""),
			authority: url.hostname,
			path: url.pathname,
			query: url.search.slice(1),
			fragment: url.hash.slice(1),
			fsPath: `/tmp${url.pathname}`,
			toString: () => uriString,
			toJSON: () => uriString,
			with: (change) => {
				const newUrl = new URL(uriString)
				if (change.scheme) newUrl.protocol = change.scheme + ":"
				if (change.authority) newUrl.hostname = change.authority
				if (change.path) newUrl.pathname = change.path
				if (change.query) newUrl.search = "?" + change.query
				if (change.fragment) newUrl.hash = "#" + change.fragment
				return vscode.Uri.parse(newUrl.toString())
			},
		}
	},

	file: (path) => {
		return {
			scheme: "file",
			authority: "",
			path,
			fsPath: path,
			query: "",
			fragment: "",
			toString: () => `file://${path}`,
			toJSON: () => `file://${path}`,
			with: (change) => {
				const modified = Object.assign({}, vscode.Uri.file(path), change)
				return modified
			},
		}
	},

	joinPath: (...segments) => {
		const joined = segments.map((s) => (typeof s === "string" ? s : s.path)).join("/")
		return vscode.Uri.file("/" + joined.replace(/\/+/g, "/"))
	},
}

vscode.env.openExternal = async (uri) => {
	const url = typeof uri === "string" ? uri : (uri.toString?.() ?? "")
	console.log("Opening browser:", url)
	await open(url)
	return true
}

console.log("Finished loading stub impls...")
