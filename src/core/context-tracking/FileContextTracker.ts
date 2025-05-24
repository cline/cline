import * as path from "path"
import * as vscode from "vscode"
import { getTaskDirectoryPath } from "../../utils/storage"
import { GlobalFileNames } from "../../shared/globalFileNames"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import { ContextProxy } from "../config/ContextProxy"
import type { FileMetadataEntry, RecordSource, TaskMetadata } from "./FileContextTrackerTypes"
import { ClineProvider } from "../webview/ClineProvider"

// This class is responsible for tracking file operations that may result in stale context.
// If a user modifies a file outside of Roo, the context may become stale and need to be updated.
// We do not want Roo to reload the context every time a file is modified, so we use this class merely
// to inform Roo that the change has occurred, and tell Roo to reload the file before making
// any changes to it. This fixes an issue with diff editing, where Roo was unable to complete a diff edit.

// FileContextTracker
//
// This class is responsible for tracking file operations.
// If the full contents of a file are passed to Roo via a tool, mention, or edit, the file is marked as active.
// If a file is modified outside of Roo, we detect and track this change to prevent stale context.
export class FileContextTracker {
	readonly taskId: string
	private providerRef: WeakRef<ClineProvider>

	// File tracking and watching
	private fileWatchers = new Map<string, vscode.FileSystemWatcher>()
	private recentlyModifiedFiles = new Set<string>()
	private recentlyEditedByRoo = new Set<string>()
	private checkpointPossibleFiles = new Set<string>()

	constructor(provider: ClineProvider, taskId: string) {
		this.providerRef = new WeakRef(provider)
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
			if (this.recentlyEditedByRoo.has(filePath)) {
				this.recentlyEditedByRoo.delete(filePath) // This was an edit by Roo, no need to inform Roo
			} else {
				this.recentlyModifiedFiles.add(filePath) // This was a user edit, we will inform Roo
				this.trackFileContext(filePath, "user_edited") // Update the task metadata with file tracking
			}
		})

		// Store the watcher so we can dispose it later
		this.fileWatchers.set(filePath, watcher)
	}

	// Tracks a file operation in metadata and sets up a watcher for the file
	// This is the main entry point for FileContextTracker and is called when a file is passed to Roo via a tool, mention, or edit.
	async trackFileContext(filePath: string, operation: RecordSource) {
		try {
			const cwd = this.getCwd()
			if (!cwd) {
				return
			}

			await this.addFileToFileContextTracker(this.taskId, filePath, operation)

			// Set up file watcher for this file
			await this.setupFileWatcher(filePath)
		} catch (error) {
			console.error("Failed to track file operation:", error)
		}
	}

	public getContextProxy(): ContextProxy | undefined {
		const provider = this.providerRef.deref()
		if (!provider) {
			console.error("ClineProvider reference is no longer valid")
			return undefined
		}
		const context = provider.contextProxy

		if (!context) {
			console.error("Context is not available")
			return undefined
		}

		return context
	}

	// Gets task metadata from storage
	async getTaskMetadata(taskId: string): Promise<TaskMetadata> {
		const globalStoragePath = this.getContextProxy()?.globalStorageUri.fsPath ?? ""
		const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
		const filePath = path.join(taskDir, GlobalFileNames.taskMetadata)
		try {
			if (await fileExistsAtPath(filePath)) {
				return JSON.parse(await fs.readFile(filePath, "utf8"))
			}
		} catch (error) {
			console.error("Failed to read task metadata:", error)
		}
		return { files_in_context: [] }
	}

	// Saves task metadata to storage
	async saveTaskMetadata(taskId: string, metadata: TaskMetadata) {
		try {
			const globalStoragePath = this.getContextProxy()!.globalStorageUri.fsPath
			const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
			const filePath = path.join(taskDir, GlobalFileNames.taskMetadata)
			await fs.writeFile(filePath, JSON.stringify(metadata, null, 2))
		} catch (error) {
			console.error("Failed to save task metadata:", error)
		}
	}

	// Adds a file to the metadata tracker
	// This handles the business logic of determining if the file is new, stale, or active.
	// It also updates the metadata with the latest read/edit dates.
	async addFileToFileContextTracker(taskId: string, filePath: string, source: RecordSource) {
		try {
			const metadata = await this.getTaskMetadata(taskId)
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
				roo_read_date: getLatestDateForField(filePath, "roo_read_date"),
				roo_edit_date: getLatestDateForField(filePath, "roo_edit_date"),
				user_edit_date: getLatestDateForField(filePath, "user_edit_date"),
			}

			switch (source) {
				// user_edited: The user has edited the file
				case "user_edited":
					newEntry.user_edit_date = now
					this.recentlyModifiedFiles.add(filePath)
					break

				// roo_edited: Roo has edited the file
				case "roo_edited":
					newEntry.roo_read_date = now
					newEntry.roo_edit_date = now
					this.checkpointPossibleFiles.add(filePath)
					this.markFileAsEditedByRoo(filePath)
					break

				// read_tool/file_mentioned: Roo has read the file via a tool or file mention
				case "read_tool":
				case "file_mentioned":
					newEntry.roo_read_date = now
					break
			}

			metadata.files_in_context.push(newEntry)
			await this.saveTaskMetadata(taskId, metadata)
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

	getAndClearCheckpointPossibleFile(): string[] {
		const files = Array.from(this.checkpointPossibleFiles)
		this.checkpointPossibleFiles.clear()
		return files
	}

	// Marks a file as edited by Roo to prevent false positives in file watchers
	markFileAsEditedByRoo(filePath: string): void {
		this.recentlyEditedByRoo.add(filePath)
	}

	// Disposes all file watchers
	dispose(): void {
		for (const watcher of this.fileWatchers.values()) {
			watcher.dispose()
		}
		this.fileWatchers.clear()
	}
}
