// npx jest src/services/checkpoints/__tests__/ShadowCheckpointService.test.ts

import fs from "fs/promises"
import path from "path"
import os from "os"
import { EventEmitter } from "events"

import { simpleGit, SimpleGit } from "simple-git"

import { fileExistsAtPath } from "../../../utils/fs"
import * as fileSearch from "../../../services/search/file-search"

import { RepoPerTaskCheckpointService } from "../RepoPerTaskCheckpointService"

jest.setTimeout(10_000)

const tmpDir = path.join(os.tmpdir(), "CheckpointService")

const initWorkspaceRepo = async ({
	workspaceDir,
	userName = "Roo Code",
	userEmail = "support@roocode.com",
	testFileName = "test.txt",
	textFileContent = "Hello, world!",
}: {
	workspaceDir: string
	userName?: string
	userEmail?: string
	testFileName?: string
	textFileContent?: string
}) => {
	// Create a temporary directory for testing.
	await fs.mkdir(workspaceDir, { recursive: true })

	// Initialize git repo.
	const git = simpleGit(workspaceDir)
	await git.init()
	await git.addConfig("user.name", userName)
	await git.addConfig("user.email", userEmail)

	// Create test file.
	const testFile = path.join(workspaceDir, testFileName)
	await fs.writeFile(testFile, textFileContent)

	// Create initial commit.
	await git.add(".")
	await git.commit("Initial commit")!

	return { git, testFile }
}

describe.each([[RepoPerTaskCheckpointService, "RepoPerTaskCheckpointService"]])(
	"CheckpointService",
	(klass, prefix) => {
		const taskId = "test-task"

		let workspaceGit: SimpleGit
		let testFile: string
		let service: RepoPerTaskCheckpointService

		beforeEach(async () => {
			const shadowDir = path.join(tmpDir, `${prefix}-${Date.now()}`)
			const workspaceDir = path.join(tmpDir, `workspace-${Date.now()}`)
			const repo = await initWorkspaceRepo({ workspaceDir })

			workspaceGit = repo.git
			testFile = repo.testFile

			service = await klass.create({ taskId, shadowDir, workspaceDir, log: () => {} })
			await service.initShadowGit()
		})

		afterEach(async () => {
			jest.restoreAllMocks()
		})

		afterAll(async () => {
			await fs.rm(tmpDir, { recursive: true, force: true })
		})

		describe(`${klass.name}#getDiff`, () => {
			it("returns the correct diff between commits", async () => {
				await fs.writeFile(testFile, "Ahoy, world!")
				const commit1 = await service.saveCheckpoint("Ahoy, world!")
				expect(commit1?.commit).toBeTruthy()

				await fs.writeFile(testFile, "Goodbye, world!")
				const commit2 = await service.saveCheckpoint("Goodbye, world!")
				expect(commit2?.commit).toBeTruthy()

				const diff1 = await service.getDiff({ to: commit1!.commit })
				expect(diff1).toHaveLength(1)
				expect(diff1[0].paths.relative).toBe("test.txt")
				expect(diff1[0].paths.absolute).toBe(testFile)
				expect(diff1[0].content.before).toBe("Hello, world!")
				expect(diff1[0].content.after).toBe("Ahoy, world!")

				const diff2 = await service.getDiff({ from: service.baseHash, to: commit2!.commit })
				expect(diff2).toHaveLength(1)
				expect(diff2[0].paths.relative).toBe("test.txt")
				expect(diff2[0].paths.absolute).toBe(testFile)
				expect(diff2[0].content.before).toBe("Hello, world!")
				expect(diff2[0].content.after).toBe("Goodbye, world!")

				const diff12 = await service.getDiff({ from: commit1!.commit, to: commit2!.commit })
				expect(diff12).toHaveLength(1)
				expect(diff12[0].paths.relative).toBe("test.txt")
				expect(diff12[0].paths.absolute).toBe(testFile)
				expect(diff12[0].content.before).toBe("Ahoy, world!")
				expect(diff12[0].content.after).toBe("Goodbye, world!")
			})

			it("handles new files in diff", async () => {
				const newFile = path.join(service.workspaceDir, "new.txt")
				await fs.writeFile(newFile, "New file content")
				const commit = await service.saveCheckpoint("Add new file")
				expect(commit?.commit).toBeTruthy()

				const changes = await service.getDiff({ to: commit!.commit })
				const change = changes.find((c) => c.paths.relative === "new.txt")
				expect(change).toBeDefined()
				expect(change?.content.before).toBe("")
				expect(change?.content.after).toBe("New file content")
			})

			it("handles deleted files in diff", async () => {
				const fileToDelete = path.join(service.workspaceDir, "new.txt")
				await fs.writeFile(fileToDelete, "New file content")
				const commit1 = await service.saveCheckpoint("Add file")
				expect(commit1?.commit).toBeTruthy()

				await fs.unlink(fileToDelete)
				const commit2 = await service.saveCheckpoint("Delete file")
				expect(commit2?.commit).toBeTruthy()

				const changes = await service.getDiff({ from: commit1!.commit, to: commit2!.commit })
				const change = changes.find((c) => c.paths.relative === "new.txt")
				expect(change).toBeDefined()
				expect(change!.content.before).toBe("New file content")
				expect(change!.content.after).toBe("")
			})
		})

		describe(`${klass.name}#saveCheckpoint`, () => {
			it("creates a checkpoint if there are pending changes", async () => {
				await fs.writeFile(testFile, "Ahoy, world!")
				const commit1 = await service.saveCheckpoint("First checkpoint")
				expect(commit1?.commit).toBeTruthy()
				const details1 = await service.getDiff({ to: commit1!.commit })
				expect(details1[0].content.before).toContain("Hello, world!")
				expect(details1[0].content.after).toContain("Ahoy, world!")

				await fs.writeFile(testFile, "Hola, world!")
				const commit2 = await service.saveCheckpoint("Second checkpoint")
				expect(commit2?.commit).toBeTruthy()
				const details2 = await service.getDiff({ from: commit1!.commit, to: commit2!.commit })
				expect(details2[0].content.before).toContain("Ahoy, world!")
				expect(details2[0].content.after).toContain("Hola, world!")

				// Switch to checkpoint 1.
				await service.restoreCheckpoint(commit1!.commit)
				expect(await fs.readFile(testFile, "utf-8")).toBe("Ahoy, world!")

				// Switch to checkpoint 2.
				await service.restoreCheckpoint(commit2!.commit)
				expect(await fs.readFile(testFile, "utf-8")).toBe("Hola, world!")

				// Switch back to initial commit.
				expect(service.baseHash).toBeTruthy()
				await service.restoreCheckpoint(service.baseHash!)
				expect(await fs.readFile(testFile, "utf-8")).toBe("Hello, world!")
			})

			it("preserves workspace and index state after saving checkpoint", async () => {
				// Create three files with different states: staged, unstaged, and mixed.
				const unstagedFile = path.join(service.workspaceDir, "unstaged.txt")
				const stagedFile = path.join(service.workspaceDir, "staged.txt")
				const mixedFile = path.join(service.workspaceDir, "mixed.txt")

				await fs.writeFile(unstagedFile, "Initial unstaged")
				await fs.writeFile(stagedFile, "Initial staged")
				await fs.writeFile(mixedFile, "Initial mixed")
				await workspaceGit.add(["."])
				const result = await workspaceGit.commit("Add initial files")
				expect(result?.commit).toBeTruthy()

				await fs.writeFile(unstagedFile, "Modified unstaged")

				await fs.writeFile(stagedFile, "Modified staged")
				await workspaceGit.add([stagedFile])

				await fs.writeFile(mixedFile, "Modified mixed - staged")
				await workspaceGit.add([mixedFile])
				await fs.writeFile(mixedFile, "Modified mixed - unstaged")

				// Save checkpoint.
				const commit = await service.saveCheckpoint("Test checkpoint")
				expect(commit?.commit).toBeTruthy()

				// Verify workspace state is preserved.
				const status = await workspaceGit.status()

				// All files should be modified.
				expect(status.modified).toContain("unstaged.txt")
				expect(status.modified).toContain("staged.txt")
				expect(status.modified).toContain("mixed.txt")

				// Only staged and mixed files should be staged.
				expect(status.staged).not.toContain("unstaged.txt")
				expect(status.staged).toContain("staged.txt")
				expect(status.staged).toContain("mixed.txt")

				// Verify file contents.
				expect(await fs.readFile(unstagedFile, "utf-8")).toBe("Modified unstaged")
				expect(await fs.readFile(stagedFile, "utf-8")).toBe("Modified staged")
				expect(await fs.readFile(mixedFile, "utf-8")).toBe("Modified mixed - unstaged")

				// Verify staged changes (--cached shows only staged changes).
				const stagedDiff = await workspaceGit.diff(["--cached", "mixed.txt"])
				expect(stagedDiff).toContain("-Initial mixed")
				expect(stagedDiff).toContain("+Modified mixed - staged")

				// Verify unstaged changes (shows working directory changes).
				const unstagedDiff = await workspaceGit.diff(["mixed.txt"])
				expect(unstagedDiff).toContain("-Modified mixed - staged")
				expect(unstagedDiff).toContain("+Modified mixed - unstaged")
			})

			it("does not create a checkpoint if there are no pending changes", async () => {
				const commit0 = await service.saveCheckpoint("Zeroth checkpoint")
				expect(commit0?.commit).toBeFalsy()

				await fs.writeFile(testFile, "Ahoy, world!")
				const commit1 = await service.saveCheckpoint("First checkpoint")
				expect(commit1?.commit).toBeTruthy()

				const commit2 = await service.saveCheckpoint("Second checkpoint")
				expect(commit2?.commit).toBeFalsy()
			})

			it("includes untracked files in checkpoints", async () => {
				// Create an untracked file.
				const untrackedFile = path.join(service.workspaceDir, "untracked.txt")
				await fs.writeFile(untrackedFile, "I am untracked!")

				// Save a checkpoint with the untracked file.
				const commit1 = await service.saveCheckpoint("Checkpoint with untracked file")
				expect(commit1?.commit).toBeTruthy()

				// Verify the untracked file was included in the checkpoint.
				const details = await service.getDiff({ to: commit1!.commit })
				expect(details[0].content.before).toContain("")
				expect(details[0].content.after).toContain("I am untracked!")

				// Create another checkpoint with a different state.
				await fs.writeFile(testFile, "Changed tracked file")
				const commit2 = await service.saveCheckpoint("Second checkpoint")
				expect(commit2?.commit).toBeTruthy()

				// Restore first checkpoint and verify untracked file is preserved.
				await service.restoreCheckpoint(commit1!.commit)
				expect(await fs.readFile(untrackedFile, "utf-8")).toBe("I am untracked!")
				expect(await fs.readFile(testFile, "utf-8")).toBe("Hello, world!")

				// Restore second checkpoint and verify untracked file remains (since
				// restore preserves untracked files)
				await service.restoreCheckpoint(commit2!.commit)
				expect(await fs.readFile(untrackedFile, "utf-8")).toBe("I am untracked!")
				expect(await fs.readFile(testFile, "utf-8")).toBe("Changed tracked file")
			})

			it("handles file deletions correctly", async () => {
				await fs.writeFile(testFile, "I am tracked!")
				const untrackedFile = path.join(service.workspaceDir, "new.txt")
				await fs.writeFile(untrackedFile, "I am untracked!")
				const commit1 = await service.saveCheckpoint("First checkpoint")
				expect(commit1?.commit).toBeTruthy()

				await fs.unlink(testFile)
				await fs.unlink(untrackedFile)
				const commit2 = await service.saveCheckpoint("Second checkpoint")
				expect(commit2?.commit).toBeTruthy()

				// Verify files are gone.
				await expect(fs.readFile(testFile, "utf-8")).rejects.toThrow()
				await expect(fs.readFile(untrackedFile, "utf-8")).rejects.toThrow()

				// Restore first checkpoint.
				await service.restoreCheckpoint(commit1!.commit)
				expect(await fs.readFile(testFile, "utf-8")).toBe("I am tracked!")
				expect(await fs.readFile(untrackedFile, "utf-8")).toBe("I am untracked!")

				// Restore second checkpoint.
				await service.restoreCheckpoint(commit2!.commit)
				await expect(fs.readFile(testFile, "utf-8")).rejects.toThrow()
				await expect(fs.readFile(untrackedFile, "utf-8")).rejects.toThrow()
			})

			it("does not create a checkpoint for ignored files", async () => {
				// Create a file that matches an ignored pattern (e.g., .log file).
				const ignoredFile = path.join(service.workspaceDir, "ignored.log")
				await fs.writeFile(ignoredFile, "Initial ignored content")

				const commit = await service.saveCheckpoint("Ignored file checkpoint")
				expect(commit?.commit).toBeFalsy()

				await fs.writeFile(ignoredFile, "Modified ignored content")

				const commit2 = await service.saveCheckpoint("Ignored file modified checkpoint")
				expect(commit2?.commit).toBeFalsy()

				expect(await fs.readFile(ignoredFile, "utf-8")).toBe("Modified ignored content")
			})

			it("does not create a checkpoint for LFS files", async () => {
				// Create a .gitattributes file with LFS patterns.
				const gitattributesPath = path.join(service.workspaceDir, ".gitattributes")
				await fs.writeFile(gitattributesPath, "*.lfs filter=lfs diff=lfs merge=lfs -text")

				// Re-initialize the service to trigger a write to .git/info/exclude.
				service = new klass(service.taskId, service.checkpointsDir, service.workspaceDir, () => {})
				const excludesPath = path.join(service.checkpointsDir, ".git", "info", "exclude")
				expect((await fs.readFile(excludesPath, "utf-8")).split("\n")).not.toContain("*.lfs")
				await service.initShadowGit()
				expect((await fs.readFile(excludesPath, "utf-8")).split("\n")).toContain("*.lfs")

				const commit0 = await service.saveCheckpoint("Add gitattributes")
				expect(commit0?.commit).toBeTruthy()

				// Create a file that matches an LFS pattern.
				const lfsFile = path.join(service.workspaceDir, "foo.lfs")
				await fs.writeFile(lfsFile, "Binary file content simulation")

				const commit = await service.saveCheckpoint("LFS file checkpoint")
				expect(commit?.commit).toBeFalsy()

				await fs.writeFile(lfsFile, "Modified binary content")

				const commit2 = await service.saveCheckpoint("LFS file modified checkpoint")
				expect(commit2?.commit).toBeFalsy()

				expect(await fs.readFile(lfsFile, "utf-8")).toBe("Modified binary content")
			})
		})

		describe(`${klass.name}#create`, () => {
			it("initializes a git repository if one does not already exist", async () => {
				const shadowDir = path.join(tmpDir, `${prefix}2-${Date.now()}`)
				const workspaceDir = path.join(tmpDir, `workspace2-${Date.now()}`)
				await fs.mkdir(workspaceDir)

				const newTestFile = path.join(workspaceDir, "test.txt")
				await fs.writeFile(newTestFile, "Hello, world!")
				expect(await fs.readFile(newTestFile, "utf-8")).toBe("Hello, world!")

				// Ensure the git repository was initialized.
				const newService = await klass.create({ taskId, shadowDir, workspaceDir, log: () => {} })
				const { created } = await newService.initShadowGit()
				expect(created).toBeTruthy()

				const gitDir = path.join(newService.checkpointsDir, ".git")
				expect(await fs.stat(gitDir)).toBeTruthy()

				// Save a new checkpoint: Ahoy, world!
				await fs.writeFile(newTestFile, "Ahoy, world!")
				const commit1 = await newService.saveCheckpoint("Ahoy, world!")
				expect(commit1?.commit).toBeTruthy()
				expect(await fs.readFile(newTestFile, "utf-8")).toBe("Ahoy, world!")

				// Restore "Hello, world!"
				await newService.restoreCheckpoint(newService.baseHash!)
				expect(await fs.readFile(newTestFile, "utf-8")).toBe("Hello, world!")

				// Restore "Ahoy, world!"
				await newService.restoreCheckpoint(commit1!.commit)
				expect(await fs.readFile(newTestFile, "utf-8")).toBe("Ahoy, world!")

				await fs.rm(newService.checkpointsDir, { recursive: true, force: true })
				await fs.rm(newService.workspaceDir, { recursive: true, force: true })
			})
		})

		describe(`${klass.name}#renameNestedGitRepos`, () => {
			it("handles nested git repositories during initialization", async () => {
				// Create a new temporary workspace and service for this test.
				const shadowDir = path.join(tmpDir, `${prefix}-nested-git-${Date.now()}`)
				const workspaceDir = path.join(tmpDir, `workspace-nested-git-${Date.now()}`)

				// Create a primary workspace repo.
				await fs.mkdir(workspaceDir, { recursive: true })
				const mainGit = simpleGit(workspaceDir)
				await mainGit.init()
				await mainGit.addConfig("user.name", "Roo Code")
				await mainGit.addConfig("user.email", "support@roocode.com")

				// Create a nested repo inside the workspace.
				const nestedRepoPath = path.join(workspaceDir, "nested-project")
				await fs.mkdir(nestedRepoPath, { recursive: true })
				const nestedGit = simpleGit(nestedRepoPath)
				await nestedGit.init()
				await nestedGit.addConfig("user.name", "Roo Code")
				await nestedGit.addConfig("user.email", "support@roocode.com")

				// Add a file to the nested repo.
				const nestedFile = path.join(nestedRepoPath, "nested-file.txt")
				await fs.writeFile(nestedFile, "Content in nested repo")
				await nestedGit.add(".")
				await nestedGit.commit("Initial commit in nested repo")

				// Create a test file in the main workspace.
				const mainFile = path.join(workspaceDir, "main-file.txt")
				await fs.writeFile(mainFile, "Content in main repo")
				await mainGit.add(".")
				await mainGit.commit("Initial commit in main repo")

				// Confirm nested git directory exists before initialization.
				const nestedGitDir = path.join(nestedRepoPath, ".git")
				const headFile = path.join(nestedGitDir, "HEAD")
				await fs.writeFile(headFile, "HEAD")
				const nestedGitDisabledDir = `${nestedGitDir}_disabled`
				expect(await fileExistsAtPath(nestedGitDir)).toBe(true)
				expect(await fileExistsAtPath(nestedGitDisabledDir)).toBe(false)

				const renameSpy = jest.spyOn(fs, "rename")

				jest.spyOn(fileSearch, "executeRipgrep").mockImplementation(({ args }) => {
					const searchPattern = args[4]

					if (searchPattern.includes(".git/HEAD")) {
						return Promise.resolve([
							{
								path: path.relative(workspaceDir, nestedGitDir),
								type: "folder",
								label: ".git",
							},
						])
					} else {
						return Promise.resolve([])
					}
				})

				const service = new klass(taskId, shadowDir, workspaceDir, () => {})
				await service.initShadowGit()

				// Verify rename was called with correct paths.
				expect(renameSpy.mock.calls).toHaveLength(1)
				expect(renameSpy.mock.calls[0][0]).toBe(nestedGitDir)
				expect(renameSpy.mock.calls[0][1]).toBe(nestedGitDisabledDir)

				jest.spyOn(require("../../../utils/fs"), "fileExistsAtPath").mockImplementation((path) => {
					if (path === nestedGitDir) {
						return Promise.resolve(true)
					} else if (path === nestedGitDisabledDir) {
						return Promise.resolve(false)
					}

					return Promise.resolve(false)
				})

				// Verify the nested git directory is back to normal after initialization.
				expect(await fileExistsAtPath(nestedGitDir)).toBe(true)
				expect(await fileExistsAtPath(nestedGitDisabledDir)).toBe(false)

				// Clean up.
				renameSpy.mockRestore()
				jest.restoreAllMocks()
				await fs.rm(shadowDir, { recursive: true, force: true })
				await fs.rm(workspaceDir, { recursive: true, force: true })
			})
		})

		describe(`${klass.name}#events`, () => {
			it("emits initialize event when service is created", async () => {
				const shadowDir = path.join(tmpDir, `${prefix}3-${Date.now()}`)
				const workspaceDir = path.join(tmpDir, `workspace3-${Date.now()}`)
				await fs.mkdir(workspaceDir, { recursive: true })

				const newTestFile = path.join(workspaceDir, "test.txt")
				await fs.writeFile(newTestFile, "Testing events!")

				// Create a mock implementation of emit to track events.
				const emitSpy = jest.spyOn(EventEmitter.prototype, "emit")

				// Create the service - this will trigger the initialize event.
				const newService = await klass.create({ taskId, shadowDir, workspaceDir, log: () => {} })
				await newService.initShadowGit()

				// Find the initialize event in the emit calls.
				let initializeEvent = null

				for (let i = 0; i < emitSpy.mock.calls.length; i++) {
					const call = emitSpy.mock.calls[i]

					if (call[0] === "initialize") {
						initializeEvent = call[1]
						break
					}
				}

				// Restore the spy.
				emitSpy.mockRestore()

				// Verify the event was emitted with the correct data.
				expect(initializeEvent).not.toBeNull()
				expect(initializeEvent.type).toBe("initialize")
				expect(initializeEvent.workspaceDir).toBe(workspaceDir)
				expect(initializeEvent.baseHash).toBeTruthy()
				expect(typeof initializeEvent.created).toBe("boolean")
				expect(typeof initializeEvent.duration).toBe("number")

				// Verify the event was emitted with the correct data.
				expect(initializeEvent).not.toBeNull()
				expect(initializeEvent.type).toBe("initialize")
				expect(initializeEvent.workspaceDir).toBe(workspaceDir)
				expect(initializeEvent.baseHash).toBeTruthy()
				expect(typeof initializeEvent.created).toBe("boolean")
				expect(typeof initializeEvent.duration).toBe("number")

				// Clean up.
				await fs.rm(shadowDir, { recursive: true, force: true })
				await fs.rm(workspaceDir, { recursive: true, force: true })
			})

			it("emits checkpoint event when saving checkpoint", async () => {
				const checkpointHandler = jest.fn()
				service.on("checkpoint", checkpointHandler)

				await fs.writeFile(testFile, "Changed content for checkpoint event test")
				const result = await service.saveCheckpoint("Test checkpoint event")
				expect(result?.commit).toBeDefined()

				expect(checkpointHandler).toHaveBeenCalledTimes(1)
				const eventData = checkpointHandler.mock.calls[0][0]
				expect(eventData.type).toBe("checkpoint")
				expect(eventData.toHash).toBeDefined()
				expect(eventData.toHash).toBe(result!.commit)
				expect(typeof eventData.duration).toBe("number")
			})

			it("emits restore event when restoring checkpoint", async () => {
				// First create a checkpoint to restore.
				await fs.writeFile(testFile, "Content for restore test")
				const commit = await service.saveCheckpoint("Checkpoint for restore test")
				expect(commit?.commit).toBeTruthy()

				// Change the file again.
				await fs.writeFile(testFile, "Changed after checkpoint")

				// Setup restore event listener.
				const restoreHandler = jest.fn()
				service.on("restore", restoreHandler)

				// Restore the checkpoint.
				await service.restoreCheckpoint(commit!.commit)

				// Verify the event was emitted.
				expect(restoreHandler).toHaveBeenCalledTimes(1)
				const eventData = restoreHandler.mock.calls[0][0]
				expect(eventData.type).toBe("restore")
				expect(eventData.commitHash).toBe(commit!.commit)
				expect(typeof eventData.duration).toBe("number")

				// Verify the file was actually restored.
				expect(await fs.readFile(testFile, "utf-8")).toBe("Content for restore test")
			})

			it("emits error event when an error occurs", async () => {
				const errorHandler = jest.fn()
				service.on("error", errorHandler)

				// Force an error by providing an invalid commit hash.
				const invalidCommitHash = "invalid-commit-hash"

				// Try to restore an invalid checkpoint.
				try {
					await service.restoreCheckpoint(invalidCommitHash)
				} catch (error) {
					// Expected to throw, we're testing the event emission.
				}

				// Verify the error event was emitted.
				expect(errorHandler).toHaveBeenCalledTimes(1)
				const eventData = errorHandler.mock.calls[0][0]
				expect(eventData.type).toBe("error")
				expect(eventData.error).toBeInstanceOf(Error)
			})

			it("supports multiple event listeners for the same event", async () => {
				const checkpointHandler1 = jest.fn()
				const checkpointHandler2 = jest.fn()

				service.on("checkpoint", checkpointHandler1)
				service.on("checkpoint", checkpointHandler2)

				await fs.writeFile(testFile, "Content for multiple listeners test")
				const result = await service.saveCheckpoint("Testing multiple listeners")

				// Verify both handlers were called with the same event data.
				expect(checkpointHandler1).toHaveBeenCalledTimes(1)
				expect(checkpointHandler2).toHaveBeenCalledTimes(1)

				const eventData1 = checkpointHandler1.mock.calls[0][0]
				const eventData2 = checkpointHandler2.mock.calls[0][0]

				expect(eventData1).toEqual(eventData2)
				expect(eventData1.type).toBe("checkpoint")
				expect(eventData1.toHash).toBe(result?.commit)
			})

			it("allows removing event listeners", async () => {
				const checkpointHandler = jest.fn()

				// Add the listener.
				service.on("checkpoint", checkpointHandler)

				// Make a change and save a checkpoint.
				await fs.writeFile(testFile, "Content for remove listener test - part 1")
				await service.saveCheckpoint("Testing listener - part 1")

				// Verify handler was called.
				expect(checkpointHandler).toHaveBeenCalledTimes(1)
				checkpointHandler.mockClear()

				// Remove the listener.
				service.off("checkpoint", checkpointHandler)

				// Make another change and save a checkpoint.
				await fs.writeFile(testFile, "Content for remove listener test - part 2")
				await service.saveCheckpoint("Testing listener - part 2")

				// Verify handler was not called after being removed.
				expect(checkpointHandler).not.toHaveBeenCalled()
			})
		})

		describe(`${klass.name}#saveCheckpoint with allowEmpty option`, () => {
			it("creates checkpoint with allowEmpty=true even when no changes", async () => {
				// No changes made, but force checkpoint creation
				const result = await service.saveCheckpoint("Empty checkpoint", { allowEmpty: true })

				expect(result).toBeDefined()
				expect(result?.commit).toBeTruthy()
				expect(typeof result?.commit).toBe("string")
			})

			it("does not create checkpoint with allowEmpty=false when no changes", async () => {
				const result = await service.saveCheckpoint("No changes checkpoint", { allowEmpty: false })

				expect(result).toBeUndefined()
			})

			it("does not create checkpoint by default when no changes", async () => {
				const result = await service.saveCheckpoint("Default behavior checkpoint")

				expect(result).toBeUndefined()
			})

			it("creates checkpoint with changes regardless of allowEmpty setting", async () => {
				await fs.writeFile(testFile, "Modified content for allowEmpty test")

				const resultWithAllowEmpty = await service.saveCheckpoint("With changes and allowEmpty", {
					allowEmpty: true,
				})
				expect(resultWithAllowEmpty?.commit).toBeTruthy()

				await fs.writeFile(testFile, "Another modification for allowEmpty test")

				const resultWithoutAllowEmpty = await service.saveCheckpoint("With changes, no allowEmpty")
				expect(resultWithoutAllowEmpty?.commit).toBeTruthy()
			})

			it("emits checkpoint event for empty commits when allowEmpty=true", async () => {
				const checkpointHandler = jest.fn()
				service.on("checkpoint", checkpointHandler)

				const result = await service.saveCheckpoint("Empty checkpoint event test", { allowEmpty: true })

				expect(checkpointHandler).toHaveBeenCalledTimes(1)
				const eventData = checkpointHandler.mock.calls[0][0]
				expect(eventData.type).toBe("checkpoint")
				expect(eventData.toHash).toBe(result?.commit)
				expect(typeof eventData.duration).toBe("number")
				expect(typeof eventData.isFirst).toBe("boolean") // Can be true or false depending on checkpoint history
			})

			it("does not emit checkpoint event when no changes and allowEmpty=false", async () => {
				// First, create a checkpoint to ensure we're not in the initial state
				await fs.writeFile(testFile, "Setup content")
				await service.saveCheckpoint("Setup checkpoint")

				// Reset the file to original state
				await fs.writeFile(testFile, "Hello, world!")
				await service.saveCheckpoint("Reset to original")

				// Now test with no changes and allowEmpty=false
				const checkpointHandler = jest.fn()
				service.on("checkpoint", checkpointHandler)

				const result = await service.saveCheckpoint("No changes, no event", { allowEmpty: false })

				expect(result).toBeUndefined()
				expect(checkpointHandler).not.toHaveBeenCalled()
			})

			it("handles multiple empty checkpoints correctly", async () => {
				const commit1 = await service.saveCheckpoint("First empty checkpoint", { allowEmpty: true })
				expect(commit1?.commit).toBeTruthy()

				const commit2 = await service.saveCheckpoint("Second empty checkpoint", { allowEmpty: true })
				expect(commit2?.commit).toBeTruthy()

				// Commits should be different
				expect(commit1?.commit).not.toBe(commit2?.commit)
			})

			it("logs correct message for allowEmpty option", async () => {
				const logMessages: string[] = []
				const testService = await klass.create({
					taskId: "log-test",
					shadowDir: path.join(tmpDir, `log-test-${Date.now()}`),
					workspaceDir: service.workspaceDir,
					log: (message: string) => logMessages.push(message),
				})
				await testService.initShadowGit()

				await testService.saveCheckpoint("Test logging with allowEmpty", { allowEmpty: true })

				const saveCheckpointLogs = logMessages.filter(
					(msg) => msg.includes("starting checkpoint save") && msg.includes("allowEmpty: true"),
				)
				expect(saveCheckpointLogs).toHaveLength(1)

				await testService.saveCheckpoint("Test logging without allowEmpty")

				const defaultLogs = logMessages.filter(
					(msg) => msg.includes("starting checkpoint save") && msg.includes("allowEmpty: false"),
				)
				expect(defaultLogs).toHaveLength(1)
			})

			it("maintains checkpoint history with empty commits", async () => {
				// Create a regular checkpoint
				await fs.writeFile(testFile, "Regular change")
				const regularCommit = await service.saveCheckpoint("Regular checkpoint")
				expect(regularCommit?.commit).toBeTruthy()

				// Create an empty checkpoint
				const emptyCommit = await service.saveCheckpoint("Empty checkpoint", { allowEmpty: true })
				expect(emptyCommit?.commit).toBeTruthy()

				// Create another regular checkpoint
				await fs.writeFile(testFile, "Another regular change")
				const anotherCommit = await service.saveCheckpoint("Another regular checkpoint")
				expect(anotherCommit?.commit).toBeTruthy()

				// Verify we can restore to the empty checkpoint
				await service.restoreCheckpoint(emptyCommit!.commit)
				expect(await fs.readFile(testFile, "utf-8")).toBe("Regular change")

				// Verify we can restore to other checkpoints
				await service.restoreCheckpoint(regularCommit!.commit)
				expect(await fs.readFile(testFile, "utf-8")).toBe("Regular change")

				await service.restoreCheckpoint(anotherCommit!.commit)
				expect(await fs.readFile(testFile, "utf-8")).toBe("Another regular change")
			})

			it("handles getDiff correctly with empty commits", async () => {
				// Create a regular checkpoint
				await fs.writeFile(testFile, "Content before empty")
				const beforeEmpty = await service.saveCheckpoint("Before empty")
				expect(beforeEmpty?.commit).toBeTruthy()

				// Create an empty checkpoint
				const emptyCommit = await service.saveCheckpoint("Empty checkpoint", { allowEmpty: true })
				expect(emptyCommit?.commit).toBeTruthy()

				// Get diff between regular commit and empty commit
				const diff = await service.getDiff({
					from: beforeEmpty!.commit,
					to: emptyCommit!.commit,
				})

				// Should have no differences since empty commit doesn't change anything
				expect(diff).toHaveLength(0)
			})

			it("works correctly in integration with new task workflow", async () => {
				// Simulate the new task workflow where we force a checkpoint even with no changes
				// This tests the specific use case mentioned in the git commit

				// Start with a clean state (no pending changes)
				const initialState = await service.saveCheckpoint("Check initial state")
				expect(initialState).toBeUndefined() // No changes, so no commit

				// Force a checkpoint for new task (this is the new functionality)
				const newTaskCheckpoint = await service.saveCheckpoint("New task checkpoint", { allowEmpty: true })
				expect(newTaskCheckpoint?.commit).toBeTruthy()

				// Verify the checkpoint was created and can be restored
				await fs.writeFile(testFile, "Work done in new task")
				const workCommit = await service.saveCheckpoint("Work in new task")
				expect(workCommit?.commit).toBeTruthy()

				// Restore to the new task checkpoint
				await service.restoreCheckpoint(newTaskCheckpoint!.commit)

				// File should be back to original state
				expect(await fs.readFile(testFile, "utf-8")).toBe("Hello, world!")
			})
		})
	},
)
