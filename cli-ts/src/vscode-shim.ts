/**
 * VSCode namespace shim for CLI mode
 * Provides minimal stubs for VSCode types and enums used by the codebase
 */

import { printError, printInfo, printWarning } from "./utils/display"

// Re-export common types from vscode-uri for URI handling
export { URI } from "vscode-uri"

// Extension mode enum
export enum ExtensionMode {
	Production = 1,
	Development = 2,
	Test = 3,
}

// Extension kind enum
export enum ExtensionKind {
	UI = 1,
	Workspace = 2,
}

// Diagnostic severity enum
export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

// End of line enum
export enum EndOfLine {
	LF = 1,
	CRLF = 2,
}

// Position class
export class Position {
	constructor(
		public readonly line: number,
		public readonly character: number,
	) {}

	isAfter(other: Position): boolean {
		return this.line > other.line || (this.line === other.line && this.character > other.character)
	}

	isAfterOrEqual(other: Position): boolean {
		return this.line > other.line || (this.line === other.line && this.character >= other.character)
	}

	isBefore(other: Position): boolean {
		return this.line < other.line || (this.line === other.line && this.character < other.character)
	}

	isBeforeOrEqual(other: Position): boolean {
		return this.line < other.line || (this.line === other.line && this.character <= other.character)
	}

	isEqual(other: Position): boolean {
		return this.line === other.line && this.character === other.character
	}

	translate(lineDelta?: number, characterDelta?: number): Position {
		return new Position(this.line + (lineDelta || 0), this.character + (characterDelta || 0))
	}

	with(line?: number, character?: number): Position {
		return new Position(line ?? this.line, character ?? this.character)
	}

	compareTo(other: Position): number {
		if (this.line < other.line) {
			return -1
		}
		if (this.line > other.line) {
			return 1
		}
		if (this.character < other.character) {
			return -1
		}
		if (this.character > other.character) {
			return 1
		}
		return 0
	}
}

// Range class
export class Range {
	public readonly start: Position
	public readonly end: Position

	constructor(start: Position, end: Position)
	constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number)
	constructor(
		startOrStartLine: Position | number,
		endOrStartCharacter: Position | number,
		endLine?: number,
		endCharacter?: number,
	) {
		if (typeof startOrStartLine === "number") {
			this.start = new Position(startOrStartLine, endOrStartCharacter as number)
			this.end = new Position(endLine!, endCharacter!)
		} else {
			this.start = startOrStartLine
			this.end = endOrStartCharacter as Position
		}
	}

	get isEmpty(): boolean {
		return this.start.isEqual(this.end)
	}

	get isSingleLine(): boolean {
		return this.start.line === this.end.line
	}

	contains(positionOrRange: Position | Range): boolean {
		if (positionOrRange instanceof Range) {
			return this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
		}
		return positionOrRange.isAfterOrEqual(this.start) && positionOrRange.isBeforeOrEqual(this.end)
	}

	isEqual(other: Range): boolean {
		return this.start.isEqual(other.start) && this.end.isEqual(other.end)
	}

	intersection(range: Range): Range | undefined {
		const start = Position.prototype.isAfter.call(this.start, range.start) ? this.start : range.start
		const end = Position.prototype.isBefore.call(this.end, range.end) ? this.end : range.end
		if (start.isAfter(end)) {
			return undefined
		}
		return new Range(start, end)
	}

	union(other: Range): Range {
		const start = this.start.isBefore(other.start) ? this.start : other.start
		const end = this.end.isAfter(other.end) ? this.end : other.end
		return new Range(start, end)
	}

	with(start?: Position, end?: Position): Range {
		return new Range(start ?? this.start, end ?? this.end)
	}
}

// Selection class (extends Range)
export class Selection extends Range {
	public readonly anchor: Position
	public readonly active: Position

	constructor(anchor: Position, active: Position)
	constructor(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number)
	constructor(
		anchorOrAnchorLine: Position | number,
		activeOrAnchorCharacter: Position | number,
		activeLine?: number,
		activeCharacter?: number,
	) {
		let anchor: Position
		let active: Position
		if (typeof anchorOrAnchorLine === "number") {
			anchor = new Position(anchorOrAnchorLine, activeOrAnchorCharacter as number)
			active = new Position(activeLine!, activeCharacter!)
		} else {
			anchor = anchorOrAnchorLine
			active = activeOrAnchorCharacter as Position
		}
		super(anchor.isBefore(active) ? anchor : active, anchor.isBefore(active) ? active : anchor)
		this.anchor = anchor
		this.active = active
	}

	get isReversed(): boolean {
		return this.anchor.isAfter(this.active)
	}
}

// Cancellation token
export interface CancellationToken {
	isCancellationRequested: boolean
	onCancellationRequested: any
}

// Event emitter (simplified)
export class EventEmitter<T> {
	private listeners: Array<(e: T) => void> = []

	event = (listener: (e: T) => void) => {
		this.listeners.push(listener)
		return {
			dispose: () => {
				const index = this.listeners.indexOf(listener)
				if (index >= 0) {
					this.listeners.splice(index, 1)
				}
			},
		}
	}

	fire(data: T): void {
		for (const listener of this.listeners) {
			listener(data)
		}
	}

	dispose(): void {
		this.listeners = []
	}
}

// Disposable
export class Disposable {
	constructor(private callOnDispose: () => void) {}

	static from(...disposables: { dispose(): any }[]): Disposable {
		return new Disposable(() => {
			for (const d of disposables) {
				d.dispose()
			}
		})
	}

	dispose(): void {
		this.callOnDispose()
	}
}

// Minimal workspace namespace
export const workspace = {
	workspaceFolders: undefined as any[] | undefined,
	getWorkspaceFolder: (_uri: any) => undefined,
	onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
	fs: {
		readFile: async (_uri: any): Promise<Uint8Array> => new Uint8Array(),
		writeFile: async (_uri: any, _content: Uint8Array): Promise<void> => {},
		delete: async (_uri: any): Promise<void> => {},
		stat: async (_uri: any): Promise<any> => ({ type: 1, size: 0 }),
		readDirectory: async (_uri: any): Promise<any[]> => [],
		createDirectory: async (_uri: any): Promise<void> => {},
	},
}

// Minimal window namespace
export const window = {
	showInformationMessage: async (message: string) => {
		printInfo(`[INFO] ${message}`)
		return undefined
	},
	showWarningMessage: async (message: string) => {
		printWarning(`[WARN] ${message}`)
		return undefined
	},
	showErrorMessage: async (message: string) => {
		printError(`[ERROR] ${message}`)
		return undefined
	},
	createOutputChannel: (_name: string) => ({
		appendLine: (line: string) => printInfo(`[${new Date().toISOString()}] ${line}`),
		append: (text: string) => printInfo(`[${new Date().toISOString()}] ${text}`),
		clear: () => {},
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}),
	terminals: [] as any[],
	activeTerminal: undefined as any,
	createTerminal: (_options?: any) => ({
		name: "CLI Terminal",
		processId: Promise.resolve(process.pid),
		sendText: (text: string) => printInfo(`[${new Date().toISOString()}] [Terminal] ${text}`),
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}),
}

// Export types that are commonly used
export type ExtensionContext = any
export type Memento = any
export type SecretStorage = any

// biome-ignore lint/correctness/noUnusedVariables: placeholder
export type Extension<T> = any
