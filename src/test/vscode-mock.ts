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
	onDidChangeConfiguration: (_callback: (e: any) => void) => {
		// Return a disposable mock
		return {
			dispose: () => {},
		}
	},
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
}

export const commands = {
	executeCommand: (_command: string, ..._args: any[]) => Promise.resolve(),
}

export const Uri = {
	file: (path: string) => ({ fsPath: path, toString: () => path }),
	parse: (uri: string) => ({ fsPath: uri, toString: () => uri }),
	joinPath: (base: any, ...pathSegments: string[]) => ({
		fsPath: `${base.fsPath}/${pathSegments.join("/")}`,
		toString: () => `${base.fsPath}/${pathSegments.join("/")}`,
	}),
}

export const ExtensionMode = {
	Development: 1,
	Test: 2,
	Production: 3,
}

export const ExtensionContextMock = {}
export const StatusBarAlignmentMock = { Left: 1, Right: 2 }
export const ViewColumnMock = { One: 1, Two: 2, Three: 3 }

// Mock Range and Position classes
export class Range {
	start: Position
	end: Position

	constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number)
	constructor(start: Position, end: Position)
	constructor(
		startOrStartLine: Position | number,
		endOrStartCharacter: Position | number,
		endLine?: number,
		endCharacter?: number,
	) {
		if (typeof startOrStartLine === "number" && typeof endOrStartCharacter === "number") {
			this.start = new Position(startOrStartLine, endOrStartCharacter)
			this.end = new Position(endLine!, endCharacter!)
		} else {
			this.start = startOrStartLine as Position
			this.end = endOrStartCharacter as Position
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

	translate(lineDelta?: number, characterDelta?: number): Position {
		return new Position(this.line + (lineDelta || 0), this.character + (characterDelta || 0))
	}
}
