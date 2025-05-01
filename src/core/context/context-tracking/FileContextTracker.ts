import * as path from "path"
import * as vscode from "vscode"
import { getTaskMetadata, saveTaskMetadata } from "@core/storage/disk"
import type { FileMetadataEntry } from "./ContextTrackerTypes"

// This class is responsible for tracking file operations that may result in stale context.
// If a user modifies a file outside of Cline, the context may become stale and need to be updated.
// We do not want Cline to reload the context every time a file is modified, so we use this class merely
// to inform Cline that the change has occurred, and tell Cline to reload the file before making
// any changes to it. This fixes an issue with diff editing, where Cline was unable to complete a diff edit.
// a diff edit because the file was modified since Cline last read it.

// FileContextTracker
//
// This class is responsible for tracking file operations.
// If the full contents of a file are pass to Cline via a tool, mention, or edit, the file is marked as active.
// If a file is modified outside of Cline, we detect and track this change to prevent stale context.
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

	// Gets the current working directory or returns undefined if it cannot be determined
	private getCwd(): string | undefined {
		const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
		if (!cwd) {
			console.info("No workspace folder available - cannot determine current working directory")
		}
		return cwd
	}

	// File watchers are set up for each file that is tracked in the task metadata.
	async setupFileWatcher(filePath: string) {
		// Only setup watcher if it doesn't already exist for this file
		if (this.fileWatchers.has(filePath)) {
			return
		}

		const cwd = this.getCwd()
		if (!cwd) {
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

	// Tracks a file operation in metadata and sets up a watcher for the file
	// This is the main entry point for FileContextTracker and is called when a file is passed to Cline via a tool, mention, or edit.
	async trackFileContext(filePath: string, operation: "read_tool" | "user_edited" | "cline_edited" | "file_mentioned") {
		try {
			const cwd = this.getCwd()
			if (!cwd) {
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

	// Adds a file to the metadata tracker
	// This handles the business logic of determining if the file is new, stale, or active.
	// It also updates the metadata with the latest read/edit dates.
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

	// Returns (and then clears) the set of recently modified files
	getAndClearRecentlyModifiedFiles(): string[] {
		const files = Array.from(this.recentlyModifiedFiles)
		this.recentlyModifiedFiles.clear()
		return files
	}

	// Marks a file as edited by Cline to prevent false positives in file watchers
	markFileAsEditedByCline(filePath: string): void {
		this.recentlyEditedByCline.add(filePath)
	}

	// Disposes all file watchers
	dispose(): void {
		for (const watcher of this.fileWatchers.values()) {
			watcher.dispose()
		}
		this.fileWatchers.clear()
	}
}
