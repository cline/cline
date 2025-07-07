import * as path from "path"
import * as vscode from "vscode"
import { getTaskMetadata, saveTaskMetadata } from "@core/storage/disk"
import { getWorkspaceState, updateWorkspaceState } from "@core/storage/state"
import { getGlobalState } from "@core/storage/state"
import type { FileMetadataEntry } from "./ContextTrackerTypes"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { getCwd } from "@/utils/path"

// This class is responsible for tracking file operations that may result in stale context.
// If a user modifies a file outside of Cline, the context may become stale and need to be updated.
// We do not want Cline to reload the context every time a file is modified, so we use this class merely
// to inform Cline that the change has occurred, and tell Cline to reload the file before making
// any changes to it. This fixes an issue with diff editing, where Cline was unable to complete a diff edit.
// a diff edit because the file was modified since Cline last read it.

// FileContextTracker
/**
This class is responsible for tracking file operations.
If the full contents of a file are passed to Cline via a tool, mention, or edit, the file is marked as active.
If a file is modified outside of Cline, we detect and track this change to prevent stale context.
This is used when restoring a task (non-git "checkpoint" restore), and mid-task.
*/
export class FileContextTracker {
	private context: vscode.ExtensionContext
	readonly taskId: string

	// File tracking and watching
	private fileWatchers = new Map<string, vscode.FileSystemWatcher>()
	private recentlyModifiedFiles = new Set<string>()
	private recentlyEditedByCline = new Set<string>()

	constructor(context: vscode.ExtensionContext, taskId: string) {
		this.context = context
		this.taskId = taskId
	}

	/**
	 * File watchers are set up for each file that is tracked in the task metadata.
	 */
	async setupFileWatcher(filePath: string) {
		// Only setup watcher if it doesn't already exist for this file
		if (this.fileWatchers.has(filePath)) {
			return
		}

		const cwd = await getCwd()
		if (!cwd) {
			console.info("No workspace folder available - cannot determine current working directory")
			return
		}

		// Create a file system watcher for this specific file
		const fileUri = vscode.Uri.file(path.resolve(cwd, filePath))
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(path.dirname(fileUri.fsPath), path.basename(fileUri.fsPath)),
		)

		// Track file changes
		watcher.onDidChange(() => {
			if (this.recentlyEditedByCline.has(filePath)) {
				this.recentlyEditedByCline.delete(filePath) // This was an edit by Cline, no need to inform Cline
			} else {
				this.recentlyModifiedFiles.add(filePath) // This was a user edit, we will inform Cline
				this.trackFileContext(filePath, "user_edited") // Update the task metadata with file tracking
			}
		})

		// Store the watcher so we can dispose it later
		this.fileWatchers.set(filePath, watcher)
	}

	/**
	 * Tracks a file operation in metadata and sets up a watcher for the file
	 * This is the main entry point for FileContextTracker and is called when a file is passed to Cline via a tool, mention, or edit.
	 */
	async trackFileContext(filePath: string, operation: "read_tool" | "user_edited" | "cline_edited" | "file_mentioned") {
		try {
			const cwd = await getCwd()
			if (!cwd) {
				console.info("No workspace folder available - cannot determine current working directory")
				return
			}

			// Add file to metadata
			await this.addFileToFileContextTracker(this.context, this.taskId, filePath, operation)

			// Set up file watcher for this file
			await this.setupFileWatcher(filePath)
		} catch (error) {
			console.error("Failed to track file operation:", error)
		}
	}

	/**
	 * Adds a file to the metadata tracker
	 * This handles the business logic of determining if the file is new, stale, or active.
	 * It also updates the metadata with the latest read/edit dates.
	 */
	async addFileToFileContextTracker(
		context: vscode.ExtensionContext,
		taskId: string,
		filePath: string,
		source: FileMetadataEntry["record_source"],
	) {
		try {
			const metadata = await getTaskMetadata(context, taskId)
			const now = Date.now()

			// Mark existing entries for this file as stale
			metadata.files_in_context.forEach((entry) => {
				if (entry.path === filePath && entry.record_state === "active") {
					entry.record_state = "stale"
				}
			})

			// Helper to get the latest date for a specific field and file
			const getLatestDateForField = (path: string, field: keyof FileMetadataEntry): number | null => {
				const relevantEntries = metadata.files_in_context
					.filter((entry) => entry.path === path && entry[field])
					.sort((a, b) => (b[field] as number) - (a[field] as number))

				return relevantEntries.length > 0 ? (relevantEntries[0][field] as number) : null
			}

			let newEntry: FileMetadataEntry = {
				path: filePath,
				record_state: "active",
				record_source: source,
				cline_read_date: getLatestDateForField(filePath, "cline_read_date"),
				cline_edit_date: getLatestDateForField(filePath, "cline_edit_date"),
				user_edit_date: getLatestDateForField(filePath, "user_edit_date"),
			}

			switch (source) {
				// user_edited: The user has edited the file
				case "user_edited":
					newEntry.user_edit_date = now
					this.recentlyModifiedFiles.add(filePath)
					break

				// cline_edited: Cline has edited the file
				case "cline_edited":
					newEntry.cline_read_date = now
					newEntry.cline_edit_date = now
					break

				// read_tool/file_mentioned: Cline has read the file via a tool or file mention
				case "read_tool":
				case "file_mentioned":
					newEntry.cline_read_date = now
					break
			}

			metadata.files_in_context.push(newEntry)
			await saveTaskMetadata(context, taskId, metadata)
		} catch (error) {
			console.error("Failed to add file to metadata:", error)
		}
	}

	/**
	 * Returns (and then clears) the set of recently modified files
	 */
	getAndClearRecentlyModifiedFiles(): string[] {
		const files = Array.from(this.recentlyModifiedFiles)
		this.recentlyModifiedFiles.clear()
		return files
	}

	/**
	 * Marks a file as edited by Cline to prevent false positives in file watchers
	 */
	markFileAsEditedByCline(filePath: string): void {
		this.recentlyEditedByCline.add(filePath)
	}

	/**
	 * Disposes all file watchers
	 */
	dispose(): void {
		for (const watcher of this.fileWatchers.values()) {
			watcher.dispose()
		}
		this.fileWatchers.clear()
	}

	/**
	 * Detects files that were edited by Cline or users after a specific message timestamp
	 * This is used when restoring checkpoints to warn about potential file content mismatches
	 */
	async detectFilesEditedAfterMessage(messageTs: number, deletedMessages: ClineMessage[]): Promise<string[]> {
		const editedFiles: string[] = []

		try {
			// Check task metadata for files that were edited by Cline or users after the message timestamp
			const taskMetadata = await getTaskMetadata(this.context, this.taskId)

			if (taskMetadata?.files_in_context) {
				for (const fileEntry of taskMetadata.files_in_context) {
					const clineEditedAfter = fileEntry.cline_edit_date && fileEntry.cline_edit_date > messageTs
					const userEditedAfter = fileEntry.user_edit_date && fileEntry.user_edit_date > messageTs

					if (clineEditedAfter || userEditedAfter) {
						editedFiles.push(fileEntry.path)
					}
				}
			}
		} catch (error) {
			console.error("Error checking file context metadata:", error)
		}

		// Also check deleted task messages for file operations
		for (const message of deletedMessages) {
			if (message.say === "tool" && message.text) {
				try {
					const toolData = JSON.parse(message.text)
					if ((toolData.tool === "editedExistingFile" || toolData.tool === "newFileCreated") && toolData.path) {
						if (!editedFiles.includes(toolData.path)) {
							editedFiles.push(toolData.path)
						}
					}
				} catch (error) {
					console.error("Error checking task messages:", error)
				}
			}
		}
		return [...new Set(editedFiles)]
	}

	/**
	 * Stores pending file context warning in workspace state so it persists across task reinitialization
	 */
	async storePendingFileContextWarning(files: string[]): Promise<void> {
		try {
			const key = `pendingFileContextWarning_${this.taskId}`
			// NOTE: Using 'as any' because dynamic keys like pendingFileContextWarning_${taskId}
			// are legitimate workspace state keys but don't fit the strict LocalStateKey type system
			await updateWorkspaceState(this.context, key as any, files)
		} catch (error) {
			console.error("Error storing pending file context warning:", error)
		}
	}

	/**
	 * Retrieves pending file context warning from workspace state (without clearing it)
	 */
	async retrievePendingFileContextWarning(): Promise<string[] | undefined> {
		try {
			const key = `pendingFileContextWarning_${this.taskId}`
			const files = (await getWorkspaceState(this.context, key as any)) as string[]
			return files
		} catch (error) {
			console.error("Error retrieving pending file context warning:", error)
		}
		return undefined
	}

	/**
	 * Retrieves and clears pending file context warning from workspace state
	 */
	async retrieveAndClearPendingFileContextWarning(): Promise<string[] | undefined> {
		try {
			const files = await this.retrievePendingFileContextWarning()
			if (files) {
				await updateWorkspaceState(this.context, `pendingFileContextWarning_${this.taskId}` as any, undefined)
				return files
			}
		} catch (error) {
			console.error("Error retrieving pending file context warning:", error)
		}
		return undefined
	}

	/**
	 * Static method to clean up orphaned pending file context warnings at startup
	 * This removes warnings for tasks that may no longer exist
	 */
	static async cleanupOrphanedWarnings(context: vscode.ExtensionContext): Promise<void> {
		const startTime = Date.now()
		try {
			const taskHistory = ((await getGlobalState(context, "taskHistory")) as Array<{ id: string }>) || []
			const existingTaskIds = new Set(taskHistory.map((task) => task.id))
			const allStateKeys = context.workspaceState.keys()
			const pendingWarningKeys = allStateKeys.filter((key) => key.startsWith("pendingFileContextWarning_"))

			const orphanedPendingContextTasks: string[] = []
			for (const key of pendingWarningKeys) {
				const taskId = key.replace("pendingFileContextWarning_", "")
				if (!existingTaskIds.has(taskId)) {
					orphanedPendingContextTasks.push(key)
				}
			}

			if (orphanedPendingContextTasks.length > 0) {
				for (const key of orphanedPendingContextTasks) {
					await updateWorkspaceState(context, key as any, undefined)
				}
			}

			const duration = Date.now() - startTime
			console.log(
				`FileContextTracker: Processed ${existingTaskIds.size} tasks, found ${pendingWarningKeys.length} pending warnings, ${orphanedPendingContextTasks.length} orphaned, deleted ${orphanedPendingContextTasks.length}, took ${duration}ms`,
			)
		} catch (error) {
			console.error("Error cleaning up orphaned file context warnings:", error)
		}
	}
}
