// npx jest src/services/checkpoints/__tests__/CheckpointService.test.ts

import fs from "fs/promises"
import path from "path"
import os from "os"

import { simpleGit, SimpleGit } from "simple-git"

import { CheckpointService } from "../CheckpointService"

describe("CheckpointService", () => {
	const taskId = "test-task"
	let git: SimpleGit
	let testFile: string
	let service: CheckpointService

	beforeEach(async () => {
		// Create a temporary directory for testing.
		const baseDir = path.join(os.tmpdir(), `checkpoint-service-test-${Date.now()}`)
		await fs.mkdir(baseDir)

		// Initialize git repo.
		git = simpleGit(baseDir)
		await git.init()
		await git.addConfig("user.name", "Roo Code")
		await git.addConfig("user.email", "support@roocode.com")

		// Create test file.
		testFile = path.join(baseDir, "test.txt")
		await fs.writeFile(testFile, "Hello, world!")

		// Create initial commit.
		await git.add(".")
		await git.commit("Initial commit")!

		// Create service instance.
		const log = () => {}
		service = await CheckpointService.create({ taskId, git, baseDir, log })
	})

	afterEach(async () => {
		await fs.rm(service.baseDir, { recursive: true, force: true })
		jest.restoreAllMocks()
	})

	describe("getDiff", () => {
		it("returns the correct diff between commits", async () => {
			await fs.writeFile(testFile, "Ahoy, world!")
			const commit1 = await service.saveCheckpoint("First checkpoint")
			expect(commit1?.commit).toBeTruthy()

			await fs.writeFile(testFile, "Goodbye, world!")
			const commit2 = await service.saveCheckpoint("Second checkpoint")
			expect(commit2?.commit).toBeTruthy()

			const diff1 = await service.getDiff({ to: commit1!.commit })
			expect(diff1).toHaveLength(1)
			expect(diff1[0].paths.relative).toBe("test.txt")
			expect(diff1[0].paths.absolute).toBe(testFile)
			expect(diff1[0].content.before).toBe("Hello, world!")
			expect(diff1[0].content.after).toBe("Ahoy, world!")

			const diff2 = await service.getDiff({ to: commit2!.commit })
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
			const newFile = path.join(service.baseDir, "new.txt")
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
			const fileToDelete = path.join(service.baseDir, "new.txt")
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

	describe("saveCheckpoint", () => {
		it("creates a checkpoint if there are pending changes", async () => {
			await fs.writeFile(testFile, "Ahoy, world!")
			const commit1 = await service.saveCheckpoint("First checkpoint")
			expect(commit1?.commit).toBeTruthy()
			const details1 = await git.show([commit1!.commit])
			expect(details1).toContain("-Hello, world!")
			expect(details1).toContain("+Ahoy, world!")

			await fs.writeFile(testFile, "Hola, world!")
			const commit2 = await service.saveCheckpoint("Second checkpoint")
			expect(commit2?.commit).toBeTruthy()
			const details2 = await git.show([commit2!.commit])
			expect(details2).toContain("-Hello, world!")
			expect(details2).toContain("+Hola, world!")

			// Switch to checkpoint 1.
			await service.restoreCheckpoint(commit1!.commit)
			expect(await fs.readFile(testFile, "utf-8")).toBe("Ahoy, world!")

			// Switch to checkpoint 2.
			await service.restoreCheckpoint(commit2!.commit)
			expect(await fs.readFile(testFile, "utf-8")).toBe("Hola, world!")

			// Switch back to initial commit.
			await service.restoreCheckpoint(service.baseCommitHash)
			expect(await fs.readFile(testFile, "utf-8")).toBe("Hello, world!")
		})

		it("preserves workspace and index state after saving checkpoint", async () => {
			// Create three files with different states: staged, unstaged, and mixed.
			const unstagedFile = path.join(service.baseDir, "unstaged.txt")
			const stagedFile = path.join(service.baseDir, "staged.txt")
			const mixedFile = path.join(service.baseDir, "mixed.txt")

			await fs.writeFile(unstagedFile, "Initial unstaged")
			await fs.writeFile(stagedFile, "Initial staged")
			await fs.writeFile(mixedFile, "Initial mixed")
			await git.add(["."])
			const result = await git.commit("Add initial files")
			expect(result?.commit).toBeTruthy()

			await fs.writeFile(unstagedFile, "Modified unstaged")

			await fs.writeFile(stagedFile, "Modified staged")
			await git.add([stagedFile])

			await fs.writeFile(mixedFile, "Modified mixed - staged")
			await git.add([mixedFile])
			await fs.writeFile(mixedFile, "Modified mixed - unstaged")

			// Save checkpoint.
			const commit = await service.saveCheckpoint("Test checkpoint")
			expect(commit?.commit).toBeTruthy()

			// Verify workspace state is preserved.
			const status = await git.status()

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
			const stagedDiff = await git.diff(["--cached", "mixed.txt"])
			expect(stagedDiff).toContain("-Initial mixed")
			expect(stagedDiff).toContain("+Modified mixed - staged")

			// Verify unstaged changes (shows working directory changes).
			const unstagedDiff = await git.diff(["mixed.txt"])
			expect(unstagedDiff).toContain("-Modified mixed - staged")
			expect(unstagedDiff).toContain("+Modified mixed - unstaged")
		})

		it("does not create a checkpoint if there are no pending changes", async () => {
			await fs.writeFile(testFile, "Ahoy, world!")
			const commit = await service.saveCheckpoint("First checkpoint")
			expect(commit?.commit).toBeTruthy()

			const commit2 = await service.saveCheckpoint("Second checkpoint")
			expect(commit2?.commit).toBeFalsy()
		})

		it("includes untracked files in checkpoints", async () => {
			// Create an untracked file.
			const untrackedFile = path.join(service.baseDir, "untracked.txt")
			await fs.writeFile(untrackedFile, "I am untracked!")

			// Save a checkpoint with the untracked file.
			const commit1 = await service.saveCheckpoint("Checkpoint with untracked file")
			expect(commit1?.commit).toBeTruthy()

			// Verify the untracked file was included in the checkpoint.
			const details = await git.show([commit1!.commit])
			expect(details).toContain("+I am untracked!")

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

		it("throws if we're on the wrong branch", async () => {
			// Create and switch to a feature branch.
			await git.checkoutBranch("feature", service.mainBranch)

			// Attempt to save checkpoint from feature branch.
			await expect(service.saveCheckpoint("test")).rejects.toThrow(
				`Git branch mismatch: expected '${service.mainBranch}' but found 'feature'`,
			)

			// Attempt to restore checkpoint from feature branch.
			await expect(service.restoreCheckpoint(service.baseCommitHash)).rejects.toThrow(
				`Git branch mismatch: expected '${service.mainBranch}' but found 'feature'`,
			)
		})

		it("cleans up staged files if a commit fails", async () => {
			await fs.writeFile(testFile, "Changed content")

			// Mock git commit to simulate failure.
			jest.spyOn(git, "commit").mockRejectedValue(new Error("Simulated commit failure"))

			// Attempt to save checkpoint.
			await expect(service.saveCheckpoint("test")).rejects.toThrow("Simulated commit failure")

			// Verify files are unstaged.
			const status = await git.status()
			expect(status.staged).toHaveLength(0)
		})

		it("handles file deletions correctly", async () => {
			await fs.writeFile(testFile, "I am tracked!")
			const untrackedFile = path.join(service.baseDir, "new.txt")
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
	})

	describe("create", () => {
		it("initializes a git repository if one does not already exist", async () => {
			const baseDir = path.join(os.tmpdir(), `checkpoint-service-test2-${Date.now()}`)
			await fs.mkdir(baseDir)
			const newTestFile = path.join(baseDir, "test.txt")
			await fs.writeFile(newTestFile, "Hello, world!")

			const newGit = simpleGit(baseDir)
			const initSpy = jest.spyOn(newGit, "init")
			const newService = await CheckpointService.create({ taskId, git: newGit, baseDir, log: () => {} })

			// Ensure the git repository was initialized.
			expect(initSpy).toHaveBeenCalled()

			// Save a checkpoint: Hello, world!
			const commit1 = await newService.saveCheckpoint("Hello, world!")
			expect(commit1?.commit).toBeTruthy()
			expect(await fs.readFile(newTestFile, "utf-8")).toBe("Hello, world!")

			// Restore initial commit; the file should no longer exist.
			await newService.restoreCheckpoint(newService.baseCommitHash)
			await expect(fs.access(newTestFile)).rejects.toThrow()

			// Restore to checkpoint 1; the file should now exist.
			await newService.restoreCheckpoint(commit1!.commit)
			expect(await fs.readFile(newTestFile, "utf-8")).toBe("Hello, world!")

			// Save a new checkpoint: Ahoy, world!
			await fs.writeFile(newTestFile, "Ahoy, world!")
			const commit2 = await newService.saveCheckpoint("Ahoy, world!")
			expect(commit2?.commit).toBeTruthy()
			expect(await fs.readFile(newTestFile, "utf-8")).toBe("Ahoy, world!")

			// Restore "Hello, world!"
			await newService.restoreCheckpoint(commit1!.commit)
			expect(await fs.readFile(newTestFile, "utf-8")).toBe("Hello, world!")

			// Restore "Ahoy, world!"
			await newService.restoreCheckpoint(commit2!.commit)
			expect(await fs.readFile(newTestFile, "utf-8")).toBe("Ahoy, world!")

			// Restore initial commit.
			await newService.restoreCheckpoint(newService.baseCommitHash)
			await expect(fs.access(newTestFile)).rejects.toThrow()

			await fs.rm(newService.baseDir, { recursive: true, force: true })
		})
	})
})
