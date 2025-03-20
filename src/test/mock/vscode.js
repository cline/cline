/**
 * Mock vscode module for unit tests
 * This provides minimal implementations of vscode APIs used in the codebase
 * to allow tests to run outside the VS Code extension host.
 */

// Simple mock function implementation
const mockFn = () => {
	const fn = (...args) => {
		fn.calls.push(args)
		return fn.returnValue
	}
	fn.calls = []
	fn.returnValue = undefined
	fn.mockReturnValue = (val) => {
		fn.returnValue = val
		return fn
	}
	fn.mockImplementation = (implementation) => {
		const originalFn = fn
		const newFn = (...args) => {
			newFn.calls.push(args)
			return implementation(...args)
		}
		newFn.calls = originalFn.calls
		newFn.returnValue = originalFn.returnValue
		newFn.mockReturnValue = originalFn.mockReturnValue
		newFn.mockImplementation = originalFn.mockImplementation
		return newFn
	}
	return fn
}

const window = {
	showInformationMessage: mockFn(),
	showErrorMessage: mockFn(),
	showWarningMessage: mockFn(),
	createOutputChannel: mockFn().mockReturnValue({
		appendLine: mockFn(),
		append: mockFn(),
		clear: mockFn(),
		show: mockFn(),
		dispose: mockFn(),
	}),
	createTerminal: mockFn().mockReturnValue({
		sendText: mockFn(),
		show: mockFn(),
		dispose: mockFn(),
	}),
	activeTextEditor: {
		document: {
			uri: {
				fsPath: "/test/path",
			},
		},
	},
}

const workspace = {
	getConfiguration: mockFn().mockReturnValue({
		get: mockFn(),
		has: mockFn(),
		update: mockFn(),
	}),
	workspaceFolders: [
		{
			uri: {
				fsPath: "/test/workspace",
			},
		},
	],
	fs: {
		readFile: mockFn(),
		writeFile: mockFn(),
		stat: mockFn(),
		createDirectory: mockFn(),
		delete: mockFn(),
		exists: mockFn(),
	},
}

const Uri = {
	file: (path) => ({
		fsPath: path,
		scheme: "file",
	}),
	parse: mockFn().mockImplementation((uriString) => ({
		fsPath: uriString.replace("file://", ""),
		scheme: "file",
	})),
}

const commands = {
	registerCommand: mockFn(),
	executeCommand: mockFn(),
}

const extensions = {
	getExtension: mockFn(),
}

const ExtensionContext = {
	subscriptions: [],
	extensionPath: "/test/extension/path",
	storageUri: {
		fsPath: "/test/storage",
	},
	globalStorageUri: {
		fsPath: "/test/global-storage",
	},
}

// Common VS Code constants
class ThemeColor {
	constructor(id) {
		this.id = id
	}
}

const ConfigurationTarget = {
	Global: 1,
	Workspace: 2,
	WorkspaceFolder: 3,
}

// Default export for import statements like `import vscode from 'vscode'`
module.exports = {
	window,
	workspace,
	Uri,
	commands,
	extensions,
	ExtensionContext,
	ThemeColor,
	ConfigurationTarget,
}
