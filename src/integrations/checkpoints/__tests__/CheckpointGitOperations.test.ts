import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { GitOperations, GIT_DISABLED_SUFFIX } from "../CheckpointGitOperations"

describe("GitOperations", () => {
	let tmpDir: string
	let gitOps: GitOperations

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-git-ops-test-"))
		gitOps = new GitOperations(tmpDir)
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	describe("renameNestedGitRepos", () => {
		it("should disable nested .git directories by adding suffix", async () => {
			const nestedGit = path.join(tmpDir, "subproject", ".git")
			await fs.mkdir(nestedGit, { recursive: true })

			await gitOps.renameNestedGitRepos(true)

			const disabledExists = await fs.stat(nestedGit + GIT_DISABLED_SUFFIX).then(() => true).catch(() => false)
			const originalExists = await fs.stat(nestedGit).then(() => true).catch(() => false)
			expect(disabledExists).to.equal(true)
			expect(originalExists).to.equal(false)
		})

		it("should re-enable disabled nested .git directories by removing suffix", async () => {
			const nestedGitDisabled = path.join(tmpDir, "subproject", ".git" + GIT_DISABLED_SUFFIX)
			await fs.mkdir(nestedGitDisabled, { recursive: true })

			await gitOps.renameNestedGitRepos(false)

			const restoredExists = await fs.stat(path.join(tmpDir, "subproject", ".git")).then(() => true).catch(() => false)
			const disabledExists = await fs.stat(nestedGitDisabled).then(() => true).catch(() => false)
			expect(restoredExists).to.equal(true)
			expect(disabledExists).to.equal(false)
		})

		it("should not touch root .git directory when disabling", async () => {
			const rootGit = path.join(tmpDir, ".git")
			await fs.mkdir(rootGit, { recursive: true })

			await gitOps.renameNestedGitRepos(true)

			const rootExists = await fs.stat(rootGit).then(() => true).catch(() => false)
			const rootDisabledExists = await fs.stat(rootGit + GIT_DISABLED_SUFFIX).then(() => true).catch(() => false)
			expect(rootExists).to.equal(true)
			expect(rootDisabledExists).to.equal(false)
		})

		it("should not touch root .git_disabled directory when re-enabling (#9286)", async () => {
			// This is the core bug: if root .git was somehow renamed to .git_disabled
			// (e.g. by another Cline instance treating this dir as nested),
			// renameNestedGitRepos(false) should NOT process it — only nested dirs.
			const rootGitDisabled = path.join(tmpDir, ".git" + GIT_DISABLED_SUFFIX)
			await fs.mkdir(rootGitDisabled, { recursive: true })

			// Also add a nested one that SHOULD be restored
			const nestedGitDisabled = path.join(tmpDir, "sub", ".git" + GIT_DISABLED_SUFFIX)
			await fs.mkdir(nestedGitDisabled, { recursive: true })

			await gitOps.renameNestedGitRepos(false)

			// Root .git_disabled must remain untouched
			const rootDisabledStillExists = await fs.stat(rootGitDisabled).then(() => true).catch(() => false)
			expect(rootDisabledStillExists).to.equal(true, "root .git_disabled should not be renamed")

			// Root .git should NOT have been created
			const rootGitExists = await fs.stat(path.join(tmpDir, ".git")).then(() => true).catch(() => false)
			expect(rootGitExists).to.equal(false, "root .git should not be created by restore")

			// Nested .git_disabled SHOULD be restored
			const nestedRestoredExists = await fs.stat(path.join(tmpDir, "sub", ".git")).then(() => true).catch(() => false)
			expect(nestedRestoredExists).to.equal(true, "nested .git should be restored")
		})

		it("should handle deeply nested .git directories", async () => {
			const deepGit = path.join(tmpDir, "a", "b", "c", ".git")
			await fs.mkdir(deepGit, { recursive: true })

			await gitOps.renameNestedGitRepos(true)

			const disabledExists = await fs.stat(deepGit + GIT_DISABLED_SUFFIX).then(() => true).catch(() => false)
			expect(disabledExists).to.equal(true)

			await gitOps.renameNestedGitRepos(false)

			const restoredExists = await fs.stat(deepGit).then(() => true).catch(() => false)
			expect(restoredExists).to.equal(true)
		})
	})

	describe("addCheckpointFiles - recovery on startup", () => {
		it("should recover leftover .git_disabled dirs from a previous crash before disabling", async () => {
			const nestedDir = path.join(tmpDir, "nested-project")
			const disabledGit = path.join(nestedDir, ".git" + GIT_DISABLED_SUFFIX)
			await fs.mkdir(disabledGit, { recursive: true })

			const beforeExists = await fs.stat(disabledGit).then(() => true).catch(() => false)
			expect(beforeExists).to.equal(true)

			try {
				const simpleGit = (await import("simple-git")).default
				const git = simpleGit(tmpDir)
				await git.init()
				await git.addConfig("user.name", "test")
				await git.addConfig("user.email", "test@test.com")
				await gitOps.addCheckpointFiles(git)
			} catch {
				// Expected to fail - no proper shadow git setup
			}

			// After addCheckpointFiles (success or failure), .git_disabled should be restored to .git
			const restoredExists = await fs.stat(path.join(nestedDir, ".git")).then(() => true).catch(() => false)
			expect(restoredExists).to.equal(true)
		})
	})
})
