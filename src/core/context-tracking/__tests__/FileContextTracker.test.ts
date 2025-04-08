import { describe, it, beforeEach, afterEach, expect, vi } from "vitest"
import * as vscode from "vscode"
import * as path from "path"
import { FileContextTracker } from "../FileContextTracker"
import * as diskModule from "../../storage/disk"
import type { TaskMetadata, ControllerLike, FileMetadataEntry } from "../FileContextTrackerTypes"

describe("FileContextTracker", () => {
	let mockController: ControllerLike
	let mockContext: vscode.ExtensionContext
	let mockWorkspace: any
	let mockFileSystemWatcher: any
	let tracker: FileContextTracker
	let taskId: string
	let mockTaskMetadata: TaskMetadata
	let getTaskMetadataStub: any
	let saveTaskMetadataStub: any

	beforeEach(() => {
		vi.resetAllMocks()

		// Mock vscode workspace
		mockWorkspace = vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			} as vscode.WorkspaceFolder,
		])

		// Mock file system watcher
		mockFileSystemWatcher = {
			dispose: vi.fn(),
			onDidChange: vi.fn().mockReturnValue({ dispose: () => {} }),
		}

		// Use a function replacement instead of a direct stub
		vi.spyOn(vscode.workspace, "createFileSystemWatcher").mockImplementation(() => {
			return mockFileSystemWatcher as any
		})

		// Mock controller and context
		mockContext = {
			globalStorageUri: { fsPath: "/mock/storage" },
		} as unknown as vscode.ExtensionContext

		mockController = {
			context: mockContext,
		}

		// Mock disk module functions
		mockTaskMetadata = { files_in_context: [] }
		getTaskMetadataStub = vi.spyOn(diskModule, "getTaskMetadata").mockResolvedValue(mockTaskMetadata)
		saveTaskMetadataStub = vi.spyOn(diskModule, "saveTaskMetadata").mockResolvedValue()

		// Create tracker instance
		taskId = "test-task-id"
		tracker = new FileContextTracker(mockController, taskId)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should add a record when a file is read by a tool", async () => {
		const filePath = "src/test-file.ts"

		await tracker.trackFileContext(filePath, "read_tool")

		// Verify getTaskMetadata was called
		expect(getTaskMetadataStub).toHaveBeenCalledTimes(1)
		expect(getTaskMetadataStub.mock.calls[0][1]).toBe(taskId)

		// Verify saveTaskMetadata was called with the correct data
		expect(saveTaskMetadataStub).toHaveBeenCalledTimes(1)

		const savedMetadata = saveTaskMetadataStub.mock.calls[0][2]
		expect(savedMetadata.files_in_context.length).toBe(1)

		const fileEntry = savedMetadata.files_in_context[0]
		expect(fileEntry.path).toBe(filePath)
		expect(fileEntry.record_state).toBe("active")
		expect(fileEntry.record_source).toBe("read_tool")
		expect(fileEntry.cline_read_date).toBeTypeOf("number")
		expect(fileEntry.cline_edit_date).toBeNull()
	})

	it("should add a record when a file is edited by Cline", async () => {
		const filePath = "src/test-file.ts"

		await tracker.trackFileContext(filePath, "cline_edited")

		// Verify saveTaskMetadata was called with the correct data
		expect(saveTaskMetadataStub).toHaveBeenCalledTimes(1)
		const savedMetadata = saveTaskMetadataStub.mock.calls[0][2]

		// Check that we have at least one entry in files_in_context
		expect(savedMetadata.files_in_context).toBeInstanceOf(Array)
		expect(savedMetadata.files_in_context.length).toBeGreaterThan(0)

		// Find the active entry for this file
		const activeEntry = savedMetadata.files_in_context.find(
			(entry: FileMetadataEntry) => entry.path === filePath && entry.record_state === "active",
		)

		// Assert that we found an active entry
		expect(activeEntry).toBeDefined()

		// Now check the properties of the active entry
		expect(activeEntry.path).toBe(filePath)
		expect(activeEntry.record_state).toBe("active")
		expect(activeEntry.record_source).toBe("cline_edited")
		expect(activeEntry.cline_read_date).toBeTypeOf("number")
		expect(activeEntry.cline_edit_date).toBeTypeOf("number")
	})

	it("should add a record when a file is mentioned", async () => {
		const filePath = "src/test-file.ts"

		await tracker.trackFileContext(filePath, "file_mentioned")

		// Verify saveTaskMetadata was called with the correct data
		const savedMetadata = saveTaskMetadataStub.mock.calls[0][2]
		const fileEntry = savedMetadata.files_in_context[0]

		expect(fileEntry.path).toBe(filePath)
		expect(fileEntry.record_state).toBe("active")
		expect(fileEntry.record_source).toBe("file_mentioned")
		expect(fileEntry.cline_read_date).toBeTypeOf("number")
		expect(fileEntry.cline_edit_date).toBeNull()
	})

	it("should add a record when a file is edited by the user", async () => {
		const filePath = "src/test-file.ts"

		await tracker.trackFileContext(filePath, "user_edited")

		// Verify saveTaskMetadata was called with the correct data
		const savedMetadata = saveTaskMetadataStub.mock.calls[0][2]
		const fileEntry = savedMetadata.files_in_context[0]

		expect(fileEntry.path).toBe(filePath)
		expect(fileEntry.record_state).toBe("active")
		expect(fileEntry.record_source).toBe("user_edited")
		expect(fileEntry.user_edit_date).toBeTypeOf("number")

		// Verify the file was added to recentlyModifiedFiles
		const modifiedFiles = tracker.getAndClearRecentlyModifiedFiles()
		expect(modifiedFiles).toContain(filePath)
	})

	it("should mark existing entries as stale when adding a new entry for the same file", async () => {
		const filePath = "src/test-file.ts"

		// Add an initial entry
		mockTaskMetadata.files_in_context = [
			{
				path: filePath,
				record_state: "active",
				record_source: "read_tool",
				cline_read_date: Date.now() - 1000, // 1 second ago
				cline_edit_date: null,
				user_edit_date: null,
			},
		]

		// Track a new operation on the same file
		await tracker.trackFileContext(filePath, "cline_edited")

		// Verify the metadata now has two entries - one stale and one active
		const savedMetadata = saveTaskMetadataStub.mock.calls[0][2]
		expect(savedMetadata.files_in_context.length).toBe(2)

		// First entry should be marked as stale
		expect(savedMetadata.files_in_context[0].record_state).toBe("stale")

		// New entry should be active
		const newEntry = savedMetadata.files_in_context[1]
		expect(newEntry.record_state).toBe("active")
		expect(newEntry.record_source).toBe("cline_edited")
	})

	it("should setup a file watcher for tracked files", async () => {
		const filePath = "src/test-file.ts"

		// Create a spy to track if createFileSystemWatcher was called
		const createWatcherSpy = vi.spyOn(vscode.workspace, "createFileSystemWatcher")

		await tracker.trackFileContext(filePath, "read_tool")

		// Verify createFileSystemWatcher was called
		expect(createWatcherSpy).toHaveBeenCalled()

		// Verify onDidChange was called to set up the change listener
		expect(mockFileSystemWatcher.onDidChange).toHaveBeenCalled()
	})

	it("should track user edits when file watcher detects changes", async () => {
		const filePath = "src/test-file.ts"

		// First track the file to set up the watcher
		await tracker.trackFileContext(filePath, "read_tool")

		// Reset the stubs to check the next calls
		vi.mocked(getTaskMetadataStub).mockClear()
		vi.mocked(saveTaskMetadataStub).mockClear()

		// Create a spy on trackFileContext to verify it's called with the right parameters
		const trackFileContextSpy = vi.spyOn(tracker, "trackFileContext")

		// Get the callback that was registered with onDidChange
		const callback = mockFileSystemWatcher.onDidChange.mock.calls[0][0]

		// Directly call the callback to simulate a file change event
		callback(vscode.Uri.file(path.resolve("/mock/workspace", filePath)))

		// Verify trackFileContext was called with the right parameters
		expect(trackFileContextSpy).toHaveBeenCalledWith(filePath, "user_edited")

		// Verify the file was added to recentlyModifiedFiles
		const modifiedFiles = tracker.getAndClearRecentlyModifiedFiles()
		expect(modifiedFiles).toContain(filePath)
	})

	it("should not track Cline edits as user edits", async () => {
		const filePath = "src/test-file.ts"

		// First track the file to set up the watcher
		await tracker.trackFileContext(filePath, "read_tool")

		// Mark the file as edited by Cline
		tracker.markFileAsEditedByCline(filePath)

		// Reset the stubs to check the next calls
		vi.mocked(getTaskMetadataStub).mockClear()
		vi.mocked(saveTaskMetadataStub).mockClear()

		// Create a spy on trackFileContext to verify it's not called
		const trackFileContextSpy = vi.spyOn(tracker, "trackFileContext")

		// Get the callback that was registered with onDidChange
		const callback = mockFileSystemWatcher.onDidChange.mock.calls[0][0]

		// Directly call the callback to simulate a file change event
		callback(vscode.Uri.file(path.resolve("/mock/workspace", filePath)))

		// Verify trackFileContext was not called with user_edited
		expect(trackFileContextSpy).not.toHaveBeenCalledWith(filePath, "user_edited")

		// Verify the file was not added to recentlyModifiedFiles
		const modifiedFiles = tracker.getAndClearRecentlyModifiedFiles()
		expect(modifiedFiles).not.toContain(filePath)
	})

	it("should dispose file watchers when dispose is called", async () => {
		const filePath = "src/test-file.ts"

		// Track a file to set up the watcher
		await tracker.trackFileContext(filePath, "read_tool")

		// Call dispose
		tracker.dispose()

		// Verify the watcher was disposed
		expect(mockFileSystemWatcher.dispose).toHaveBeenCalled()
	})
})
