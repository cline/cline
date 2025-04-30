import EventEmitter from "events"

export type RooTerminalProvider = "vscode" | "execa"

export interface RooTerminal {
	provider: RooTerminalProvider
	id: number
	busy: boolean
	running: boolean
	taskId?: string
	process?: RooTerminalProcess
	getCurrentWorkingDirectory(): string
	isClosed: () => boolean
	runCommand: (command: string, callbacks: RooTerminalCallbacks) => RooTerminalProcessResultPromise
	setActiveStream(stream: AsyncIterable<string> | undefined, pid?: number): void
	shellExecutionComplete(exitDetails: ExitCodeDetails): void
	getProcessesWithOutput(): RooTerminalProcess[]
	getUnretrievedOutput(): string
	getLastCommand(): string
	cleanCompletedProcessQueue(): void
}

export interface RooTerminalCallbacks {
	onLine: (line: string, process: RooTerminalProcess) => void
	onCompleted: (output: string | undefined, process: RooTerminalProcess) => void
	onShellExecutionStarted: (pid: number | undefined, process: RooTerminalProcess) => void
	onShellExecutionComplete: (details: ExitCodeDetails, process: RooTerminalProcess) => void
	onNoShellIntegration?: (message: string, process: RooTerminalProcess) => void
}

export interface RooTerminalProcess extends EventEmitter<RooTerminalProcessEvents> {
	command: string
	isHot: boolean
	run: (command: string) => Promise<void>
	continue: () => void
	abort: () => void
	hasUnretrievedOutput: () => boolean
	getUnretrievedOutput: () => string
}

export type RooTerminalProcessResultPromise = RooTerminalProcess & Promise<void>

export interface RooTerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: [output?: string]
	stream_available: [stream: AsyncIterable<string>]
	shell_execution_started: [pid: number | undefined]
	shell_execution_complete: [exitDetails: ExitCodeDetails]
	error: [error: Error]
	no_shell_integration: [message: string]
}

export interface ExitCodeDetails {
	exitCode: number | undefined
	signal?: number | undefined
	signalName?: string
	coreDumpPossible?: boolean
}
