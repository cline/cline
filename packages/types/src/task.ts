import { RooCodeEventName } from "./events.js"
import { type ClineMessage, type BlockingAsk, type TokenUsage } from "./message.js"
import { type ToolUsage, type ToolName } from "./tool.js"

/**
 * TaskProviderLike
 */

export interface TaskProviderState {
	mode?: string
}

export interface TaskProviderLike {
	readonly cwd: string

	getCurrentCline(): TaskLike | undefined
	getCurrentTaskStack(): string[]

	initClineWithTask(text?: string, images?: string[], parentTask?: TaskLike): Promise<TaskLike>
	cancelTask(): Promise<void>
	clearTask(): Promise<void>
	postStateToWebview(): Promise<void>

	getState(): Promise<TaskProviderState>

	postMessageToWebview(message: unknown): Promise<void>

	on<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	off<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	context: {
		extension?: {
			packageJSON?: {
				version?: string
			}
		}
	}
}

export type TaskProviderEvents = {
	[RooCodeEventName.TaskCreated]: [task: TaskLike]

	// Proxied from the Task EventEmitter.
	[RooCodeEventName.TaskStarted]: [taskId: string]
	[RooCodeEventName.TaskCompleted]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	[RooCodeEventName.TaskAborted]: [taskId: string]
	[RooCodeEventName.TaskFocused]: [taskId: string]
	[RooCodeEventName.TaskUnfocused]: [taskId: string]
	[RooCodeEventName.TaskActive]: [taskId: string]
	[RooCodeEventName.TaskIdle]: [taskId: string]
}

/**
 * TaskLike
 */

export interface TaskLike {
	readonly taskId: string
	readonly rootTask?: TaskLike
	readonly blockingAsk?: BlockingAsk

	on<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this
	off<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this

	setMessageResponse(text: string, images?: string[]): void
}

export type TaskEvents = {
	// Task Lifecycle
	[RooCodeEventName.TaskStarted]: []
	[RooCodeEventName.TaskCompleted]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	[RooCodeEventName.TaskAborted]: []
	[RooCodeEventName.TaskFocused]: []
	[RooCodeEventName.TaskUnfocused]: []
	[RooCodeEventName.TaskActive]: [taskId: string]
	[RooCodeEventName.TaskIdle]: [taskId: string]

	// Subtask Lifecycle
	[RooCodeEventName.TaskPaused]: []
	[RooCodeEventName.TaskUnpaused]: []
	[RooCodeEventName.TaskSpawned]: [taskId: string]

	// Task Execution
	[RooCodeEventName.Message]: [{ action: "created" | "updated"; message: ClineMessage }]
	[RooCodeEventName.TaskModeSwitched]: [taskId: string, mode: string]
	[RooCodeEventName.TaskAskResponded]: []

	// Task Analytics
	[RooCodeEventName.TaskToolFailed]: [taskId: string, tool: ToolName, error: string]
	[RooCodeEventName.TaskTokenUsageUpdated]: [taskId: string, tokenUsage: TokenUsage]
}
