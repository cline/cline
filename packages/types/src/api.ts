import type { EventEmitter } from "events"
import type { Socket } from "net"

import type {
	RooCodeSettings,
	ProviderSettingsEntry,
	ProviderSettings,
	ClineMessage,
	TokenUsage,
	ToolUsage,
	ToolName,
	TaskCommand,
	TaskEvent,
	IpcMessage,
} from "./index.js"
import { IpcMessageType } from "./index.js"

// TODO: Make sure this matches `RooCodeEvents` from `@roo-code/types`.
export interface RooCodeAPIEvents {
	message: [data: { taskId: string; action: "created" | "updated"; message: ClineMessage }]
	taskCreated: [taskId: string]
	taskStarted: [taskId: string]
	taskModeSwitched: [taskId: string, mode: string]
	taskPaused: [taskId: string]
	taskUnpaused: [taskId: string]
	taskAskResponded: [taskId: string]
	taskAborted: [taskId: string]
	taskSpawned: [parentTaskId: string, childTaskId: string]
	taskCompleted: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	taskTokenUsageUpdated: [taskId: string, tokenUsage: TokenUsage]
	taskToolFailed: [taskId: string, toolName: ToolName, error: string]
}

export interface RooCodeAPI extends EventEmitter<RooCodeAPIEvents> {
	/**
	 * Starts a new task with an optional initial message and images.
	 * @param task Optional initial task message.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 * @returns The ID of the new task.
	 */
	startNewTask({
		configuration,
		text,
		images,
		newTab,
	}: {
		configuration?: RooCodeSettings
		text?: string
		images?: string[]
		newTab?: boolean
	}): Promise<string>
	/**
	 * Resumes a task with the given ID.
	 * @param taskId The ID of the task to resume.
	 * @throws Error if the task is not found in the task history.
	 */
	resumeTask(taskId: string): Promise<void>
	/**
	 * Checks if a task with the given ID is in the task history.
	 * @param taskId The ID of the task to check.
	 * @returns True if the task is in the task history, false otherwise.
	 */
	isTaskInHistory(taskId: string): Promise<boolean>
	/**
	 * Returns the current task stack.
	 * @returns An array of task IDs.
	 */
	getCurrentTaskStack(): string[]
	/**
	 * Clears the current task.
	 */
	clearCurrentTask(lastMessage?: string): Promise<void>
	/**
	 * Cancels the current task.
	 */
	cancelCurrentTask(): Promise<void>
	/**
	 * Sends a message to the current task.
	 * @param message Optional message to send.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 */
	sendMessage(message?: string, images?: string[]): Promise<void>
	/**
	 * Simulates pressing the primary button in the chat interface.
	 */
	pressPrimaryButton(): Promise<void>
	/**
	 * Simulates pressing the secondary button in the chat interface.
	 */
	pressSecondaryButton(): Promise<void>
	/**
	 * Returns true if the API is ready to use.
	 */
	isReady(): boolean
	/**
	 * Returns the current configuration.
	 * @returns The current configuration.
	 */
	getConfiguration(): RooCodeSettings
	/**
	 * Sets the configuration for the current task.
	 * @param values An object containing key-value pairs to set.
	 */
	setConfiguration(values: RooCodeSettings): Promise<void>
	/**
	 * Returns a list of all configured profile names
	 * @returns Array of profile names
	 */
	getProfiles(): string[]
	/**
	 * Returns the profile entry for a given name
	 * @param name The name of the profile
	 * @returns The profile entry, or undefined if the profile does not exist
	 */
	getProfileEntry(name: string): ProviderSettingsEntry | undefined
	/**
	 * Creates a new API configuration profile
	 * @param name The name of the profile
	 * @param profile The profile to create; defaults to an empty object
	 * @param activate Whether to activate the profile after creation; defaults to true
	 * @returns The ID of the created profile
	 * @throws Error if the profile already exists
	 */
	createProfile(name: string, profile?: ProviderSettings, activate?: boolean): Promise<string>
	/**
	 * Updates an existing API configuration profile
	 * @param name The name of the profile
	 * @param profile The profile to update
	 * @param activate Whether to activate the profile after update; defaults to true
	 * @returns The ID of the updated profile
	 * @throws Error if the profile does not exist
	 */
	updateProfile(name: string, profile: ProviderSettings, activate?: boolean): Promise<string | undefined>
	/**
	 * Creates a new API configuration profile or updates an existing one
	 * @param name The name of the profile
	 * @param profile The profile to create or update; defaults to an empty object
	 * @param activate Whether to activate the profile after upsert; defaults to true
	 * @returns The ID of the upserted profile
	 */
	upsertProfile(name: string, profile: ProviderSettings, activate?: boolean): Promise<string | undefined>
	/**
	 * Deletes a profile by name
	 * @param name The name of the profile to delete
	 * @throws Error if the profile does not exist
	 */
	deleteProfile(name: string): Promise<void>
	/**
	 * Returns the name of the currently active profile
	 * @returns The profile name, or undefined if no profile is active
	 */
	getActiveProfile(): string | undefined
	/**
	 * Changes the active API configuration profile
	 * @param name The name of the profile to activate
	 * @throws Error if the profile does not exist
	 */
	setActiveProfile(name: string): Promise<string | undefined>
}

export type IpcServerEvents = {
	[IpcMessageType.Connect]: [clientId: string]
	[IpcMessageType.Disconnect]: [clientId: string]
	[IpcMessageType.TaskCommand]: [clientId: string, data: TaskCommand]
	[IpcMessageType.TaskEvent]: [relayClientId: string | undefined, data: TaskEvent]
}

export interface RooCodeIpcServer extends EventEmitter<IpcServerEvents> {
	listen(): void
	broadcast(message: IpcMessage): void
	send(client: string | Socket, message: IpcMessage): void
	get socketPath(): string
	get isListening(): boolean
}
