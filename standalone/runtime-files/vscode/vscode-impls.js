console.log("Loading stub impls...")

const { createStub } = require("./stub-utils")
const open = require("open").default
const fs = require("fs")
const path = require("path")
const { StandaloneTerminalManager } = require("./enhanced-terminal")

// Import the base vscode object from stubs
const vscode = require("./vscode-stubs.js")

// Create global terminal manager instance
const globalTerminalManager = new StandaloneTerminalManager()

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
	showTextDocument: async (uri, options) => {
		console.log("Stubbed showTextDocument:", uri, options)

		// Extract file path from URI
		let filePath = uri.path || uri.fsPath || uri
		if (typeof filePath !== "string") {
			filePath = uri.toString()
		}

		// Remove file:// prefix if present
		if (filePath.startsWith("file://")) {
			filePath = filePath.substring(7)
		}

		// Create a function that always reads the current file content
		const getCurrentFileContent = async () => {
			try {
				const content = await fs.promises.readFile(filePath, "utf8")
				console.log(`getCurrentFileContent: Read file ${filePath} (${content.length} chars)`)
				return content
			} catch (error) {
				console.log(`getCurrentFileContent: Could not read file ${filePath}:`, error.message)
				return ""
			}
		}

		// Try to read the initial file content
		let fileContent = await getCurrentFileContent()
		let lineCount = fileContent.split("\n").length

		// Check if we already have an active editor for this file path
		const existingEditor = vscode.window._documentEditors && vscode.window._documentEditors[filePath]
		if (existingEditor) {
			console.log(`showTextDocument: Updating existing editor for ${filePath}`)
			// Update the existing editor's content
			fileContent = await getCurrentFileContent()
			lineCount = fileContent.split("\n").length

			// Update the document's getText method to return current content
			existingEditor.document.getText = (range) => {
				// Always read fresh content for getText calls
				const currentContent = require("fs").readFileSync(filePath, "utf8")
				if (!range) {
					return currentContent
				}
				// Handle range-based getText with current content
				const lines = currentContent.split("\n")
				const startLine = Math.max(0, range.start.line)
				const endLine = Math.min(lines.length - 1, range.end.line)

				if (startLine === endLine) {
					// Single line
					const line = lines[startLine] || ""
					const startChar = Math.max(0, range.start.character)
					const endChar = Math.min(line.length, range.end.character)
					return line.substring(startChar, endChar)
				} else {
					// Multiple lines
					const result = []
					for (let i = startLine; i <= endLine; i++) {
						const line = lines[i] || ""
						if (i === startLine) {
							result.push(line.substring(range.start.character))
						} else if (i === endLine) {
							result.push(line.substring(0, range.end.character))
						} else {
							result.push(line)
						}
					}
					return result.join("\n")
				}
			}

			// Update other properties
			existingEditor.document.lineCount = lineCount
			existingEditor.document.fileName = filePath

			// Update the active text editor reference
			vscode.window.activeTextEditor = existingEditor

			return existingEditor
		}

		// Create a new mock text editor that always reads current file content
		const mockEditor = {
			document: {
				uri: uri,
				fileName: filePath,
				isDirty: false,
				lineCount: lineCount,
				getText: (range) => {
					// Always read fresh content for getText calls
					try {
						const currentContent = require("fs").readFileSync(filePath, "utf8")
						console.log(`document.getText: Read fresh content (${currentContent.length} chars)`)
						if (!range) {
							return currentContent
						}
						// Handle range-based getText with current content
						const lines = currentContent.split("\n")
						const startLine = Math.max(0, range.start.line)
						const endLine = Math.min(lines.length - 1, range.end.line)

						if (startLine === endLine) {
							// Single line
							const line = lines[startLine] || ""
							const startChar = Math.max(0, range.start.character)
							const endChar = Math.min(line.length, range.end.character)
							return line.substring(startChar, endChar)
						} else {
							// Multiple lines
							const result = []
							for (let i = startLine; i <= endLine; i++) {
								const line = lines[i] || ""
								if (i === startLine) {
									result.push(line.substring(range.start.character))
								} else if (i === endLine) {
									result.push(line.substring(0, range.end.character))
								} else {
									result.push(line)
								}
							}
							return result.join("\n")
						}
					} catch (error) {
						console.error(`Error reading file in getText: ${error.message}`)
						return ""
					}
				},
				save: async () => {
					console.log("Called mock textDocument.save")
					return true
				},
				positionAt: (offset) => {
					try {
						const currentContent = require("fs").readFileSync(filePath, "utf8")
						const lines = currentContent.split("\n")
						let currentOffset = 0
						for (let line = 0; line < lines.length; line++) {
							const lineLength = lines[line].length + 1 // +1 for newline
							if (currentOffset + lineLength > offset) {
								return { line: line, character: offset - currentOffset }
							}
							currentOffset += lineLength
						}
						return { line: lines.length - 1, character: lines[lines.length - 1]?.length || 0 }
					} catch (error) {
						return { line: 0, character: 0 }
					}
				},
				offsetAt: (position) => {
					try {
						const currentContent = require("fs").readFileSync(filePath, "utf8")
						const lines = currentContent.split("\n")
						let offset = 0
						for (let i = 0; i < position.line && i < lines.length; i++) {
							offset += lines[i].length + 1 // +1 for newline
						}
						offset += Math.min(position.character, lines[position.line]?.length || 0)
						return offset
					} catch (error) {
						return 0
					}
				},
			},
			selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
			selections: [],
			visibleRanges: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }],
			options: {},
			viewColumn: 1,
			edit: async (callback) => {
				console.log("Called mock textEditor.edit")
				return true
			},
			insertSnippet: async () => true,
			setDecorations: () => {},
			revealRange: () => {},
			show: () => {},
			hide: () => {},
		}

		// Store the editor by file path for future reference
		if (!vscode.window._documentEditors) {
			vscode.window._documentEditors = {}
		}
		vscode.window._documentEditors[filePath] = mockEditor

		// Update the active text editor
		vscode.window.activeTextEditor = mockEditor

		// Trigger onDidChangeActiveTextEditor listeners
		if (vscode.window._activeTextEditorListeners) {
			setTimeout(() => {
				vscode.window._activeTextEditorListeners.forEach((listener) => {
					try {
						listener(mockEditor)
					} catch (error) {
						console.error("Error calling onDidChangeActiveTextEditor listener:", error)
					}
				})
			}, 10) // Small delay to simulate async behavior
		}

		return mockEditor
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
	},
	activeTextEditor: undefined,
	visibleTextEditors: [],
	tabGroups: {
		all: [
			{
				tabs: [],
				isActive: true,
				viewColumn: 1,
			},
		],
		activeTabGroup: {
			tabs: [],
			isActive: true,
			viewColumn: 1,
		},
		close: async (tab) => {
			console.log("Stubbed tabGroups.close:", tab)
			return true
		},
		onDidChangeTabs: createStub("vscode.window.tabGroups.onDidChangeTabs"),
	},
	withProgress: async (_options, task) => {
		console.log("Stubbed withProgress")
		return task({ report: () => {} })
	},
	registerUriHandler: () => ({ dispose: () => {} }),
	registerWebviewViewProvider: () => ({ dispose: () => {} }),
	onDidChangeActiveTextEditor: (listener) => {
		console.log("Called vscode.window.onDidChangeActiveTextEditor")
		// Store the listener so we can call it when showTextDocument is called
		vscode.window._activeTextEditorListeners = vscode.window._activeTextEditorListeners || []
		vscode.window._activeTextEditorListeners.push(listener)
		return {
			dispose: () => {
				console.log("Disposed onDidChangeActiveTextEditor listener")
				const index = vscode.window._activeTextEditorListeners.indexOf(listener)
				if (index > -1) {
					vscode.window._activeTextEditorListeners.splice(index, 1)
				}
			},
		}
	},
	createTextEditorDecorationType: () => ({ dispose: () => {} }),
	createWebviewPanel: (...args) => {
		console.log("Stubbed createWebviewPanel:", ...args)
		return {
			webview: {},
			reveal: () => {},
			dispose: () => {},
		}
	},
	onDidChangeTerminalState: (listener) => {
		console.log("Called vscode.window.onDidChangeTerminalState")
		return {
			dispose: () => {
				console.log("Disposed onDidChangeTerminalState listener")
			},
		}
	},
	onDidChangeTextEditorVisibleRanges: (listener) => {
		console.log("Called vscode.window.onDidChangeTextEditorVisibleRanges")
		return {
			dispose: () => {
				console.log("Disposed onDidChangeTextEditorVisibleRanges listener")
			},
		}
	},
	terminals: [],
	activeTerminal: null,
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

// Extend workspace object with file system operations
Object.assign(vscode.workspace, {
	fs: {
		readFile: async function (uri) {
			console.log(`Called vscode.workspace.fs.readFile with uri:`, uri)
			try {
				// Extract file path from URI
				let filePath = uri.path || uri.fsPath || uri
				if (typeof filePath !== "string") {
					filePath = uri.toString()
				}

				// Remove file:// prefix if present
				if (filePath.startsWith("file://")) {
					filePath = filePath.substring(7)
				}

				console.log(`Reading file: ${filePath}`)
				const content = await fs.promises.readFile(filePath, "utf8")
				console.log(
					`File content read (${content.length} chars):`,
					content.substring(0, 100) + (content.length > 100 ? "..." : ""),
				)
				return new Uint8Array(Buffer.from(content, "utf8"))
			} catch (error) {
				console.error(`Error reading file:`, error)
				throw error
			}
		},

		writeFile: async function (uri, content) {
			console.log(`Called vscode.workspace.fs.writeFile with uri:`, uri)
			try {
				// Extract file path from URI
				let filePath = uri.path || uri.fsPath || uri
				if (typeof filePath !== "string") {
					filePath = uri.toString()
				}

				// Remove file:// prefix if present
				if (filePath.startsWith("file://")) {
					filePath = filePath.substring(7)
				}

				console.log(`Writing file: ${filePath}`)

				// Ensure directory exists
				const dir = path.dirname(filePath)
				await fs.promises.mkdir(dir, { recursive: true })

				// Write the file
				await fs.promises.writeFile(filePath, content)
			} catch (error) {
				console.error(`Error writing file:`, error)
				throw error
			}
		},
	},

	rootPath: process.cwd(),
	name: path.basename(process.cwd()),

	// Add other workspace methods as stubs
	getConfiguration: () => ({
		get: () => undefined,
		update: () => Promise.resolve(),
		has: () => false,
	}),
	createFileSystemWatcher: () => ({
		onDidChange: () => ({ dispose: () => {} }),
		onDidCreate: () => ({ dispose: () => {} }),
		onDidDelete: () => ({ dispose: () => {} }),
		dispose: () => {},
	}),
	onDidChangeConfiguration: () => ({ dispose: () => {} }),
	onDidCreateFiles: createStub("vscode.workspace.onDidCreateFiles"),
	onDidDeleteFiles: createStub("vscode.workspace.onDidDeleteFiles"),
	onDidRenameFiles: createStub("vscode.workspace.onDidRenameFiles"),
	onWillCreateFiles: createStub("vscode.workspace.onWillCreateFiles"),
	onWillDeleteFiles: createStub("vscode.workspace.onWillDeleteFiles"),
	onWillRenameFiles: createStub("vscode.workspace.onWillRenameFiles"),
	textDocuments: {
		find: (predicate) => {
			console.log("Called vscode.workspace.textDocuments.find")
			// Return a mock text document that behaves like VSCode expects
			return {
				uri: { fsPath: "/tmp/mock-document" },
				fileName: "/tmp/mock-document",
				isDirty: false,
				save: async () => {
					console.log("Called mock textDocument.save")
					return true
				},
				getText: () => "",
				lineCount: 0,
			}
		},
		forEach: (callback) => {
			console.log("Called vscode.workspace.textDocuments.forEach")
			// No documents to iterate over in standalone mode
		},
		length: 0,
		[Symbol.iterator]: function* () {
			// Empty iterator for standalone mode
		},
	},

	// Add the crucial applyEdit method
	applyEdit: async (workspaceEdit) => {
		console.log("Called vscode.workspace.applyEdit", workspaceEdit)

		// For standalone mode, we'll simulate applying the edit by actually writing to files
		try {
			// WorkspaceEdit can contain multiple types of edits
			if (workspaceEdit._edits) {
				for (const edit of workspaceEdit._edits) {
					if (edit._type === 1) {
						// TextEdit
						const uri = edit._uri
						const edits = edit._edits

						let filePath = uri.path || uri.fsPath
						if (filePath.startsWith("file://")) {
							filePath = filePath.substring(7)
						}

						console.log(`Applying text edits to: ${filePath}`)

						// Read current content if file exists
						let currentContent = ""
						try {
							currentContent = await fs.promises.readFile(filePath, "utf8")
						} catch (e) {
							// File doesn't exist, start with empty content
							console.log(`File ${filePath} doesn't exist, starting with empty content`)
						}

						// Apply edits in reverse order (from end to beginning) to maintain positions
						const sortedEdits = edits.sort((a, b) => {
							const aStart = a.range.start.line * 1000000 + a.range.start.character
							const bStart = b.range.start.line * 1000000 + b.range.start.character
							return bStart - aStart
						})

						let lines = currentContent.split("\n")

						for (const edit of sortedEdits) {
							const startLine = edit.range.start.line
							const startChar = edit.range.start.character
							const endLine = edit.range.end.line
							const endChar = edit.range.end.character
							const newText = edit.newText

							console.log(`Applying edit: ${startLine}:${startChar} - ${endLine}:${endChar} -> "${newText}"`)

							// Handle the edit
							if (startLine === endLine) {
								// Single line edit
								const line = lines[startLine] || ""
								lines[startLine] = line.substring(0, startChar) + newText + line.substring(endChar)
							} else {
								// Multi-line edit
								const firstLine = lines[startLine] || ""
								const lastLine = lines[endLine] || ""
								const newFirstLine = firstLine.substring(0, startChar) + newText + lastLine.substring(endChar)

								// Replace the range with the new content
								lines.splice(startLine, endLine - startLine + 1, newFirstLine)
							}
						}

						const newContent = lines.join("\n")

						// Ensure directory exists
						const dir = path.dirname(filePath)
						await fs.promises.mkdir(dir, { recursive: true })

						// Write the updated content
						await fs.promises.writeFile(filePath, newContent, "utf8")
						console.log(`Successfully applied edits to: ${filePath}`)
					}
				}
			}

			return true
		} catch (error) {
			console.error("Error applying workspace edit:", error)
			return false
		}
	},
})

// Fix CodeActionKind to have static properties instead of being a class
vscode.CodeActionKind = {
	Empty: "",
	QuickFix: "quickfix",
	Refactor: "refactor",
	RefactorExtract: "refactor.extract",
	RefactorInline: "refactor.inline",
	RefactorRewrite: "refactor.rewrite",
	Source: "source",
	SourceOrganizeImports: "source.organizeImports",
	SourceFixAll: "source.fixAll",
}

// Add missing commands implementation
if (!vscode.commands) {
	vscode.commands = {}
}

Object.assign(vscode.commands, {
	executeCommand: async (command, ...args) => {
		console.log(`Called vscode.commands.executeCommand: ${command}`, args)

		// Handle the vscode.diff command specifically
		if (command === "vscode.diff") {
			const [originalUri, modifiedUri, title, options] = args
			console.log("Opening diff view:", { originalUri, modifiedUri, title })

			// For standalone mode, just open the modified file directly
			// since we can't show a proper diff view
			const editor = await vscode.window.showTextDocument(modifiedUri, {
				preserveFocus: options?.preserveFocus || false,
				preview: false,
			})

			// Ensure the onDidChangeActiveTextEditor event fires with a slight delay
			// This is crucial for DiffViewProvider.openDiffEditor() to work properly
			setTimeout(() => {
				if (vscode.window._activeTextEditorListeners) {
					vscode.window._activeTextEditorListeners.forEach((listener) => {
						try {
							listener(editor)
						} catch (error) {
							console.error("Error calling onDidChangeActiveTextEditor listener in vscode.diff:", error)
						}
					})
				}
			}, 50) // Slightly longer delay to ensure proper event ordering

			return editor
		}

		// For other commands, just return a resolved promise
		return Promise.resolve()
	},
	registerCommand: (command, callback) => {
		console.log(`Registered command: ${command}`)
		return { dispose: () => {} }
	},
	getCommands: async () => {
		return []
	},
})

// Add missing TabInput classes
vscode.TabInputText = class TabInputText {
	constructor(uri) {
		this.uri = uri
	}
}

vscode.TabInputTextDiff = class TabInputTextDiff {
	constructor(original, modified) {
		this.original = original
		this.modified = modified
	}
}

// Add missing WorkspaceEdit and related classes
vscode.WorkspaceEdit = class WorkspaceEdit {
	constructor() {
		this._edits = []
	}

	replace(uri, range, newText) {
		console.log("WorkspaceEdit.replace:", uri, range, newText)
		this._edits.push({
			_type: 1, // TextEdit
			_uri: uri,
			_edits: [
				{
					range: range,
					newText: newText,
				},
			],
		})
	}

	insert(uri, position, newText) {
		console.log("WorkspaceEdit.insert:", uri, position, newText)
		this.replace(uri, new vscode.Range(position, position), newText)
	}

	delete(uri, range) {
		console.log("WorkspaceEdit.delete:", uri, range)
		this.replace(uri, range, "")
	}
}

vscode.Range = class Range {
	constructor(startLine, startCharacter, endLine, endCharacter) {
		if (typeof startLine === "object") {
			// Called with Position objects
			this.start = startLine
			this.end = startCharacter
		} else {
			// Called with line/character numbers
			this.start = new vscode.Position(startLine, startCharacter)
			this.end = new vscode.Position(endLine, endCharacter)
		}
	}
}

vscode.Position = class Position {
	constructor(line, character) {
		this.line = line
		this.character = character
	}
}

vscode.Selection = class Selection extends vscode.Range {
	constructor(anchorLine, anchorCharacter, activeLine, activeCharacter) {
		if (typeof anchorLine === "object") {
			// Called with Position objects
			super(anchorLine, anchorCharacter)
			this.anchor = anchorLine
			this.active = anchorCharacter
		} else {
			// Called with line/character numbers
			super(anchorLine, anchorCharacter, activeLine, activeCharacter)
			this.anchor = new vscode.Position(anchorLine, anchorCharacter)
			this.active = new vscode.Position(activeLine, activeCharacter)
		}
	}
}

// Add TextEditorRevealType enum
vscode.TextEditorRevealType = {
	Default: 0,
	InCenter: 1,
	InCenterIfOutsideViewport: 2,
	AtTop: 3,
}

// Add missing languages API
if (!vscode.languages) {
	vscode.languages = {}
}

Object.assign(vscode.languages, {
	getDiagnostics: (uri) => {
		console.log("Called vscode.languages.getDiagnostics")
		// Return empty diagnostics for standalone mode
		if (uri) {
			return []
		} else {
			// Return all diagnostics as empty array
			return []
		}
	},
	registerCodeActionsProvider: () => ({ dispose: () => {} }),
	createDiagnosticCollection: () => ({
		set: () => {},
		delete: () => {},
		clear: () => {},
		dispose: () => {},
	}),
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
