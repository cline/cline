console.log("Loading stub impls...")

const { createStub } = require("./stub-utils")

// Import the base vscode object from stubs
const vscode = require("./vscode-stubs.js")

// Extend the existing window object from stubs rather than overwriting it
vscode.window = {
	...vscode.window, // Keep existing properties from stubs
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
	createTerminal: (...args) => {
		// In standalone mode, terminals are managed directly by Task.terminalManager (StandaloneTerminalManager)
		// This stub is provided for compatibility but should not be called directly
		console.log("Stubbed createTerminal:", ...args)

		// Return a minimal stub terminal object
		const stubTerminal = {
			name: args[0]?.name || args[0] || "Terminal",
			processId: Promise.resolve(undefined),
			creationOptions: {},
			exitStatus: undefined,
			state: { isInteractedWith: false },
			sendText: (text) => console.log("Stubbed terminal.sendText:", text),
			show: () => console.log("Stubbed terminal.show"),
			hide: () => console.log("Stubbed terminal.hide"),
			dispose: () => console.log("Stubbed terminal.dispose"),
		}

		vscode.window.terminals.push(stubTerminal)
		return stubTerminal
	},
	activeTextEditor: undefined,
	visibleTextEditors: [],
	tabGroups: {
		all: [],
		close: async () => {},
		onDidChangeTabs: createStub("vscode.env.tabGroups.onDidChangeTabs"),
		activeTabGroup: { tabs: [] },
	},
	withProgress: async (_options, task) => {
		console.log("Stubbed withProgress")
		return task({ report: () => {} })
	},
	registerUriHandler: () => ({ dispose: () => {} }),
	registerWebviewViewProvider: () => ({ dispose: () => {} }),
	onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
	createTextEditorDecorationType: () => ({ dispose: () => {} }),
	createWebviewPanel: (..._args) => {
		throw new Error("WebviewPanel is not supported in standalone app.")
	},
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
				if (change.scheme) {
					newUrl.protocol = change.scheme + ":"
				}
				if (change.authority) {
					newUrl.hostname = change.authority
				}
				if (change.path) {
					newUrl.pathname = change.path
				}
				if (change.query) {
					newUrl.search = "?" + change.query
				}
				if (change.fragment) {
					newUrl.hash = "#" + change.fragment
				}
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

console.log("Finished loading stub impls...")
