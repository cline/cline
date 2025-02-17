import CheckpointTracker from "./CheckpointTracker"
import * as CheckpointUtils from "./CheckpointUtils"
import { GitOperations } from "./CheckpointGitOperations"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { after, beforeEach, describe, it } from "mocha"
import * as vscode from "vscode"
import "should"
import simpleGit from "simple-git"
import { fileExistsAtPath } from "../../utils/fs"

describe("CheckpointTracker", () => {
    let tempDir: string
    let gitPath: string
    let originalGetWorkingDirectory: typeof CheckpointUtils.getWorkingDirectory
    let originalGetConfiguration: typeof vscode.workspace.getConfiguration

    beforeEach(async () => {
        // Create a temp directory for testing
        tempDir = path.join(os.tmpdir(), `checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        await fs.mkdir(tempDir)
        gitPath = path.join(tempDir, ".git")

        // Mock getWorkingDirectory
        originalGetWorkingDirectory = CheckpointUtils.getWorkingDirectory
        ;(CheckpointUtils as any).getWorkingDirectory = async () => tempDir

        // Mock VS Code configuration
        originalGetConfiguration = vscode.workspace.getConfiguration
        ;(vscode.workspace as any).getConfiguration = () => ({
            get: () => true // Always enable checkpoints in tests
        })
    })

    after(async () => {
        // Restore original functions
        ;(CheckpointUtils as any).getWorkingDirectory = originalGetWorkingDirectory
        ;(vscode.workspace as any).getConfiguration = originalGetConfiguration

        // Clean up temp directory
        await fs.rm(tempDir, { recursive: true, force: true })
    })

    describe("create", () => {
        it("should create new tracker with valid parameters", async () => {
            const taskId = "test-task"
            const tracker = await CheckpointTracker.create(taskId, tempDir)

            should.exist(tracker, "Tracker should be created")

            // Get the actual git path
            const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
            const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
            const actualGitPath = path.join(checkpointsDir, ".git")

            // Verify git repo was created
            const exists = await fileExistsAtPath(actualGitPath)
            exists.should.be.true()

            // Verify git configuration
            const git = simpleGit(checkpointsDir)

            // Check core.worktree
            const worktree = await git.getConfig("core.worktree")
            worktree.value?.should.equal(tempDir)
            should.exist(worktree.value, "core.worktree should be set")

            // Check user config
            const userName = await git.getConfig("user.name")
            userName.value?.should.equal("Cline Checkpoint")
            should.exist(userName.value, "user.name should be set")

            const userEmail = await git.getConfig("user.email")
            userEmail.value?.should.equal("checkpoint@cline.bot")
            should.exist(userEmail.value, "user.email should be set")

            // Check gpg sign is disabled
            const gpgSign = await git.getConfig("commit.gpgSign")
            gpgSign.value?.should.equal("false")
            should.exist(gpgSign.value, "commit.gpgSign should be set")

            // Verify task branch was created and is active
            const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
            currentBranch.should.equal(`task-${taskId}`)

            // Verify initial commit exists
            const log = await git.log()
            log.total.should.equal(1)
            log.latest?.message.should.equal("initial commit")
        })

        it("should throw error if globalStoragePath is missing", async () => {
            try {
                await CheckpointTracker.create("test-task", undefined)
                throw new Error("Should have thrown error for missing globalStoragePath")
            } catch (error: any) {
                error.message.should.equal("Global storage path is required to create a checkpoint tracker")
            }
        })

        it("should handle branch-per-task structure", async () => {
            const taskId = "test-task"
            const tracker = await CheckpointTracker.create(taskId, tempDir)
            should.exist(tracker, "Tracker should be created")

            // Get the actual git path
            const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
            const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
            const git = simpleGit(checkpointsDir)

            // Verify branch was created and is active
            const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
            currentBranch.should.equal(`task-${taskId}`)

            // Create a commit and verify branch tracking
            const testFilePath = path.join(tempDir, "test.txt") // Keep file in tempDir since that's the worktree
            await fs.writeFile(testFilePath, "test content")
            await git.add(testFilePath)
            await git.commit("test commit")

            const log = await git.log()
            log.total.should.equal(2) // Initial commit + test commit
            log.latest?.message.should.equal("test commit")
            
            // Switch to master first, then create new branch from there
            await git.checkout("master")
            await git.checkoutLocalBranch("another-task")
            const anotherLog = await git.log()
            anotherLog.total.should.equal(1) // Only initial commit
            anotherLog.latest?.message.should.equal("initial commit")
        })
    })

    describe("resetHead", () => {
        it("should reset to previous checkpoint state", async () => {
            const taskId = "test-task"
            const tracker = await CheckpointTracker.create(taskId, tempDir)
            should.exist(tracker, "Tracker should be created")
            if (!tracker) {
                throw new Error("Tracker was not created")
            }

            // Get git instance for direct operations
            const cwdHash = CheckpointUtils.hashWorkingDir(tempDir)
            const checkpointsDir = path.join(tempDir, "checkpoints", cwdHash)
            const git = simpleGit(checkpointsDir)

            // Create and commit first file
            const initialFile = path.join(tempDir, "initial.txt")
            await fs.writeFile(initialFile, "initial content")
            await git.add(initialFile)
            const firstCommit = await git.commit("test commit 1")
            should.exist(firstCommit.commit, "First commit should be created")

            // Create and commit second file
            const secondFile = path.join(tempDir, "second.txt")
            await fs.writeFile(secondFile, "second content")
            await git.add(secondFile)
            const secondCommit = await git.commit("test commit 2")
            should.exist(secondCommit.commit, "Second commit should be created")

            // Reset to first commit
            await tracker.resetHead(firstCommit.commit)

            // Verify file states after reset
            const secondFileExists = await fileExistsAtPath(secondFile)
            secondFileExists.should.be.false()

            const initialFileExists = await fileExistsAtPath(initialFile)
            initialFileExists.should.be.true()

            // Verify content of remaining file
            const content = await fs.readFile(initialFile, "utf8")
            content.should.equal("initial content")
        })
    })
})
