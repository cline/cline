// npx jest src/services/checkpoints/__tests__/LocalCheckpointService.test.ts

import fs from "fs/promises"
import path from "path"
import os from "os"

import { simpleGit, SimpleGit } from "simple-git"

import { CheckpointServiceFactory } from "../CheckpointServiceFactory"
import { LocalCheckpointService } from "../LocalCheckpointService"

const tmpDir = path.join(os.tmpdir(), "test-LocalCheckpointService")

describe("LocalCheckpointService", () => {
	const taskId = "test-task"

	let testFile: string
	let service: LocalCheckpointService

	const initRepo = async ({
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

		return { testFile }
	}

	beforeEach(async () => {
		const workspaceDir = path.join(tmpDir, `checkpoint-service-test-${Date.now()}`)
		const repo = await initRepo({ workspaceDir })

		testFile = repo.testFile
		service = await CheckpointServiceFactory.create({
			strategy: "local",
			options: { taskId, workspaceDir, log: () => {} },
		})
	})

	afterEach(async () => {
		jest.restoreAllMocks()
	})

	afterAll(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
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

	describe("saveCheckpoint", () => {
		it("creates a checkpoint if there are pending changes", async () => {
			await fs.writeFile(testFile, "Ahoy, world!")
			const commit1 = await service.saveCheckpoint("First checkpoint")
			expect(commit1?.commit).toBeTruthy()
			const details1 = await service.git.show([commit1!.commit])
			expect(details1).toContain("-Hello, world!")
			expect(details1).toContain("+Ahoy, world!")

			await fs.writeFile(testFile, "Hola, world!")
			const commit2 = await service.saveCheckpoint("Second checkpoint")
			expect(commit2?.commit).toBeTruthy()
			const details2 = await service.git.show([commit2!.commit])
			expect(details2).toContain("-Hello, world!")
			expect(details2).toContain("+Hola, world!")

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
			await service.git.add(["."])
			const result = await service.git.commit("Add initial files")
			expect(result?.commit).toBeTruthy()

			await fs.writeFile(unstagedFile, "Modified unstaged")

			await fs.writeFile(stagedFile, "Modified staged")
			await service.git.add([stagedFile])

			await fs.writeFile(mixedFile, "Modified mixed - staged")
			await service.git.add([mixedFile])
			await fs.writeFile(mixedFile, "Modified mixed - unstaged")

			// Save checkpoint.
			const commit = await service.saveCheckpoint("Test checkpoint")
			expect(commit?.commit).toBeTruthy()

			// Verify workspace state is preserved.
			const status = await service.git.status()

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
			const stagedDiff = await service.git.diff(["--cached", "mixed.txt"])
			expect(stagedDiff).toContain("-Initial mixed")
			expect(stagedDiff).toContain("+Modified mixed - staged")

			// Verify unstaged changes (shows working directory changes).
			const unstagedDiff = await service.git.diff(["mixed.txt"])
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
			const details = await service.git.show([commit1!.commit])
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
			const currentBranch = await service.git.revparse(["--abbrev-ref", "HEAD"])
			await service.git.checkoutBranch("feature", currentBranch)

			// Attempt to save checkpoint from feature branch.
			await expect(service.saveCheckpoint("test")).rejects.toThrow(
				`Git branch mismatch: expected '${currentBranch}' but found 'feature'`,
			)

			// Attempt to restore checkpoint from feature branch.
			expect(service.baseHash).toBeTruthy()

			await expect(service.restoreCheckpoint(service.baseHash!)).rejects.toThrow(
				`Git branch mismatch: expected '${currentBranch}' but found 'feature'`,
			)
		})

		it("cleans up staged files if a commit fails", async () => {
			await fs.writeFile(testFile, "Changed content")

			// Mock git commit to simulate failure.
			jest.spyOn(service.git, "commit").mockRejectedValue(new Error("Simulated commit failure"))

			// Attempt to save checkpoint.
			await expect(service.saveCheckpoint("test")).rejects.toThrow("Simulated commit failure")

			// Verify files are unstaged.
			const status = await service.git.status()
			expect(status.staged).toHaveLength(0)
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
	})

	describe("create", () => {
		it("initializes a git repository if one does not already exist", async () => {
			const workspaceDir = path.join(tmpDir, `checkpoint-service-test2-${Date.now()}`)
			await fs.mkdir(workspaceDir)
			const newTestFile = path.join(workspaceDir, "test.txt")
			await fs.writeFile(newTestFile, "Hello, world!")

			// Ensure the git repository was initialized.
			const gitDir = path.join(workspaceDir, ".git")
			await expect(fs.stat(gitDir)).rejects.toThrow()
			const newService = await LocalCheckpointService.create({ taskId, workspaceDir, log: () => {} })
			expect(await fs.stat(gitDir)).toBeTruthy()

			// Save a checkpoint: Hello, world!
			const commit1 = await newService.saveCheckpoint("Hello, world!")
			expect(commit1?.commit).toBeTruthy()
			expect(await fs.readFile(newTestFile, "utf-8")).toBe("Hello, world!")

			// Restore initial commit; the file should no longer exist.
			expect(newService.baseHash).toBeTruthy()
			await newService.restoreCheckpoint(newService.baseHash!)
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
			expect(newService.baseHash).toBeTruthy()
			await newService.restoreCheckpoint(newService.baseHash!)
			await expect(fs.access(newTestFile)).rejects.toThrow()

			await fs.rm(newService.workspaceDir, { recursive: true, force: true })
		})

		it("respects existing git user configuration", async () => {
			const workspaceDir = path.join(tmpDir, `checkpoint-service-test-config2-${Date.now()}`)
			const userName = "Custom User"
			const userEmail = "custom@example.com"
			await initRepo({ workspaceDir, userName, userEmail })

			const newService = await LocalCheckpointService.create({ taskId, workspaceDir, log: () => {} })

			expect((await newService.git.getConfig("user.name")).value).toBe(userName)
			expect((await newService.git.getConfig("user.email")).value).toBe(userEmail)

			await fs.rm(workspaceDir, { recursive: true, force: true })
		})
	})
})
