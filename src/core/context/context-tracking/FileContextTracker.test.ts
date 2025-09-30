import * as diskModule from "@core/storage/disk"
import { expect } from "chai"
import chokidar from "chokidar"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as path from "path"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { Controller } from "@/core/controller"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import type { FileMetadataEntry, TaskMetadata } from "./ContextTrackerTypes"
import { FileContextTracker } from "./FileContextTracker"

describe("FileContextTracker", () => {
	const filePath = "src/test-file.ts"
	const taskId = "test-task-id"

	let sandbox: sinon.SinonSandbox
	let _mockWorkspace: sinon.SinonStub
	let mockFileSystemWatcher: any
	let chokidarWatchStub: sinon.SinonStub
	let tracker: FileContextTracker
	let mockTaskMetadata: TaskMetadata
	let getTaskMetadataStub: sinon.SinonStub
	let saveTaskMetadataStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Mock vscode workspace
		_mockWorkspace = sandbox.stub(vscode.workspace, "workspaceFolders").value([
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			} as vscode.WorkspaceFolder,
		])

		// Mock chokidar file watcher
		mockFileSystemWatcher = {
			close: sandbox.stub().resolves(),
			on: sandbox.stub(),
		}
		// Return the watcher itself for chaining
		mockFileSystemWatcher.on.returns(mockFileSystemWatcher)

		// Stub chokidar.watch to return our mock watcher
		chokidarWatchStub = sandbox.stub(chokidar, "watch").returns(mockFileSystemWatcher as any)

		// Mock disk module functions
		mockTaskMetadata = { files_in_context: [], model_usage: [] }
		getTaskMetadataStub = sandbox.stub(diskModule, "getTaskMetadata").resolves(mockTaskMetadata)
		saveTaskMetadataStub = sandbox.stub(diskModule, "saveTaskMetadata").resolves()

		setVscodeHostProviderMock()

		// Create tracker instance
		tracker = new FileContextTracker({} as Controller, taskId)
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should add a record when a file is read by a tool", async () => {
		await tracker.trackFileContext(filePath, "read_tool")

		// Verify getTaskMetadata was called
		expect(getTaskMetadataStub.calledOnce).to.be.true
		expect(getTaskMetadataStub.firstCall.args[0]).to.equal(taskId)

		// Verify saveTaskMetadata was called with the correct data
		expect(saveTaskMetadataStub.calledOnce).to.be.true

		const savedMetadata = saveTaskMetadataStub.firstCall.args[1]
		expect(savedMetadata.files_in_context.length).to.equal(1)

		const fileEntry = savedMetadata.files_in_context[0]
		expect(fileEntry.path).to.equal(filePath)
		expect(fileEntry.record_state).to.equal("active")
		expect(fileEntry.record_source).to.equal("read_tool")
		expect(fileEntry.cline_read_date).to.be.a("number")
		expect(fileEntry.cline_edit_date).to.be.null
	})

	it("should add a record when a file is edited by Cline", async () => {
		await tracker.trackFileContext(filePath, "cline_edited")

		// Verify saveTaskMetadata was called with the correct data
		expect(saveTaskMetadataStub.calledOnce).to.be.true
		const savedMetadata = saveTaskMetadataStub.firstCall.args[1]

		// Check that we have at least one entry in files_in_context
		expect(savedMetadata.files_in_context).to.be.an("array").that.is.not.empty

		// Find the active entry for this file
		const activeEntry = savedMetadata.files_in_context.find(
			(entry: FileMetadataEntry) => entry.path === filePath && entry.record_state === "active",
		)

		// Assert that we found an active entry
		expect(activeEntry).to.exist

		// Now check the properties of the active entry
		expect(activeEntry.path).to.equal(filePath)
		expect(activeEntry.record_state).to.equal("active")
		expect(activeEntry.record_source).to.equal("cline_edited")
		expect(activeEntry.cline_read_date).to.be.a("number")
		expect(activeEntry.cline_edit_date).to.be.a("number")
	})

	it("should add a record when a file is mentioned", async () => {
		await tracker.trackFileContext(filePath, "file_mentioned")

		// Verify saveTaskMetadata was called with the correct data
		const savedMetadata = saveTaskMetadataStub.firstCall.args[1]
		const fileEntry = savedMetadata.files_in_context[0]

		expect(fileEntry.path).to.equal(filePath)
		expect(fileEntry.record_state).to.equal("active")
		expect(fileEntry.record_source).to.equal("file_mentioned")
		expect(fileEntry.cline_read_date).to.be.a("number")
		expect(fileEntry.cline_edit_date).to.be.null
	})

	it("should add a record when a file is edited by the user", async () => {
		await tracker.trackFileContext(filePath, "user_edited")

		// Verify saveTaskMetadata was called with the correct data
		const savedMetadata = saveTaskMetadataStub.firstCall.args[1]
		const fileEntry = savedMetadata.files_in_context[0]

		expect(fileEntry.path).to.equal(filePath)
		expect(fileEntry.record_state).to.equal("active")
		expect(fileEntry.record_source).to.equal("user_edited")
		expect(fileEntry.user_edit_date).to.be.a("number")

		// Verify the file was added to recentlyModifiedFiles
		const modifiedFiles = tracker.getAndClearRecentlyModifiedFiles()
		expect(modifiedFiles).to.include(filePath)
	})

	it("should mark existing entries as stale when adding a new entry for the same file", async () => {
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
		const savedMetadata = saveTaskMetadataStub.firstCall.args[1]
		expect(savedMetadata.files_in_context.length).to.equal(2)

		// First entry should be marked as stale
		expect(savedMetadata.files_in_context[0].record_state).to.equal("stale")

		// New entry should be active
		const newEntry = savedMetadata.files_in_context[1]
		expect(newEntry.record_state).to.equal("active")
		expect(newEntry.record_source).to.equal("cline_edited")
	})

	it("should setup a file watcher for tracked files", async () => {
		await tracker.trackFileContext(filePath, "read_tool")

		// Verify chokidar.watch was called
		expect(chokidarWatchStub.called).to.be.true

		// Verify change listener was set up
		expect(mockFileSystemWatcher.on.called).to.be.true
	})

	it("should track user edits when file watcher detects changes", async () => {
		// First track the file to set up the watcher
		await tracker.trackFileContext(filePath, "read_tool")

		// Reset the stubs to check the next calls
		getTaskMetadataStub.resetHistory()
		saveTaskMetadataStub.resetHistory()

		// Create a spy on trackFileContext to verify it's called with the right parameters
		const trackFileContextSpy = sandbox.spy(tracker, "trackFileContext")

		// Get the callback that was registered with chokidar "change" event
		const callback = mockFileSystemWatcher.on.firstCall.args[1]

		// Directly call the callback to simulate a file change event
		callback(vscode.Uri.file(path.resolve("/mock/workspace", filePath)))

		// Verify trackFileContext was called with the right parameters
		expect(trackFileContextSpy.calledWith(filePath, "user_edited")).to.be.true

		// Verify the file was added to recentlyModifiedFiles
		const modifiedFiles = tracker.getAndClearRecentlyModifiedFiles()
		expect(modifiedFiles).to.include(filePath)
	})

	it("should not track Cline edits as user edits", async () => {
		// First track the file to set up the watcher
		await tracker.trackFileContext(filePath, "read_tool")

		// Mark the file as edited by Cline
		tracker.markFileAsEditedByCline(filePath)

		// Reset the stubs to check the next calls
		getTaskMetadataStub.resetHistory()
		saveTaskMetadataStub.resetHistory()

		// Create a spy on trackFileContext to verify it's not called
		const trackFileContextSpy = sandbox.spy(tracker, "trackFileContext")

		// Get the callback that was registered with chokidar "change" event
		const callback = mockFileSystemWatcher.on.firstCall.args[1]

		// Directly call the callback to simulate a file change event
		callback(vscode.Uri.file(path.resolve("/mock/workspace", filePath)))

		// Verify trackFileContext was not called with user_edited
		expect(trackFileContextSpy.calledWith(filePath, "user_edited")).to.be.false

		// Verify the file was not added to recentlyModifiedFiles
		const modifiedFiles = tracker.getAndClearRecentlyModifiedFiles()
		expect(modifiedFiles).to.not.include(filePath)
	})

	it("should dispose file watchers when dispose is called", async () => {
		// Track a file to set up the watcher
		await tracker.trackFileContext(filePath, "read_tool")

		// Call dispose
		await tracker.dispose()

		// Verify the watcher was closed
		expect(mockFileSystemWatcher.close.called).to.be.true
	})
})
