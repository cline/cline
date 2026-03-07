/**
 * VSCode namespace shim for CLI mode
 * Provides minimal stubs for VSCode types and enums used by the codebase
 */

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import pino, { type Logger } from "pino"
import { printError, printInfo, printWarning } from "./utils/display"
import { CLINE_CLI_DIR } from "./utils/path"

export { URI } from "vscode-uri"
export { ClineFileStorage } from "@/shared/storage"

export const CLI_LOG_FILE = path.join(CLINE_CLI_DIR.log, "cline-cli.1.log")

/**
 * Safely read and parse a JSON file, returning a default value on failure
 */
export function readJson<T = any>(filePath: string, defaultValue: T = {} as T): T {
	try {
		if (existsSync(filePath)) {
			return JSON.parse(readFileSync(filePath, "utf8"))
		}
	} catch {
		// Return default if file doesn't exist or is invalid
	}
	return defaultValue
}

/**
 * Mock environment variable collection for non-VSCode environments
 */
export class EnvironmentVariableCollection {
	private variables = new Map<string, { value: string; type: string }>()
	persistent = true
	description = "CLI Environment Variables"

	entries() {
		return this.variables.entries()
	}

	replace(variable: string, value: string) {
		this.variables.set(variable, { value, type: "replace" })
	}

	append(variable: string, value: string) {
		this.variables.set(variable, { value, type: "append" })
	}

	prepend(variable: string, value: string) {
		this.variables.set(variable, { value, type: "prepend" })
	}

	get(variable: string) {
		return this.variables.get(variable)
	}

	forEach(callback: (variable: string, mutator: { value: string; type: string }, collection: this) => void) {
		this.variables.forEach((mutator, variable) => callback(variable, mutator, this))
	}

	delete(variable: string) {
		return this.variables.delete(variable)
	}

	clear() {
		this.variables.clear()
	}

	getScoped(_scope: unknown) {
		return this
	}
}

// ============================================================================
// VSCode enums
// ============================================================================

export enum ExtensionMode {
	Production = 1,
	Development = 2,
	Test = 3,
}

export enum ExtensionKind {
	UI = 1,
	Workspace = 2,
}

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

export enum EndOfLine {
	LF = 1,
	CRLF = 2,
}

const outputChannelLoggers = new Map<string, Logger>()

function getOutputChannelLogger(channelName: string): Logger {
	let logger = outputChannelLoggers.get(channelName)
	if (!logger) {
		const transport = pino.transport({
			target: "pino-roll",
			options: {
				name: channelName,
				file: CLI_LOG_FILE.replace(".1", ""),
				mkdir: true,
				frequency: "daily",
				limit: { count: 5 },
			},
		})
		logger = pino({ timestamp: pino.stdTimeFunctions.isoTime }, transport)
		outputChannelLoggers.set(channelName, logger)
	}
	return logger
}

export class Position {
	constructor(
		public readonly line: number,
		public readonly character: number,
	) {}

	compareTo(other: Position): number {
		return this.line - other.line || this.character - other.character
	}

	isAfter(other: Position): boolean {
		return this.compareTo(other) > 0
	}

	isAfterOrEqual(other: Position): boolean {
		return this.compareTo(other) >= 0
	}

	isBefore(other: Position): boolean {
		return this.compareTo(other) < 0
	}

	isBeforeOrEqual(other: Position): boolean {
		return this.compareTo(other) <= 0
	}

	isEqual(other: Position): boolean {
		return this.compareTo(other) === 0
	}

	translate(lineDelta = 0, characterDelta = 0): Position {
		return new Position(this.line + lineDelta, this.character + characterDelta)
	}

	with(line?: number, character?: number): Position {
		return new Position(line ?? this.line, character ?? this.character)
	}
}

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
		const start = this.start.isAfter(range.start) ? this.start : range.start
		const end = this.end.isBefore(range.end) ? this.end : range.end
		return start.isAfter(end) ? undefined : new Range(start, end)
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
		const anchor =
			typeof anchorOrAnchorLine === "number"
				? new Position(anchorOrAnchorLine, activeOrAnchorCharacter as number)
				: anchorOrAnchorLine
		const active =
			typeof anchorOrAnchorLine === "number"
				? new Position(activeLine!, activeCharacter!)
				: (activeOrAnchorCharacter as Position)
		const isForward = anchor.isBefore(active)
		super(isForward ? anchor : active, isForward ? active : anchor)
		this.anchor = anchor
		this.active = active
	}

	get isReversed(): boolean {
		return this.anchor.isAfter(this.active)
	}
}

export interface CancellationToken {
	isCancellationRequested: boolean
	onCancellationRequested: any
}

export class EventEmitter<T> {
	private listeners: Array<(e: T) => void> = []

	event = (listener: (e: T) => void) => {
		this.listeners.push(listener)
		return {
			dispose: () => {
				const idx = this.listeners.indexOf(listener)
				if (idx >= 0) this.listeners.splice(idx, 1)
			},
		}
	}

	fire(data: T): void {
		this.listeners.forEach((listener) => listener(data))
	}

	dispose(): void {
		this.listeners.length = 0
	}
}

export class Disposable {
	constructor(private callOnDispose: () => void) {}

	static from(...disposables: { dispose(): any }[]): Disposable {
		return new Disposable(() => disposables.forEach((d) => d.dispose()))
	}

	dispose(): void {
		this.callOnDispose()
	}
}

const noop = () => {}
const noopAsync = async () => {}
const noopDisposable = { dispose: noop }

export const workspace = {
	workspaceFolders: undefined as any[] | undefined,
	getWorkspaceFolder: (_uri: any) => undefined,
	onDidChangeWorkspaceFolders: () => noopDisposable,
	fs: {
		readFile: async (_uri: any): Promise<Uint8Array> => new Uint8Array(),
		writeFile: noopAsync,
		delete: noopAsync,
		stat: async (_uri: any) => ({ type: 1, size: 0 }),
		readDirectory: async (_uri: any): Promise<any[]> => [],
		createDirectory: noopAsync,
	},
}

export const window = {
	showInformationMessage: async (message: string) => {
		printInfo(`[INFO] ${message}`)
	},
	showWarningMessage: async (message: string) => {
		printWarning(`[WARN] ${message}`)
	},
	showErrorMessage: async (message: string) => {
		printError(`[ERROR] ${message}`)
	},
	createOutputChannel: (name: string) => {
		const logger = getOutputChannelLogger(name)
		const log = (text: string) => logger.info({ channel: name }, text)
		return { appendLine: log, append: log, clear: noop, show: noop, hide: noop, dispose: noop }
	},
	terminals: [] as any[],
	activeTerminal: undefined as any,
	createTerminal: (_options?: any) => ({
		name: "CLI Terminal",
		processId: Promise.resolve(process.pid),
		sendText: (text: string) => printInfo(`[${new Date().toISOString()}] [Terminal] ${text}`),
		show: noop,
		hide: noop,
		dispose: noop,
	}),
}

export type ExtensionContext = any
export type Memento = any
export type SecretStorage = any
// biome-ignore lint/correctness/noUnusedVariables: placeholder
export type Extension<T> = any

// ============================================================================
// Shutdown event for graceful cleanup
// ============================================================================

/**
 * Event emitter for app shutdown notification.
 * Components can listen to this to clean up UI before process exit.
 */
export const shutdownEvent = new EventEmitter<void>()
