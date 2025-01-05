// @ts-nocheck
import { vi } from "vitest"

// Mock VS Code API types
interface MockTerminalExitStatus {
	code: number | undefined
	reason: number
}

interface Disposable {
	dispose(): any
}

interface CancellationToken {
	isCancellationRequested: boolean
	onCancellationRequested: Event<any>
}

interface OutputChannel {
	name: string
	append(value: string): void
	appendLine(value: string): void
	clear(): void
	show(): void
	hide(): void
	dispose(): void
}

type Event<T> = (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => Disposable

// Create proper Event Emitter implementation
class VSCodeEventEmitter<T> {
	private listeners: ((e: T) => any)[] = []

	constructor() {
		this.event = this.event.bind(this)
		this.fire = this.fire.bind(this)
		this.dispose = this.dispose.bind(this)
	}

	event(listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable {
		this.listeners.push(listener)
		const disposable = {
			dispose: () => {
				const index = this.listeners.indexOf(listener)
				if (index > -1) {
					this.listeners.splice(index, 1)
				}
			},
		}
		if (disposables) {
			disposables.push(disposable)
		}
		return disposable
	}

	fire(data: T): void {
		this.listeners.forEach((listener) => listener(data))
	}

	dispose(): void {
		this.listeners = []
	}
}

// Define a terminal interface to ensure type safety
interface Terminal {
	name: string
	processId: Promise<number>
	creationOptions: any
	_exitStatus: MockTerminalExitStatus | undefined
	state: { isInteractedWith: boolean }
	shellIntegration: any
	sendText: (text: string, addNewLine?: boolean) => void
	show: () => void
	hide: () => void
	dispose: () => void
	close: () => void
}

// Create base mock implementations
const createBaseEventEmitter = () => new VSCodeEventEmitter()

const createBaseTerminal = (options: any): Terminal => {
	const terminal: Terminal = {
		name: options?.name || "Mock Terminal",
		processId: Promise.resolve(1234),
		creationOptions: options,
		_exitStatus: undefined,
		state: { isInteractedWith: false },
		shellIntegration: undefined,
		sendText: vi.fn(),
		show: vi.fn(),
		hide: vi.fn(),
		dispose: vi.fn(),
		close: function () {
			onDidCloseTerminal.fire(terminal)
		},
	}
	return terminal
}

// Create instances of VSCodeEventEmitter for events
const onDidOpenTerminal = new VSCodeEventEmitter<Terminal>()
const onDidCloseTerminal = new VSCodeEventEmitter<Terminal>()
const onDidChangeTerminalState = new VSCodeEventEmitter<Terminal>()
const onDidChangeConfiguration = new VSCodeEventEmitter<any>()
const onDidChangeWorkspaceFolders = new VSCodeEventEmitter<any>()
const onDidChangeActiveTextEditor = new VSCodeEventEmitter<any>()

// Mock the entire vscode module
const actualVscode = vi.importActual<typeof import("vscode")>("vscode")
const vscode = {
	...actualVscode,
	EventEmitter: VSCodeEventEmitter,
	ThemeIcon: vi.fn().mockImplementation((id: string) => ({ id })),

	window: {
		...actualVscode.window,
		terminals: [] as Terminal[],
		createTerminal: vi.fn((options?: any) => {
			const terminal = createBaseTerminal(options)
			vscode.window.terminals.push(terminal)
			onDidOpenTerminal.fire(terminal)
			return terminal
		}),
		createOutputChannel: vi.fn(
			(name: string): OutputChannel => ({
				name,
				append: vi.fn(),
				appendLine: vi.fn(),
				clear: vi.fn(),
				show: vi.fn(),
				hide: vi.fn(),
				dispose: vi.fn(),
			}),
		),
		onDidOpenTerminal: onDidOpenTerminal.event,
		onDidCloseTerminal: onDidCloseTerminal.event,
		onDidChangeTerminalState: onDidChangeTerminalState.event,
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showQuickPick: vi.fn(),
		showInputBox: vi.fn(),
		createStatusBarItem: vi.fn(),
		activeTextEditor: undefined,
		onDidChangeActiveTextEditor: onDidChangeActiveTextEditor.event,
	},
	commands: {
		registerCommand: vi.fn(),
		executeCommand: vi.fn(),
		registerTextEditorCommand: vi.fn(),
		getCommands: vi.fn(),
	},
	languages: {
		registerHoverProvider: vi.fn(),
		registerCompletionItemProvider: vi.fn(),
		registerDefinitionProvider: vi.fn(),
	},
	Uri: {
		file: vi.fn((path: string) => ({
			scheme: "file",
			path,
			fsPath: path,
			with: vi.fn(),
			toString: vi.fn(),
			toJSON: vi.fn(),
		})),
		parse: vi.fn(),
	},
	Position: vi.fn().mockImplementation((line: number, character: number) => ({
		line,
		character,
		translate: vi.fn(),
		with: vi.fn(),
		isAfter: vi.fn(),
		isBefore: vi.fn(),
		isEqual: vi.fn(),
		compareTo: vi.fn(),
	})),
	Range: vi.fn().mockImplementation((startLine: number, startChar: number, endLine: number, endChar: number) => ({
		start: new vscode.Position(startLine, startChar),
		end: new vscode.Position(endLine, endChar),
		isEmpty: vi.fn(),
		isSingleLine: vi.fn(),
		contains: vi.fn(),
		intersection: vi.fn(),
		union: vi.fn(),
	})),
	TerminalExitReason: {
		Unknown: 0,
		Shutdown: 1,
		Process: 2,
		User: 3,
		Extension: 4,
	} as const,
	CancellationTokenSource: class {
		token: CancellationToken
		constructor() {
			const emitter = new VSCodeEventEmitter<void>()
			this.token = {
				isCancellationRequested: false,
				onCancellationRequested: emitter.event,
			}
		}
		cancel() {
			;(this.token as any).isCancellationRequested = true
		}
		dispose() {}
	},
}

export { vscode }
