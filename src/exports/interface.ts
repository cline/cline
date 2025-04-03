import { EventEmitter } from "events"

import type { ProviderSettings, GlobalSettings, ClineMessage, TokenUsage, RooCodeEvents } from "./types"
export type { RooCodeSettings, ProviderSettings, GlobalSettings, ClineMessage, TokenUsage, RooCodeEvents }

import { RooCodeEventName } from "../schemas"
export type { RooCodeEventName }

type RooCodeSettings = GlobalSettings & ProviderSettings

export interface RooCodeAPI extends EventEmitter<RooCodeEvents> {
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
	 * Creates a new API configuration profile
	 * @param name The name of the profile
	 * @returns The ID of the created profile
	 */
	createProfile(name: string): Promise<string>

	/**
	 * Returns a list of all configured profile names
	 * @returns Array of profile names
	 */
	getProfiles(): string[]

	/**
	 * Changes the active API configuration profile
	 * @param name The name of the profile to activate
	 * @throws Error if the profile does not exist
	 */
	setActiveProfile(name: string): Promise<void>

	/**
	 * Returns the name of the currently active profile
	 * @returns The profile name, or undefined if no profile is active
	 */
	getActiveProfile(): string | undefined

	/**
	 * Deletes a profile by name
	 * @param name The name of the profile to delete
	 * @throws Error if the profile does not exist
	 */
	deleteProfile(name: string): Promise<void>

	/**
	 * Returns true if the API is ready to use.
	 */
	isReady(): boolean
}
