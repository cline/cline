// npx jest src/integrations/checkpoints/__tests__/LocalCheckpointer.test.ts

import fs from "fs/promises"
import path from "path"
import os from "os"

import { CommitResult, simpleGit, SimpleGit } from "simple-git"

import { LocalCheckpointer } from "../LocalCheckpointer"

describe("LocalCheckpointer", () => {
	let checkpointer: LocalCheckpointer
	let tempDir: string
	let git: SimpleGit
	let testFile: string
	let initialCommit: CommitResult

	beforeEach(async () => {
		// Create a temporary directory for testing.
		tempDir = path.join(os.tmpdir(), `checkpointer-test-${Date.now()}`)
		await fs.mkdir(tempDir)
		console.log(tempDir)

		// Initialize git repo.
		git = simpleGit(tempDir)
		await git.init()
		await git.addConfig("user.name", "Roo Code")
		await git.addConfig("user.email", "support@roo.vet")

		// Create test file.
		testFile = path.join(tempDir, "test.txt")
		await fs.writeFile(testFile, "Hello, world!")

		// Create initial commit.
		await git.add(".")
		initialCommit = await git.commit("Initial commit")!

		// Create checkpointer instance.
		checkpointer = await LocalCheckpointer.create({
			workspacePath: tempDir,
			mainBranch: "main",
			hiddenBranch: "checkpoints",
		})
	})

	afterEach(async () => {
		// Clean up temporary directory.
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("creates a hidden branch on initialization", async () => {
		const branches = await git.branch()
		expect(branches.all).toContain("checkpoints")
	})

	it("saves and lists checkpoints", async () => {
		const commitMessage = "Test checkpoint"

		await fs.writeFile(testFile, "Ahoy, world!")
		const commit = await checkpointer.saveCheckpoint(commitMessage)
		expect(commit?.commit).toBeTruthy()

		const checkpoints = await checkpointer.listCheckpoints()
		expect(checkpoints.length).toBeGreaterThan(0)
		expect(checkpoints[0].message).toBe(commitMessage)
		expect(checkpoints[0].hash).toBe(commit?.commit)
	})

	it("saves and restores checkpoints", async () => {
		await fs.writeFile(testFile, "Ahoy, world!")
		const commit1 = await checkpointer.saveCheckpoint("First checkpoint")
		expect(commit1?.commit).toBeTruthy()
		const details1 = await git.show([commit1!.commit])
		expect(details1).toContain("-Hello, world!")
		expect(details1).toContain("+Ahoy, world!")

		await fs.writeFile(testFile, "Hola, world!")
		const commit2 = await checkpointer.saveCheckpoint("Second checkpoint")
		expect(commit2?.commit).toBeTruthy()
		const details2 = await git.show([commit2!.commit])
		console.log(details2)
		expect(details2).toContain("-Hello, world!")
		expect(details2).toContain("+Hola, world!")

		// Switch to checkpoint 1.
		await checkpointer.restoreCheckpoint(commit1!.commit)
		expect(await fs.readFile(testFile, "utf-8")).toBe("Ahoy, world!")

		// Switch to checkpoint 2.
		await checkpointer.restoreCheckpoint(commit2!.commit)
		expect(await fs.readFile(testFile, "utf-8")).toBe("Hola, world!")

		// Switch back to initial commit.
		await checkpointer.restoreCheckpoint(initialCommit.commit)
		expect(await fs.readFile(testFile, "utf-8")).toBe("Hello, world!")
	})
})
