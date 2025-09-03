import { z } from "zod"

import { RooCodeEventName } from "./events.js"
import type { RooCodeSettings } from "./global-settings.js"
import type { ClineMessage, QueuedMessage, TokenUsage } from "./message.js"
import type { ToolUsage, ToolName } from "./tool.js"
import type { StaticAppProperties, GitProperties, TelemetryProperties } from "./telemetry.js"
import type { TodoItem } from "./todo.js"

/**
 * TaskProviderLike
 */

export interface TaskProviderLike {
	// Tasks
	getCurrentTask(): TaskLike | undefined
	getRecentTasks(): string[]
	createTask(
		text?: string,
		images?: string[],
		parentTask?: TaskLike,
		options?: CreateTaskOptions,
		configuration?: RooCodeSettings,
	): Promise<TaskLike>
	cancelTask(): Promise<void>
	clearTask(): Promise<void>
	resumeTask(taskId: string): void

	// Modes
	getModes(): Promise<{ slug: string; name: string }[]>
	getMode(): Promise<string>
	setMode(mode: string): Promise<void>

	// Provider Profiles
	getProviderProfiles(): Promise<{ name: string; provider?: string }[]>
	getProviderProfile(): Promise<string>
	setProviderProfile(providerProfile: string): Promise<void>

	// Telemetry
	readonly appProperties: StaticAppProperties
	readonly gitProperties: GitProperties | undefined
	getTelemetryProperties(): Promise<TelemetryProperties>
	readonly cwd: string

	// Event Emitter
	on<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	off<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	// @TODO: Find a better way to do this.
	postStateToWebview(): Promise<void>
}

export type TaskProviderEvents = {
	[RooCodeEventName.TaskCreated]: [task: TaskLike]
	[RooCodeEventName.TaskStarted]: [taskId: string]
	[RooCodeEventName.TaskCompleted]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	[RooCodeEventName.TaskAborted]: [taskId: string]
	[RooCodeEventName.TaskFocused]: [taskId: string]
	[RooCodeEventName.TaskUnfocused]: [taskId: string]
	[RooCodeEventName.TaskActive]: [taskId: string]
	[RooCodeEventName.TaskInteractive]: [taskId: string]
	[RooCodeEventName.TaskResumable]: [taskId: string]
	[RooCodeEventName.TaskIdle]: [taskId: string]

	[RooCodeEventName.TaskPaused]: [taskId: string]
	[RooCodeEventName.TaskUnpaused]: [taskId: string]
	[RooCodeEventName.TaskSpawned]: [taskId: string]

	[RooCodeEventName.TaskUserMessage]: [taskId: string]

	[RooCodeEventName.TaskTokenUsageUpdated]: [taskId: string, tokenUsage: TokenUsage]

	[RooCodeEventName.ModeChanged]: [mode: string]
	[RooCodeEventName.ProviderProfileChanged]: [config: { name: string; provider?: string }]
}

/**
 * TaskLike
 */

export interface CreateTaskOptions {
	enableDiff?: boolean
	enableCheckpoints?: boolean
	fuzzyMatchThreshold?: number
	consecutiveMistakeLimit?: number
	experiments?: Record<string, boolean>
	initialTodos?: TodoItem[]
}

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
	readonly rootTaskId?: string
	readonly parentTaskId?: string
	readonly childTaskId?: string
	readonly metadata: TaskMetadata
	readonly taskStatus: TaskStatus
	readonly taskAsk: ClineMessage | undefined
	readonly queuedMessages: QueuedMessage[]
	readonly tokenUsage: TokenUsage | undefined

	on<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this
	off<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this

	approveAsk(options?: { text?: string; images?: string[] }): void
	denyAsk(options?: { text?: string; images?: string[] }): void
	submitUserMessage(text: string, images?: string[], mode?: string, providerProfile?: string): Promise<void>
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
	[RooCodeEventName.TaskPaused]: [taskId: string]
	[RooCodeEventName.TaskUnpaused]: [taskId: string]
	[RooCodeEventName.TaskSpawned]: [taskId: string]

	// Task Execution
	[RooCodeEventName.Message]: [{ action: "created" | "updated"; message: ClineMessage }]
	[RooCodeEventName.TaskModeSwitched]: [taskId: string, mode: string]
	[RooCodeEventName.TaskAskResponded]: []
	[RooCodeEventName.TaskUserMessage]: [taskId: string]

	// Task Analytics
	[RooCodeEventName.TaskToolFailed]: [taskId: string, tool: ToolName, error: string]
	[RooCodeEventName.TaskTokenUsageUpdated]: [taskId: string, tokenUsage: TokenUsage]
}
