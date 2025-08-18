import { z } from "zod"

import { RooCodeEventName } from "./events.js"
import { type ClineMessage, type TokenUsage } from "./message.js"
import { type ToolUsage, type ToolName } from "./tool.js"
import type { StaticAppProperties, GitProperties, TelemetryProperties } from "./telemetry.js"

/**
 * TaskProviderLike
 */

export interface TaskProviderState {
	mode?: string
}

export interface TaskProviderLike {
	readonly cwd: string
	readonly appProperties: StaticAppProperties
	readonly gitProperties: GitProperties | undefined

	getCurrentTask(): TaskLike | undefined
	getCurrentTaskStack(): string[]
	getRecentTasks(): string[]

	createTask(text?: string, images?: string[], parentTask?: TaskLike): Promise<TaskLike>
	cancelTask(): Promise<void>
	clearTask(): Promise<void>
	resumeTask(taskId: string): void

	getState(): Promise<TaskProviderState>
	postStateToWebview(): Promise<void>
	postMessageToWebview(message: unknown): Promise<void>

	getTelemetryProperties(): Promise<TelemetryProperties>

	on<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	off<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this
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
	[RooCodeEventName.TaskInteractive]: [taskId: string]
	[RooCodeEventName.TaskResumable]: [taskId: string]
	[RooCodeEventName.TaskIdle]: [taskId: string]
}

/**
 * TaskLike
 */

export enum TaskStatus {
	Running = "running",
	Interactive = "interactive",
	Resumable = "resumable",
	Idle = "idle",
	None = "none",
}

export const taskMetadataSchema = z.object({
	task: z.string().optional(),
	images: z.array(z.string()).optional(),
})

export type TaskMetadata = z.infer<typeof taskMetadataSchema>

export interface TaskLike {
	readonly taskId: string
	readonly taskStatus: TaskStatus
	readonly taskAsk: ClineMessage | undefined
	readonly metadata: TaskMetadata

	readonly rootTask?: TaskLike

	on<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this
	off<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this

	approveAsk(options?: { text?: string; images?: string[] }): void
	denyAsk(options?: { text?: string; images?: string[] }): void
	submitUserMessage(text: string, images?: string[]): void
	abortTask(): void
}

export type TaskEvents = {
	// Task Lifecycle
	[RooCodeEventName.TaskStarted]: []
	[RooCodeEventName.TaskCompleted]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	[RooCodeEventName.TaskAborted]: []
	[RooCodeEventName.TaskFocused]: []
	[RooCodeEventName.TaskUnfocused]: []
	[RooCodeEventName.TaskActive]: [taskId: string]
	[RooCodeEventName.TaskInteractive]: [taskId: string]
	[RooCodeEventName.TaskResumable]: [taskId: string]
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
