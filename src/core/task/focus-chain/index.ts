import { FocusChainSettings } from "@shared/FocusChainSettings"
import * as chokidar from "chokidar"
import * as fs from "fs/promises"
import { telemetryService } from "@/services/telemetry"
import { ClineSay } from "../../../shared/ExtensionMessage"
import { Mode } from "../../../shared/storage/types"
import { writeFile } from "../../../utils/fs"
import { ensureTaskDirectoryExists } from "../../storage/disk"
import { StateManager } from "../../storage/StateManager"
import { TaskState } from "../TaskState"
import {
	createFocusChainMarkdownContent,
	extractFocusChainItemsFromText,
	extractFocusChainListFromText,
	getFocusChainFilePath,
} from "./file-utils"
import { FocusChainPrompts } from "./prompts"
import { parseFocusChainListCounts } from "./utils"

export interface FocusChainDependencies {
	taskId: string
	taskState: TaskState
	mode: Mode
	stateManager: StateManager
	postStateToWebview: () => Promise<void>
	say: (type: ClineSay, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>
	focusChainSettings: FocusChainSettings
}

export class FocusChainManager {
	private taskId: string
	private taskState: TaskState
	private stateManager: StateManager
	private postStateToWebview: () => Promise<void>
	private say: (
		type: ClineSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
	) => Promise<number | undefined>
	private focusChainFileWatcher?: chokidar.FSWatcher
	private hasTrackedFirstProgress = false
	private focusChainSettings: FocusChainSettings
	private fileUpdateDebounceTimer?: NodeJS.Timeout

	constructor(dependencies: FocusChainDependencies) {
		this.taskId = dependencies.taskId
		this.taskState = dependencies.taskState
		this.stateManager = dependencies.stateManager
		this.postStateToWebview = dependencies.postStateToWebview
		this.say = dependencies.say
		this.focusChainSettings = dependencies.focusChainSettings
	}

	/**
	 * Sets up a file watcher to monitor changes to the focus chain list markdown file.
	 * Automatically updates the UI when the file is created, modified, or deleted by external editors.
	 * @requires this.taskId, this.context to be initialized
	 * @returns Promise<void> - Resolves when watcher is set up, logs errors if setup fails
	 */
	public async setupFocusChainFileWatcher() {
		try {
			const taskDir = await ensureTaskDirectoryExists(this.taskId)
			const focusChainFilePath = getFocusChainFilePath(taskDir, this.taskId)

			// Initialize chokidar watcher
			this.focusChainFileWatcher = chokidar.watch(focusChainFilePath, {
				persistent: true,
				ignoreInitial: true,
				awaitWriteFinish: {
					stabilityThreshold: 300,
					pollInterval: 100,
				},
			})

			// Handle file changes
			this.focusChainFileWatcher
				.on("add", async () => {
					await this.updateFCListFromMarkdownFileAndNotifyUI()
				})
				.on("change", async () => {
					await this.updateFCListFromMarkdownFileAndNotifyUI()
				})
				.on("unlink", async () => {
					this.taskState.currentFocusChainChecklist = null
					await this.postStateToWebview()
				})
				.on("error", (error) => {
					console.error(`[Task ${this.taskId}] Failed to watch focus chain file:`, error)
				})

			console.log(`[Task ${this.taskId}] Todo file watcher initialized`)
		} catch (error) {
			console.error(`[Task ${this.taskId}] Failed to setup todo file watcher:`, error)
		}
	}

	/**
	 * Reads the current focus chain list from the markdown file and updates the UI with any changes.
	 * Uses debouncing (300ms) to prevent excessive updates and only notifies the webview when content actually changes.
	 * @requires File watcher to be active and markdown file to exist
	 * @returns Promise<void> - Updates taskState.currentFocusChainChecklist and calls postStateToWebview()
	 */
	private async updateFCListFromMarkdownFileAndNotifyUI() {
		if (this.fileUpdateDebounceTimer) {
			clearTimeout(this.fileUpdateDebounceTimer)
		}

		// Debounce file watcher to prevent false positives
		this.fileUpdateDebounceTimer = setTimeout(async () => {
			try {
				const markdownTodoList = await this.readFocusChainFromDisk()
				if (markdownTodoList) {
					const previousList = this.taskState.currentFocusChainChecklist

					// Only update if the content actually changed
					if (previousList !== markdownTodoList) {
						this.taskState.currentFocusChainChecklist = markdownTodoList
						this.taskState.todoListWasUpdatedByUser = true

						await this.postStateToWebview()
						telemetryService.captureFocusChainListWritten(this.taskId)
					} else {
						console.log(
							`[Task ${this.taskId}] Focus Chain List: File watcher triggered but content unchanged, skipping update`,
						)
					}
				}
			} catch (error) {
				console.error(`[Task ${this.taskId}] Error updating focuss chain list from markdown file:`, error)
			}
		}, 300)
	}

	/**
	 * Generates contextual instructions for focus chain list creation and management based on current task state.
	 * Returns formatted markdown instructions that guide the AI on when and how to update progress tracking.
	 * @requires this.taskState with current focus chain list state and API request counts
	 * @returns string - Formatted markdown instructions for focus chain list management, varies by context
	 */
	public generateFocusChainInstructions(): string {
		// If list exists already exists, we need to remind it to update rather than demand initialization
		if (this.taskState.currentFocusChainChecklist) {
			// Parse the current list for counts/stats
			const { totalItems, completedItems } = parseFocusChainListCounts(this.taskState.currentFocusChainChecklist)
			const percentComplete = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0

			const introUpdateRequired =
				"# TODO LIST UPDATE REQUIRED - You MUST include the task_progress parameter in your NEXT tool call."
			const listCurrentProgress = `**Current Progress: ${completedItems}/${totalItems} items completed (${percentComplete}%)**`
			const userHasUpdatedList =
				"**CRITICAL INFORMATION:** The user has modified this todo list - review ALL changes carefully"

			// If user has updated the list, inform the model (and provide latest copy)
			if (this.taskState.todoListWasUpdatedByUser) {
				return `\n\n
				${introUpdateRequired}\n
				${listCurrentProgress}\n
				\n
				${this.taskState.currentFocusChainChecklist}\n
				${userHasUpdatedList}\n
				${FocusChainPrompts.reminder}\n
			`

				// If there are no user changes, proceed with reminders based on list progress
			} else {
				let progressBasedMessageStub = ""
				// If there are items on the list, but none have been completed yet, remind the model to update the list when appropriate
				if (completedItems === 0 && totalItems > 0) {
					progressBasedMessageStub =
						"\n\n**Note:** No items are marked complete yet. As you work through the task, remember to mark items as complete when finished."
				} else if (percentComplete >= 25 && percentComplete < 50) {
					progressBasedMessageStub = `\n\n**Note:** ${percentComplete}% of items are complete.`
				} else if (percentComplete >= 50 && percentComplete < 75) {
					progressBasedMessageStub = `\n\n**Note:** ${percentComplete}% of items are complete. Proceed with the task.`
				} else if (percentComplete >= 75) {
					progressBasedMessageStub = `\n\n**Note:** ${percentComplete}% of items are complete! Focus on finishing the remaining items.`
				}
				// Every item on the list has been completed. Hooray!
				else if (completedItems === totalItems && totalItems > 0) {
					progressBasedMessageStub = FocusChainPrompts.completed
						.replace("{{totalItems}}", totalItems.toString())
						.replace("{{currentFocusChainChecklist}}", this.taskState.currentFocusChainChecklist)
				}

				// Return with progress-based stub
				return `\n
				${introUpdateRequired}\n
				${listCurrentProgress}\n
				${this.taskState.currentFocusChainChecklist}\n
				\n
				${FocusChainPrompts.reminder}\n
				${progressBasedMessageStub}\n
				`
			}
		}
		// When switching from Plan to Act, request that a new list be generated
		else if (this.taskState.didRespondToPlanAskBySwitchingMode) {
			return `${FocusChainPrompts.initial}`
		}

		// When in plan mode, lists are optional. TODO - May want to improve this soft prompt approach in a future version
		else if (this.stateManager.getGlobalSettingsKey("mode") === "plan") {
			return FocusChainPrompts.planModeReminder
		} else {
			// Check if we're early in the task
			const isEarlyInTask = this.taskState.apiRequestCount < 10
			if (isEarlyInTask) {
				return FocusChainPrompts.recommended
			} else {
				return FocusChainPrompts.apiRequestCount.replace("{{apiRequestCount}}", this.taskState.apiRequestCount.toString())
			}
		}
	}

	/**
	 * Reads the focus chain list from the task's markdown file on disk and extracts the checklist content.
	 * Returns the raw focus chain list string if found, or null if the file doesn't exist or contains no valid todos.
	 * @requires this.taskId and this.context to locate the task directory
	 * @returns Promise<string | null> - focus chain list content as string, or null if file missing/invalid
	 * @throws Returns null on file read errors (file not found, permission issues)
	 */
	private async readFocusChainFromDisk(): Promise<string | null> {
		try {
			const taskDir = await ensureTaskDirectoryExists(this.taskId)
			const todoFilePath = getFocusChainFilePath(taskDir, this.taskId)
			const markdownContent = await fs.readFile(todoFilePath, "utf8")
			const todoList = extractFocusChainListFromText(markdownContent)

			if (todoList) {
				const _todoLines = extractFocusChainItemsFromText(markdownContent)
				return todoList
			}

			return null
		} catch (error) {
			// File doesn't exist or can't be read, return null
			console.log(`[Task ${this.taskId}] focus chain list: Could not load from markdown file: ${error}`)
			return null
		}
	}

	/**
	 * Writes the provided focus chain list to the task's markdown file on disk with proper formatting.
	 * Creates the full markdown document structure and triggers file watchers to update the UI.
	 * @param todoList - Raw focus chain list string with markdown checklist items
	 * @requires this.taskId and this.context for file path generation
	 * @returns Promise<void> - Resolves when file is written successfully
	 * @throws Error if file write fails (disk full, permissions, etc.)
	 */
	private async writeFocusChainToDisk(todoList: string): Promise<void> {
		try {
			const taskDir = await ensureTaskDirectoryExists(this.taskId)
			const todoFilePath = getFocusChainFilePath(taskDir, this.taskId)
			const fileContent = createFocusChainMarkdownContent(this.taskId, todoList)
			await writeFile(todoFilePath, fileContent, "utf8")
		} catch (error) {
			console.error(`[Task ${this.taskId}] focus chain list: FILE WRITE FAILED - Error:`, error)
			throw error
		}
	}

	/**
	 * Processes focus chain list updates from the AI model's task_progress parameter and persists them to disk.
	 * Handles telemetry tracking for progress updates and falls back to reading existing files if no update provided.
	 * Also manages the apiRequestsSinceLastTodoUpdate counter and includes comprehensive error handling.
	 * @param taskProgress - Optional focus chain list string from AI model's task_progress parameter
	 * @requires this.taskState, this.say method, and telemetryService to be available
	 * @returns Promise<void> - Updates taskState.currentFocusChainChecklist and sends UI messages
	 */
	public async updateFCListFromToolResponse(taskProgress: string | undefined) {
		try {
			// Reset the counter if task_progress was provided
			if (taskProgress && taskProgress.trim()) {
				this.taskState.apiRequestsSinceLastTodoUpdate = 0
			}

			// If model provides task_progress update, write it to the markdown file
			if (taskProgress && taskProgress.trim()) {
				const previousList = this.taskState.currentFocusChainChecklist
				this.taskState.currentFocusChainChecklist = taskProgress.trim()
				console.debug(
					`[Task ${this.taskId}] focus chain list: LLM provided focus chain list update via task_progress parameter. Length ${previousList?.length || 0} > ${this.taskState.currentFocusChainChecklist.length}`,
				)

				// Parse focus chain list counts for telemetry
				const { totalItems, completedItems } = parseFocusChainListCounts(taskProgress.trim())

				// Track first progress creation
				if (!this.hasTrackedFirstProgress && totalItems > 0) {
					telemetryService.captureFocusChainProgressFirst(this.taskId, totalItems)
					this.hasTrackedFirstProgress = true
				}
				// Track progress updates (only if not the first, and has items)
				else if (this.hasTrackedFirstProgress && totalItems > 0) {
					telemetryService.captureFocusChainProgressUpdate(this.taskId, totalItems, completedItems)
				}

				// Write the model's update to the markdown file
				try {
					await this.writeFocusChainToDisk(taskProgress.trim())

					// Send the task_progress message to the UI immediately
					await this.say("task_progress", taskProgress.trim())
				} catch (error) {
					console.error(`[Task ${this.taskId}] focus chain list: Failed to write to markdown file:`, error)
					// Fall back to creating a task_progress message directly if file write fails
					await this.say("task_progress", taskProgress.trim())
					console.log(`[Task ${this.taskId}] focus chain list: Sent fallback task_progress message to UI`)
				}
			} else {
				// No model update provided, check if markdown file exists and load it
				const markdownTodoList = await this.readFocusChainFromDisk()
				if (markdownTodoList) {
					const _previousList = this.taskState.currentFocusChainChecklist
					this.taskState.currentFocusChainChecklist = markdownTodoList

					// Create a task_progress message to display the focus chain list in the UI
					await this.say("task_progress", markdownTodoList)
				} else {
					console.debug(`[Task ${this.taskId}] focus chain list: No valid task progress to update with`)
				}
			}
		} catch (error) {
			console.error(`[Task ${this.taskId}] focus chain list: Error in updateFCListFromToolResponse:`, error)
		}
	}

	/**
	 * Evaluates multiple conditions to determine if focus chain list instructions should be included in the AI prompt.
	 * Returns true when in plan mode, after mode switches, when user edits exist, or at reminder intervals.
	 * @requires this.mode, this.taskState, and this.focusChainSettings to be initialized
	 * @returns boolean - True if instructions should be included in AI prompt, false otherwise
	 */
	public shouldIncludeFocusChainInstructions(): boolean {
		// Always include when in Plan mode
		const inPlanMode = this.stateManager.getGlobalSettingsKey("mode") === "plan"
		// Always include when switching from Plan > Act
		const justSwitchedFromPlanMode = this.taskState.didRespondToPlanAskBySwitchingMode
		// Always include when user had edited the list manually
		const userUpdatedList = this.taskState.todoListWasUpdatedByUser
		// Include when reaching the reminder interval, configured by settings
		const reachedReminderInterval =
			this.taskState.apiRequestsSinceLastTodoUpdate >= this.focusChainSettings.remindClineInterval
		// Include on first API request or if list does not exist
		const isFirstApiRequest = this.taskState.apiRequestCount === 1 && !this.taskState.currentFocusChainChecklist
		// Include if no list has been created and multiple requests have completed
		const hasNoTodoListAfterMultipleRequests =
			!this.taskState.currentFocusChainChecklist && this.taskState.apiRequestCount >= 2

		const shouldInclude =
			reachedReminderInterval ||
			justSwitchedFromPlanMode ||
			userUpdatedList ||
			inPlanMode ||
			isFirstApiRequest ||
			hasNoTodoListAfterMultipleRequests

		return shouldInclude
	}

	/**
	 * Analyzes the current focus chain list for incomplete items when a task is marked as complete.
	 * Captures telemetry data about unfinished progress items to help improve the focus chain system.
	 * @param modelId The model ID being used (for telemetry)
	 * @param provider The API provider being used (for telemetry)
	 * @requires this.focusChainSettings.enabled and this.taskState.currentFocusChainChecklist to exist
	 * @returns void - Sends telemetry data if incomplete items found, no return value
	 */
	public checkIncompleteProgressOnCompletion(modelId: string, provider: string) {
		if (this.focusChainSettings.enabled && this.taskState.currentFocusChainChecklist) {
			const { totalItems, completedItems } = parseFocusChainListCounts(this.taskState.currentFocusChainChecklist)

			// Only track if there are items and not all are marked as completed
			if (totalItems > 0 && completedItems < totalItems) {
				const incompleteItems = totalItems - completedItems
				telemetryService.captureFocusChainIncompleteOnCompletion(
					this.taskId,
					totalItems,
					completedItems,
					incompleteItems,
					modelId,
					provider,
				)
			}
		}
	}

	/**
	 * Performs cleanup operations when the focus chain manager is no longer needed.
	 * Cancels active file watchers and clears any pending debounce timers to prevent memory leaks.
	 * @requires No parameters needed
	 * @returns void - Cleans up timers and watchers, no return value
	 */
	public dispose() {
		if (this.fileUpdateDebounceTimer) {
			clearTimeout(this.fileUpdateDebounceTimer)
			this.fileUpdateDebounceTimer = undefined
		}

		if (this.focusChainFileWatcher) {
			this.focusChainFileWatcher.close()
			this.focusChainFileWatcher = undefined
		}
	}
}
