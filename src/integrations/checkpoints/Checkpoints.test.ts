import { expect } from "chai"
import { after, afterEach, beforeEach, describe, it } from "mocha"
import fs from "fs/promises"
import path from "path"
import os from "os"
import * as vscode from "vscode"
import simpleGit from "simple-git"
import CheckpointTracker from "./CheckpointTracker"
import { HistoryItem } from "../../shared/HistoryItem"

describe("Checkpoints", () => {
	let tempDir: string
	let globalStoragePath: string
	let taskId: string
	let tracker: CheckpointTracker
	let testFilePath: string
	let originalDescriptor: PropertyDescriptor | undefined
	let originalGetConfiguration: typeof vscode.workspace.getConfiguration
	let originalFindFiles: typeof vscode.workspace.findFiles

	beforeEach(async () => {
		// Create temp directory structure
		tempDir = path.join(os.tmpdir(), `checkpoint-test-${Date.now()}`)
		await fs.mkdir(tempDir, { recursive: true })

		// Create storage path outside of working directory to avoid submodule issues
		globalStoragePath = path.join(os.tmpdir(), `storage-${Date.now()}`)
		await fs.mkdir(globalStoragePath, { recursive: true })

		taskId = "test-task-1"

		// Create test file in a subdirectory
		const testDir = path.join(tempDir, "src")
		await fs.mkdir(testDir, { recursive: true })
		testFilePath = path.join(testDir, "test.txt")

		// Create .gitignore to prevent git from treating directories as submodules
		await fs.writeFile(path.join(tempDir, ".gitignore"), "storage/\n")

		// Mock VS Code workspace and findFiles
		const mockWorkspaceFolders = [
			{
				uri: { fsPath: tempDir },
				name: "test",
				index: 0,
			},
		]

		originalDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "workspaceFolders")
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			get: () => mockWorkspaceFolders,
		})

		// Mock findFiles to return no nested git repos
		originalFindFiles = vscode.workspace.findFiles
		vscode.workspace.findFiles = async () => []

		// Mock VS Code configuration
		originalGetConfiguration = vscode.workspace.getConfiguration
		vscode.workspace.getConfiguration = () =>
			({
				get: (key: string) => (key === "enableCheckpoints" ? true : undefined),
			}) as any

		// Create tracker instance
		tracker = (await CheckpointTracker.create(taskId, globalStoragePath)) as CheckpointTracker
	})

	afterEach(() => {
		// Restore VS Code mocks
		if (originalDescriptor) {
			Object.defineProperty(vscode.workspace, "workspaceFolders", originalDescriptor)
		}
		vscode.workspace.getConfiguration = originalGetConfiguration
		vscode.workspace.findFiles = originalFindFiles
	})

	after(async () => {
		// Clean up temp directories
		await fs.rm(tempDir, { recursive: true, force: true })
		await fs.rm(globalStoragePath, { recursive: true, force: true })
	})

	describe("Creation", () => {
		it("should create a new checkpoint tracker", async () => {
			const tracker = await CheckpointTracker.create(taskId, globalStoragePath)
			expect(tracker).to.not.be.undefined
			expect(tracker).to.be.instanceOf(CheckpointTracker)

			// Verify shadow git config
			const configWorkTree = await tracker?.getShadowGitConfigWorkTree()
			expect(configWorkTree).to.not.be.undefined
		})

		it("should throw error when globalStoragePath is missing", async () => {
			try {
				await CheckpointTracker.create(taskId, undefined)
				expect.fail("Expected error was not thrown")
			} catch (error: any) {
				expect(error.message).to.equal("Global storage path is required to create a checkpoint tracker")
			}
		})
	})

	describe("Commit Operations", () => {
		it("should create commit with single file changes", async () => {
			// Create initial file
			await fs.writeFile(testFilePath, "initial content")

			// Create first commit
			const firstCommit = await tracker.commit()
			expect(firstCommit).to.be.a("string").and.not.empty

			// Modify file
			await fs.writeFile(testFilePath, "modified content")

			// Create second commit
			const secondCommit = await tracker.commit()
			expect(secondCommit).to.be.a("string").and.not.empty
			expect(secondCommit).to.not.equal(firstCommit)

			// Verify commits are different
			const diffSet = await tracker.getDiffSet(firstCommit, secondCommit)
			expect(diffSet).to.have.lengthOf(1)
			expect(diffSet[0].before).to.equal("initial content")
			expect(diffSet[0].after).to.equal("modified content")
		})

		it("should create commit with multiple file changes", async () => {
			// Create initial files with newlines
			const testFile2Path = path.join(tempDir, "src", "test2.txt")
			await fs.writeFile(testFilePath, "file1 initial\n")
			await fs.writeFile(testFile2Path, "file2 initial\n")

			// Create first commit
			const firstCommit = await tracker.commit()
			expect(firstCommit).to.be.a("string").and.not.empty

			// Modify both files with newlines
			await fs.writeFile(testFilePath, "file1 modified\n")
			await fs.writeFile(testFile2Path, "file2 modified\n")

			// Create second commit
			const secondCommit = await tracker.commit()
			expect(secondCommit).to.be.a("string").and.not.empty
			expect(secondCommit).to.not.equal(firstCommit)

			// Get diff between commits
			const diffSet = await tracker.getDiffSet(firstCommit, secondCommit)
			expect(diffSet).to.have.lengthOf(2)

			// Sort diffSet by path for consistent ordering
			const sortedDiffs = diffSet.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

			// Verify file paths
			expect(sortedDiffs[0].relativePath).to.equal("src/test.txt")
			expect(sortedDiffs[1].relativePath).to.equal("src/test2.txt")

			// Verify file contents
			expect(sortedDiffs[0].before).to.equal("file1 initial\nfile2 initial\n")
			expect(sortedDiffs[0].after).to.equal("file1 modified\nfile2 modified\n")
		})

		it("should create commit when files are deleted", async () => {
			// Create and commit initial file
			await fs.writeFile(testFilePath, "initial content")
			const firstCommit = await tracker.commit()
			expect(firstCommit).to.be.a("string").and.not.empty

			// Delete file
			await fs.unlink(testFilePath)

			// Create second commit
			const secondCommit = await tracker.commit()
			expect(secondCommit).to.be.a("string").and.not.empty
			expect(secondCommit).to.not.equal(firstCommit)

			// Verify file deletion was committed
			const diffSet = await tracker.getDiffSet(firstCommit, secondCommit)
			expect(diffSet).to.have.lengthOf(1)
			expect(diffSet[0].before).to.equal("initial content")
			expect(diffSet[0].after).to.equal("")
		})

		it("should create empty commit when no changes", async () => {
			// Create and commit initial file
			await fs.writeFile(testFilePath, "test content")
			const firstCommit = await tracker.commit()
			expect(firstCommit).to.be.a("string").and.not.empty

			// Create commit without changes
			const secondCommit = await tracker.commit()
			expect(secondCommit).to.be.a("string").and.not.empty
			expect(secondCommit).to.not.equal(firstCommit)

			// Verify no changes between commits
			const diffSet = await tracker.getDiffSet(firstCommit, secondCommit)
			expect(diffSet).to.have.lengthOf(0)
		})

		it("should handle files in nested directories", async () => {
			// Create nested directory structure
			const nestedDir = path.join(tempDir, "src", "deep", "nested")
			await fs.mkdir(nestedDir, { recursive: true })
			const nestedFilePath = path.join(nestedDir, "nested.txt")

			// Create and commit file in nested directory
			await fs.writeFile(nestedFilePath, "nested content")
			const firstCommit = await tracker.commit()
			expect(firstCommit).to.be.a("string").and.not.empty

			// Modify nested file
			await fs.writeFile(nestedFilePath, "modified nested content")

			// Create second commit
			const secondCommit = await tracker.commit()
			expect(secondCommit).to.be.a("string").and.not.empty

			// Verify changes were committed
			const diffSet = await tracker.getDiffSet(firstCommit, secondCommit)
			expect(diffSet).to.have.lengthOf(1)
			expect(diffSet[0].relativePath).to.equal("src/deep/nested/nested.txt")
			expect(diffSet[0].before).to.equal("nested content")
			expect(diffSet[0].after).to.equal("modified nested content")
		})
	})

	describe("Reset Operations", () => {
		it("should reset working directory to a previous checkpoint state", async () => {
			// Create and commit initial state
			await fs.writeFile(testFilePath, "initial content")
			const firstCommit = await tracker.commit()
			expect(firstCommit).to.not.be.undefined

			// Create and commit changes
			await fs.writeFile(testFilePath, "modified content")
			const secondCommit = await tracker.commit()
			expect(secondCommit).to.not.be.undefined

			// Make more changes without committing
			await fs.writeFile(testFilePath, "uncommitted changes")

			// Reset to first commit
			await tracker.resetHead(firstCommit!)

			// Verify file content matches initial state
			const resetContent = await fs.readFile(testFilePath, "utf8")
			expect(resetContent).to.equal("initial content")
		})

		it("should handle resetting with multiple files", async () => {
			// Create and commit initial state with multiple files
			const testFile2Path = path.join(tempDir, "src", "test2.txt")
			await fs.writeFile(testFilePath, "file1 initial")
			await fs.writeFile(testFile2Path, "file2 initial")
			const firstCommit = await tracker.commit()
			expect(firstCommit).to.not.be.undefined

			// Modify both files and commit
			await fs.writeFile(testFilePath, "file1 modified")
			await fs.writeFile(testFile2Path, "file2 modified")
			const secondCommit = await tracker.commit()
			expect(secondCommit).to.not.be.undefined

			// Make more changes
			await fs.writeFile(testFilePath, "file1 uncommitted")
			await fs.writeFile(testFile2Path, "file2 uncommitted")

			// Reset to first commit
			await tracker.resetHead(firstCommit!)

			// Verify both files match initial state
			const file1Content = await fs.readFile(testFilePath, "utf8")
			const file2Content = await fs.readFile(testFile2Path, "utf8")
			expect(file1Content).to.equal("file1 initial")
			expect(file2Content).to.equal("file2 initial")
		})

		it("should handle resetting when files are deleted", async () => {
			// Create and commit initial state
			await fs.writeFile(testFilePath, "initial content")
			const firstCommit = await tracker.commit()
			expect(firstCommit).to.not.be.undefined

			// Delete file and commit
			await fs.unlink(testFilePath)
			const secondCommit = await tracker.commit()
			expect(secondCommit).to.not.be.undefined

			// Reset to first commit
			await tracker.resetHead(firstCommit!)

			// Verify file is restored with original content
			const resetContent = await fs.readFile(testFilePath, "utf8")
			expect(resetContent).to.equal("initial content")
		})
	})

	describe("Diff Operations", () => {
		it("should detect file changes between commits", async () => {
			// Create initial file
			await fs.writeFile(testFilePath, "initial content")

			// Create first checkpoint
			const firstCommit = await tracker.commit()
			expect(firstCommit).to.not.be.undefined

			// Modify file
			await fs.writeFile(testFilePath, "modified content")

			// Create second checkpoint
			const secondCommit = await tracker.commit()
			expect(secondCommit).to.not.be.undefined

			// Get diff between commits
			const diffSet = await tracker.getDiffSet(firstCommit, secondCommit)

			// Verify diff results
			expect(diffSet).to.have.lengthOf(1)
			expect(diffSet[0].relativePath).to.equal("src/test.txt")
			expect(diffSet[0].before).to.equal("initial content")
			expect(diffSet[0].after).to.equal("modified content")
		})

		it("should detect changes between commit and working directory", async () => {
			// Create initial file
			await fs.writeFile(testFilePath, "initial content")

			// Create checkpoint
			const commit = await tracker.commit()
			expect(commit).to.not.be.undefined

			// Modify file without committing
			await fs.writeFile(testFilePath, "working directory changes")

			// Get diff between commit and working directory
			const diffSet = await tracker.getDiffSet(commit)

			// Verify diff results
			expect(diffSet).to.have.lengthOf(1)
			expect(diffSet[0].relativePath).to.equal("src/test.txt")
			expect(diffSet[0].before).to.equal("initial content")
			expect(diffSet[0].after).to.equal("working directory changes")
		})
	})

	describe("Task Switching", () => {
		let taskId1: string
		let taskId2: string
		let tracker1: CheckpointTracker
		let tracker2: CheckpointTracker

		beforeEach(async () => {
			taskId1 = "task-1"
			taskId2 = "task-2"
			tracker1 = (await CheckpointTracker.create(taskId1, globalStoragePath)) as CheckpointTracker
		})

		it("should maintain separate history for each task", async () => {
			// Create and commit file in first task
			await fs.writeFile(testFilePath, "task1 initial")
			const task1Commit1 = await tracker1.commit()
			expect(task1Commit1).to.be.a("string").and.not.empty

			// Modify and commit again in first task
			await fs.writeFile(testFilePath, "task1 modified")
			const task1Commit2 = await tracker1.commit()
			expect(task1Commit2).to.be.a("string").and.not.empty

			// Create second task tracker
			tracker2 = (await CheckpointTracker.create(taskId2, globalStoragePath)) as CheckpointTracker

			// Create and commit file in second task
			await fs.writeFile(testFilePath, "task2 initial")
			const task2Commit1 = await tracker2.commit()
			expect(task2Commit1).to.be.a("string").and.not.empty

			// Create another commit to establish history
			await fs.writeFile(testFilePath, "task2 modified")
			const task2Commit2 = await tracker2.commit()
			expect(task2Commit2).to.be.a("string").and.not.empty

			// Verify second task's history
			const task2Diff = await tracker2.getDiffSet(task2Commit1, task2Commit2)
			expect(task2Diff).to.have.lengthOf(1)
			expect(task2Diff[0].before).to.equal("task2 initial")
			expect(task2Diff[0].after).to.equal("task2 modified")

			// Switch back to first task by creating new tracker
			const tracker1Again = (await CheckpointTracker.create(taskId1, globalStoragePath)) as CheckpointTracker

			// Verify first task's history is preserved
			const task1Diff = await tracker1Again.getDiffSet(task1Commit1, task1Commit2)
			expect(task1Diff[0].before).to.equal("task1 initial")
			expect(task1Diff[0].after).to.equal("task1 modified")

			// Reset first task to initial state
			if (!task1Commit1) throw new Error("Failed to create initial commit")
			await tracker1Again.resetHead(task1Commit1)
			const resetContent = await fs.readFile(testFilePath, "utf8")
			expect(resetContent).to.equal("task1 initial")
		})

		it("should handle task deletion and recreation", async () => {
			// Create and commit file in first task
			await fs.writeFile(testFilePath, "task1 content")
			const task1Commit = await tracker1.commit()
			expect(task1Commit).to.be.a("string").and.not.empty

			// Create second task
			tracker2 = (await CheckpointTracker.create(taskId2, globalStoragePath)) as CheckpointTracker
			await fs.writeFile(testFilePath, "task2 content")
			const task2Commit = await tracker2.commit()
			expect(task2Commit).to.be.a("string").and.not.empty

			// Delete second task's checkpoints
			const historyItem: HistoryItem = {
				id: `test-${Date.now()}`,
				ts: Date.now(),
				task: taskId2,
				shadowGitConfigWorkTree: tempDir,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}
			await CheckpointTracker.deleteCheckpoints(taskId2, historyItem, globalStoragePath)

			// Recreate second task
			const tracker2Again = (await CheckpointTracker.create(taskId2, globalStoragePath)) as CheckpointTracker

			// Create new commit in recreated task
			await fs.writeFile(testFilePath, "task2 new content")
			const newCommit = await tracker2Again.commit()
			expect(newCommit).to.be.a("string").and.not.empty

			// Switch back to first task and verify its history is intact
			const tracker1Again = (await CheckpointTracker.create(taskId1, globalStoragePath)) as CheckpointTracker
			if (!task1Commit) throw new Error("Failed to create initial commit")
			await tracker1Again.resetHead(task1Commit)
			const resetContent = await fs.readFile(testFilePath, "utf8")
			expect(resetContent).to.equal("task1 content")
		})
	})

	describe("Disabled State", () => {
		beforeEach(() => {
			// Mock VS Code configuration to disable checkpoints
			vscode.workspace.getConfiguration = () =>
				({
					get: (key: string) => (key === "enableCheckpoints" ? false : undefined),
				}) as any
		})

		it("should return undefined when creating tracker", async () => {
			const tracker = await CheckpointTracker.create(taskId, globalStoragePath)
			expect(tracker).to.be.undefined
		})

		it("should allow re-enabling checkpoints", async () => {
			// First verify disabled state
			const disabledTracker = await CheckpointTracker.create(taskId, globalStoragePath)
			expect(disabledTracker).to.be.undefined

			// Mock configuration to enable checkpoints
			vscode.workspace.getConfiguration = () =>
				({
					get: (key: string) => (key === "enableCheckpoints" ? true : undefined),
				}) as any

			// Verify tracker can be created when enabled
			const enabledTracker = await CheckpointTracker.create(taskId, globalStoragePath)
			expect(enabledTracker).to.not.be.undefined
			expect(enabledTracker).to.be.instanceOf(CheckpointTracker)

			// Verify operations work
			await fs.writeFile(testFilePath, "test content")
			const commit = await enabledTracker?.commit()
			expect(commit).to.be.a("string").and.not.empty
		})

		it("should prevent operations when disabled mid-session", async () => {
			// Start with checkpoints enabled
			vscode.workspace.getConfiguration = () =>
				({
					get: (key: string) => (key === "enableCheckpoints" ? true : undefined),
				}) as any

			// Create tracker and initial commit
			const tracker = await CheckpointTracker.create(taskId, globalStoragePath)
			expect(tracker).to.not.be.undefined

			await fs.writeFile(testFilePath, "initial content")
			const firstCommit = await tracker?.commit()
			expect(firstCommit).to.be.a("string").and.not.empty

			// Disable checkpoints
			vscode.workspace.getConfiguration = () =>
				({
					get: (key: string) => (key === "enableCheckpoints" ? false : undefined),
				}) as any

			// Verify new tracker cannot be created
			const disabledTracker = await CheckpointTracker.create(taskId, globalStoragePath)
			expect(disabledTracker).to.be.undefined

			// Verify existing tracker still works
			// This is expected behavior since the tracker was created when enabled
			await fs.writeFile(testFilePath, "modified content")
			const secondCommit = await tracker?.commit()
			expect(secondCommit).to.be.a("string").and.not.empty
			expect(secondCommit).to.not.equal(firstCommit)

			// Verify diffs still work on existing tracker
			const diffSet = await tracker?.getDiffSet(firstCommit, secondCommit)
			expect(diffSet).to.have.lengthOf(1)
			expect(diffSet![0].before).to.equal("initial content")
			expect(diffSet![0].after).to.equal("modified content")
		})
	})
})
