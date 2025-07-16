console.log("Loading stub impls...")

const { createStub } = require("./stub-utils")
const open = require("open").default
const { StandaloneTerminalManager } = require("./enhanced-terminal")

// Import the base vscode object from stubs
const vscode = require("./vscode-stubs.js")

// Create global terminal manager instance
const globalTerminalManager = new StandaloneTerminalManager()

vscode.windowcreateTerminal = (...args) => {
	console.log("Enhanced createTerminal:", ...args)
	// Extract options from arguments
	let options = {}
	if (args.length > 0) {
		if (typeof args[0] === "string") {
			// Called with (name, shellPath, shellArgs)
			options = {
				name: args[0],
				shellPath: args[1],
				shellArgs: args[2],
			}
		} else if (typeof args[0] === "object") {
			// Called with options object
			options = args[0]
		}
	}

	// Use our enhanced terminal manager to create a terminal
	const terminalInfo = globalTerminalManager.registry.createTerminal({
		name: options.name || `Terminal ${Date.now()}`,
		cwd: options.cwd || process.cwd(),
		shellPath: options.shellPath,
	})

	// Store reference for tracking
	vscode.window.terminals.push(terminalInfo.terminal)
	if (!vscode.window.activeTerminal) {
		vscode.window.activeTerminal = terminalInfo.terminal
	}

	console.log(`Enhanced terminal created: ${terminalInfo.id}`)
	return terminalInfo.terminal
}

// Initialize env object if it doesn't exist, then extend it
if (!vscode.env) {
	vscode.env = {}
}

Object.assign(vscode.env, {
	uriScheme: "vscode",
	appName: "Visual Studio Code",
	appRoot: "/tmp/vscode/appRoot",
	language: "en",
	machineId: "stub-machine-id",
	remoteName: undefined,
	sessionId: "stub-session-id",
	shell: "/bin/bash",

	// Add the stub functions that were missing
	clipboard: createStub("vscode.env.clipboard"),
	getQueryParameter: createStub("vscode.env.getQueryParameter"),
	onDidChangeTelemetryEnabled: createStub("vscode.env.onDidChangeTelemetryEnabled"),
	isTelemetryEnabled: createStub("vscode.env.isTelemetryEnabled"),
	telemetryConfiguration: createStub("vscode.env.telemetryConfiguration"),
	onDidChangeTelemetryConfiguration: createStub("vscode.env.onDidChangeTelemetryConfiguration"),
	createTelemetryLogger: createStub("vscode.env.createTelemetryLogger"),
})

// Override the openExternal function with actual implementation
vscode.env.openExternal = async (uri) => {
	const url = typeof uri === "string" ? uri : (uri.toString?.() ?? "")
	console.log("Opening browser:", url)
	await open(url)
	return true
}

// Extend Uri object with improved implementations
Object.assign(vscode.Uri, {
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
})

// Export the terminal manager globally for Cline core to use
global.standaloneTerminalManager = globalTerminalManager

// Override the TerminalManager to use our standalone implementation
if (typeof global !== "undefined") {
	// Replace the TerminalManager class with our standalone implementation
	global.StandaloneTerminalManagerClass = require("./enhanced-terminal").StandaloneTerminalManager
}

module.exports = vscode

console.log("Finished loading stub impls...")
