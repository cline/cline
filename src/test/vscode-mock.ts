// Mock implementation of VSCode API for unit tests
export const env = {
	machineId: "test-machine-id",
	isTelemetryEnabled: true,
	onDidChangeTelemetryEnabled: (_callback: (enabled: boolean) => void) => {
		// Return a disposable mock
		return {
			dispose: () => {},
		}
	},
	clipboard: {
		readText: () => Promise.resolve("mock clipboard content"),
		writeText: (_text: string) => Promise.resolve(),
	},
}

export const workspace = {
	getConfiguration: (section?: string) => {
		return {
			get: (key: string, defaultValue?: any) => {
				// Return default values for common configuration keys
				if (section === "cline" && key === "telemetrySetting") {
					return "enabled"
				}
				if (section === "telemetry" && key === "telemetryLevel") {
					return "all"
				}
				return defaultValue
			},
		}
	},
	workspaceFolders: [],
	textDocuments: [],
	openTextDocument: (_uri: any) =>
		Promise.resolve({
			uri: _uri,
			fileName: _uri.fsPath || _uri,
			isDirty: false,
			save: () => Promise.resolve(true),
		}),
}

// Export other commonly used VSCode API mocks as needed
export const window = {
	showErrorMessage: (_message: string) => Promise.resolve(),
	showWarningMessage: (_message: string) => Promise.resolve(),
	showInformationMessage: (_message: string) => Promise.resolve(),
	createTextEditorDecorationType: (_options: any) => ({
		key: "mock-decoration-type",
		dispose: () => {},
	}),
	createTerminal: (_options?: any) => ({
		name: _options?.name || "mock-terminal",
		processId: Promise.resolve(1234),
		creationOptions: _options || {},
		exitStatus: undefined,
		state: { isInteractedWith: false },
		shellIntegration: {
			executeCommand: (_command: string) => ({
				read: () => ({
					next: () => Promise.resolve({ value: "mock output", done: false }),
					[Symbol.asyncIterator]: function () {
						return this
					},
				}),
			}),
		},
		sendText: (_text: string) => {},
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}),
	tabGroups: {
		all: [],
	},
	visibleTextEditors: [],
	showTextDocument: (_document: any, _column?: any) =>
		Promise.resolve({
			document: _document,
			viewColumn: _column || ViewColumn.One,
			edit: (_callback: (editBuilder: any) => void) => {
				const editBuilder = {
					insert: (_position: Position, _text: string) => {},
					replace: (_location: Range | Position, _value: string) => {},
					delete: (_location: Range) => {},
				}
				_callback(editBuilder)
				return Promise.resolve(true)
			},
		}),
}

export const commands = {
	executeCommand: (_command: string, ..._args: any[]) => Promise.resolve(),
}

export const Uri = {
	file: (path: string) => ({ fsPath: path, toString: () => path }),
	parse: (uri: string) => ({ fsPath: uri, toString: () => uri }),
}

export class Range {
	start: Position
	end: Position

	constructor(startLine: number | Position, startCharacter: number | Position, endLine?: number, endCharacter?: number) {
		if (typeof startLine === "number" && typeof startCharacter === "number") {
			this.start = new Position(startLine, startCharacter)
			this.end = new Position(endLine || startLine, endCharacter || startCharacter)
		} else {
			this.start = startLine as Position
			this.end = startCharacter as Position
		}
	}

	with(start?: Position, end?: Position): Range {
		return new Range(start || this.start, end || this.end)
	}
}

export class Position {
	line: number
	character: number

	constructor(line: number, character: number) {
		this.line = line
		this.character = character
	}

	translate(lineDelta: number = 0, characterDelta: number = 0): Position {
		return new Position(this.line + lineDelta, this.character + characterDelta)
	}
}

// VSCode Language Model API mocks
export class LanguageModelTextPart {
	value: string
	constructor(value: string) {
		this.value = value
	}
}

export class LanguageModelToolCallPart {
	name: string
	toolCallId: string
	input: any
	constructor(name: string, toolCallId: string, input: any) {
		this.name = name
		this.toolCallId = toolCallId
		this.input = input
	}
}

export class LanguageModelToolResultPart {
	toolCallId: string
	content: any
	constructor(toolCallId: string, content: any) {
		this.toolCallId = toolCallId
		this.content = content
	}
}

export const LanguageModelChatMessageRole = {
	User: 1,
	Assistant: 2,
}

// Diagnostic severity levels
export const DiagnosticSeverity = {
	Error: 0,
	Warning: 1,
	Information: 2,
	Hint: 3,
}

// Theme icon mock
export class ThemeIcon {
	id: string
	constructor(id: string) {
		this.id = id
	}
}

// View column enum
export const ViewColumn = {
	One: 1,
	Two: 2,
	Three: 3,
	Active: -1,
	Beside: -2,
}

// Workspace edit and diagnostic classes
export class WorkspaceEdit {
	constructor() {}

	insert(uri: any, position: Position, value: string) {
		// Mock implementation
	}
}

export class Diagnostic {
	range: Range
	message: string
	severity: number
	source?: string

	constructor(range: Range, message: string, severity: number = DiagnosticSeverity.Error) {
		this.range = range
		this.message = message
		this.severity = severity
	}
}

// Clipboard mock
export const env_clipboard = {
	readText: () => Promise.resolve("mock clipboard content"),
	writeText: (_text: string) => Promise.resolve(),
}

// Add clipboard to env
export const env_extended = {
	...env,
	clipboard: env_clipboard,
}

export const ExtensionContextMock = {}
export const StatusBarAlignmentMock = { Left: 1, Right: 2 }
export const ViewColumnMock = { One: 1, Two: 2, Three: 3 }
