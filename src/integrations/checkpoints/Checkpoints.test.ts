import CheckpointTracker from "./CheckpointTracker"
import * as CheckpointUtils from "./CheckpointUtils"
import { GitOperations } from "./CheckpointGitOperations"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { after, beforeEach, describe, it } from "mocha"
import * as vscode from "vscode"
import { assert } from "chai"
import simpleGit from "simple-git"
import { HistoryItem } from "../../shared/HistoryItem"
import { fileExistsAtPath } from "../../utils/fs"

describe("CheckpointTracker", () => {
	let tempDir: string
	let gitPath: string
	let originalGetWorkingDirectory: typeof CheckpointUtils.getWorkingDirectory
	let originalGetConfiguration: typeof vscode.workspace.getConfiguration

	beforeEach(async () => {
		// Setup temp directory as mock project
		tempDir = path.join(os.tmpdir(), `checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir)

		gitPath = path.join(tempDir, ".git")

		// Mock workspace directory
		originalGetWorkingDirectory = CheckpointUtils.getWorkingDirectory
		;(CheckpointUtils as any).getWorkingDirectory = async () => tempDir

		// Mock VS Code configuration
		originalGetConfiguration = vscode.workspace.getConfiguration
		;(vscode.workspace as any).getConfiguration = () => ({
			get: () => true,
		})
	})

	describe("create", () => {
		it("should track file changes through checkpoints", async () => {
			// Create tracker for a new task
			const taskId = "feature-123"
			const tracker = await CheckpointTracker.create(taskId, tempDir)
			assert.exists(tracker, "Tracker should be created")
			if (!tracker) {
				throw new Error("Tracker was not created")
			}

			// Get the actual git path
			const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
			const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
			const git = simpleGit(checkpointsDir)

			// Create and commit first file
			const testFile = path.join(tempDir, "test.js")
			await fs.writeFile(testFile, "console.log('initial version');")
			await git.add(testFile)
			const firstCommit = await git.commit("test commit 1")
			assert.exists(firstCommit.commit, "First commit should be created")

			// Update and commit changes
			await fs.writeFile(testFile, "console.log('updated version');")
			await git.add(testFile)
			const secondCommit = await git.commit("test commit 2")
			assert.exists(secondCommit.commit, "Second commit should be created")

			// Verify changes through public API
			const changes = await tracker.getDiffSet(firstCommit.commit, secondCommit.commit)
			assert.lengthOf(changes, 1, "Should detect one changed file")
			assert.equal(changes[0].relativePath, "test.js")
			assert.include(changes[0].before, "initial version")
			assert.include(changes[0].after, "updated version")
		})

		it("should handle multiple file changes", async () => {
			const taskId = "feature-456"
			const tracker = await CheckpointTracker.create(taskId, tempDir)
			assert.exists(tracker, "Tracker should be created")
			if (!tracker) {
				throw new Error("Tracker was not created")
			}

			// Get git instance for direct operations
			const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
			const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
			const git = simpleGit(checkpointsDir)

			// Create initial files
			const appFile = path.join(tempDir, "app.js")
			const utilsFile = path.join(tempDir, "utils.js")
			await fs.writeFile(appFile, "// App code")
			await fs.writeFile(utilsFile, "// Utils code")
			await git.add([appFile, utilsFile])
			const firstCommit = await git.commit("initial files")
			assert.exists(firstCommit.commit, "First commit should be created")

			// Make changes
			await fs.writeFile(appFile, "// Updated app code")
			const newFile = path.join(tempDir, "new.js")
			await fs.writeFile(newFile, "// New file")
			await fs.rm(utilsFile)
			await git.add([appFile, newFile, utilsFile])
			const secondCommit = await git.commit("file changes")
			assert.exists(secondCommit.commit, "Second commit should be created")

			// Verify changes through public API
			const changes = await tracker.getDiffSet(firstCommit.commit, secondCommit.commit)
			assert.lengthOf(changes, 3, "Should detect all file changes")

			const changeTypes = changes.map((c) => ({
				path: c.relativePath,
				hasContent: c.before.length > 0 || c.after.length > 0,
			}))

			// Verify each type of change
			assert.isTrue(
				changeTypes.some((c) => c.path === "app.js" && c.hasContent),
				"Should detect modified file",
			)
			assert.isTrue(
				changeTypes.some((c) => c.path === "new.js" && c.hasContent),
				"Should detect new file",
			)
			assert.isTrue(
				changeTypes.some((c) => c.path === "utils.js" && c.hasContent),
				"Should detect deleted file",
			)
		})
	})

	describe("commit", () => {
		it("should create a commit and return valid hash", async () => {
			// Create tracker for a new task
			const taskId = "commit-test"
			const tracker = await CheckpointTracker.create(taskId, tempDir)
			assert.exists(tracker, "Tracker should be created")
			if (!tracker) {
				throw new Error("Tracker was not created")
			}

			// Get git instance for direct operations
			const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
			const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
			const git = simpleGit(checkpointsDir)

			// Create test file
			const testFile = path.join(tempDir, "test.js")
			await fs.writeFile(testFile, "console.log('test');")

			// Use public API to create commit with file
			const commitHash = await tracker.commit()
			assert.exists(commitHash, "Commit hash should be returned")
			assert.match(commitHash!, /^[a-f0-9]{40}$/, "Should be a valid git hash")

			// Verify commit exists in git history
			const log = await git.log()
			assert.include(log.all[0].hash, commitHash, "Commit should exist in git history")
			assert.include(log.all[0].message, `checkpoint-${cwdHash}-${taskId}`, "Commit message should follow format")
		})

		it("should allow empty commits with no changes", async () => {
			const taskId = "empty-commit-test"
			const tracker = await CheckpointTracker.create(taskId, tempDir)
			assert.exists(tracker, "Tracker should be created")
			if (!tracker) {
				throw new Error("Tracker was not created")
			}

			// Create empty commit and verify
			const commitHash = await tracker.commit()
			assert.exists(commitHash, "Commit hash should be returned even for empty commit")

			// Get git instance for verification
			const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
			const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
			const git = simpleGit(checkpointsDir)

			// Verify commit exists in history
			const log = await git.log()
			assert.include(log.all[0].hash, commitHash, "Empty commit should exist in git history")
			assert.include(log.all[0].message, "checkpoint", "Commit message should contain checkpoint")
		})

		it("should create a commit with file changes", async () => {
			const taskId = "file-changes-test"
			const tracker = await CheckpointTracker.create(taskId, tempDir)
			assert.exists(tracker, "Tracker should be created")
			if (!tracker) {
				throw new Error("Tracker was not created")
			}

			// Get git instance for verification
			const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
			const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
			const git = simpleGit(checkpointsDir)

			// Create test file and commit
			const testFile = path.join(tempDir, "test.js")
			await fs.writeFile(testFile, "console.log('test content');")
			const commitHash = await tracker.commit()
			assert.exists(commitHash, "Commit hash should be returned")

			// Verify commit
			const log = await git.log()
			assert.include(log.all[0].hash, commitHash, "Commit should be latest")
			assert.equal(log.all.length, 2, "Should have 2 commits (initial + our commit)")
		})

		it("should create commits on the correct task branch", async () => {
			const taskId = "branch-test"
			const tracker = await CheckpointTracker.create(taskId, tempDir)
			assert.exists(tracker, "Tracker should be created")
			if (!tracker) {
				throw new Error("Tracker was not created")
			}

			// Get git instance
			const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
			const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
			const git = simpleGit(checkpointsDir)

			// Create test file and commit
			const testFile = path.join(tempDir, "test.js")
			await fs.writeFile(testFile, "console.log('test');")
			const commitHash = await tracker.commit()
			assert.exists(commitHash, "Commit hash should be returned")

			// Verify branch
			const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
			assert.equal(currentBranch, `task-${taskId}`, "Should be on correct task branch")

			// Verify commit is on correct branch
			const branchCommits = await git.log([`task-${taskId}`])
			assert.include(branchCommits.all[0].hash, commitHash, "Commit should be on task branch")
		})

		it("should handle git initialization failures", async () => {
			// Create tracker with invalid path
			try {
				await CheckpointTracker.create("invalid-test", "")
				assert.fail("Should throw error for invalid path")
			} catch (error: any) {
				assert.include(error.message, "Global storage path is required", "Should throw appropriate error")
			}
		})

		it("should handle staging failures", async () => {
			const taskId = "staging-failure-test"
			const tracker = await CheckpointTracker.create(taskId, tempDir)
			assert.exists(tracker, "Tracker should be created")
			if (!tracker) {
				throw new Error("Tracker was not created")
			}

			// Create an unreadable file to force staging failure
			const testFile = path.join(tempDir, "test.js")
			await fs.writeFile(testFile, "console.log('test');")
			await fs.chmod(testFile, 0o000) // Remove all permissions

			try {
				await tracker.commit()
				await fs.chmod(testFile, 0o644) // Restore permissions for cleanup
				assert.fail("Failed to create checkpoint")
			} catch (error: any) {
				await fs.chmod(testFile, 0o644) // Restore permissions for cleanup
				assert.include(error.message, "Failed to create checkpoint", "Should throw appropriate error")
			}
		})
	})

	describe("deleteCheckpoints", () => {
		it("should delete all checkpoint data for a task", async () => {
			// Create tracker and some checkpoints
			const taskId = "task-to-delete"
			const tracker = await CheckpointTracker.create(taskId, tempDir)
			assert.exists(tracker, "Tracker should be created")
			if (!tracker) {
				throw new Error("Tracker was not created")
			}

			// Get git paths
			const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
			const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
			const git = simpleGit(checkpointsDir)

			// Create some files and checkpoints
			const testFile = path.join(tempDir, "test.js")
			await fs.writeFile(testFile, "console.log('test');")
			await git.add(testFile)
			await git.commit("test commit")

			// Verify branch exists
			const branches = await git.branch()
			assert.isTrue(branches.all.includes(`task-${taskId}`), "Task branch should exist")

			// Create mock history item
			const historyItem: HistoryItem = {
				id: taskId,
				task: taskId,
				ts: Date.now(),
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				shadowGitConfigWorkTree: tempDir,
			}

			// Delete checkpoints
			await CheckpointTracker.deleteCheckpoints(taskId, historyItem, tempDir)

			// Verify branch was deleted
			const branchesAfter = await git.branch()
			assert.isFalse(branchesAfter.all.includes(`task-${taskId}`), "Task branch should be deleted")

			// For legacy checkpoints, verify directory is cleaned up
			const legacyDir = path.join(tempDir, "checkpoints", taskId)
			const legacyExists = await fileExistsAtPath(legacyDir)
			assert.isFalse(legacyExists, "Legacy checkpoint directory should not exist")
		})

		it("should handle missing checkpoint data gracefully", async () => {
			const taskId = "non-existent-task"
			const historyItem: HistoryItem = {
				id: taskId,
				task: taskId,
				ts: Date.now(),
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				shadowGitConfigWorkTree: tempDir,
			}

			// Should not throw when trying to delete non-existent checkpoints
			await CheckpointTracker.deleteCheckpoints(taskId, historyItem, tempDir)
		})

		it("should throw error if globalStoragePath is missing", async () => {
			const taskId = "test-task"
			const historyItem: HistoryItem = {
				id: taskId,
				task: taskId,
				ts: Date.now(),
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				shadowGitConfigWorkTree: tempDir,
			}

			try {
				await CheckpointTracker.deleteCheckpoints(taskId, historyItem, "")
				assert.fail("Should have thrown error")
			} catch (error: any) {
				assert.equal(error.message, "Global storage uri is invalid")
			}
		})
	})

	describe("getDiffSet", () => {
		it("should compare changes between two commits", async () => {
			// Create tracker and initial state
			const taskId = "diff-test"
			const tracker = await CheckpointTracker.create(taskId, tempDir)
			assert.exists(tracker, "Tracker should be created")
			if (!tracker) {
				throw new Error("Tracker was not created")
			}

			// Get git instance for direct operations
			const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
			const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
			const git = simpleGit(checkpointsDir)

			// Switch to task branch first
			await git.checkout(`task-${taskId}`)

			// Create initial file state
			const testFile = path.join(tempDir, "test.js")
			await fs.writeFile(testFile, "function add(a, b) {\n  return a + b;\n}")
			await git.add(testFile)
			const firstCommit = await git.commit("initial version")
			assert.exists(firstCommit.commit, "First commit should be created")

			// Modify file
			await fs.writeFile(testFile, "function add(a, b) {\n  // Add two numbers\n  return a + b;\n}")
			await git.add(testFile)
			const secondCommit = await git.commit("added comment")
			assert.exists(secondCommit.commit, "Second commit should be created")

			// Get diff through public API
			const changes = await tracker.getDiffSet(firstCommit.commit, secondCommit.commit)
			assert.lengthOf(changes, 1, "Should detect one changed file")
			assert.equal(changes[0].relativePath, "test.js")
			// Remove escaping since git diff returns raw newlines
			assert.include(changes[0].before.replace(/\\n/g, "\n"), "function add(a, b) {\n  return a + b;\n}")
			assert.include(
				changes[0].after.replace(/\\n/g, "\n"),
				"function add(a, b) {\n  // Add two numbers\n  return a + b;\n}",
			)
		})

		it("should handle initial commit as base", async () => {
			const taskId = "diff-initial"
			const tracker = await CheckpointTracker.create(taskId, tempDir)
			assert.exists(tracker, "Tracker should be created")
			if (!tracker) {
				throw new Error("Tracker was not created")
			}

			// Get git instance for direct operations
			const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
			const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
			const git = simpleGit(checkpointsDir)

			// Switch to task branch first
			await git.checkout(`task-${taskId}`)

			// Create and commit file
			const testFile = path.join(tempDir, "test.js")
			await fs.writeFile(testFile, "console.log('hello');")
			await git.add(testFile)
			const commit = await git.commit("add test file")
			assert.exists(commit.commit, "Commit should be created")

			// Get diff from initial commit
			const changes = await tracker.getDiffSet(undefined, commit.commit)
			assert.lengthOf(changes, 1, "Should detect one new file")
			assert.equal(changes[0].relativePath, "test.js")
			assert.equal(changes[0].before, "")
			assert.include(changes[0].after, "console.log('hello');")
		})
	})

	after(async () => {
		// Restore original functions
		;(CheckpointUtils as any).getWorkingDirectory = originalGetWorkingDirectory
		;(vscode.workspace as any).getConfiguration = originalGetConfiguration

		// Cleanup temp directory
		await fs.rm(tempDir, { recursive: true, force: true })
	})
})
