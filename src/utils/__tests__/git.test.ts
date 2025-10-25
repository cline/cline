import { expect } from "chai"
import { exec } from "child_process"
import { promises as fs } from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { promisify } from "util"
import { checkGitRepo, getGitDiff, getLatestGitCommitHash, getWorkingState, isGitRepository } from "../git"

const execAsync = promisify(exec)

describe("Git Worktree Tests", () => {
	let tempDir: string
	let bareRepoPath: string
	let mainWorktreePath: string
	let featureWorktreePath: string

	beforeEach(async function () {
		this.timeout(10000)

		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-git-test-"))
		bareRepoPath = path.join(tempDir, "repo.git")
		mainWorktreePath = path.join(tempDir, "main")
		featureWorktreePath = path.join(tempDir, "feature")

		await execAsync(`git init --bare "${bareRepoPath}"`)

		await execAsync(`git clone "${bareRepoPath}" "${mainWorktreePath}"`)

		await execAsync("git config user.email 'test@example.com'", { cwd: mainWorktreePath })
		await execAsync("git config user.name 'Test User'", { cwd: mainWorktreePath })

		await fs.writeFile(path.join(mainWorktreePath, "test.txt"), "initial content\n")
		await execAsync("git add test.txt", { cwd: mainWorktreePath })
		await execAsync("git commit -m 'Initial commit'", { cwd: mainWorktreePath })
		await execAsync("git push origin main", { cwd: mainWorktreePath })

		await execAsync(`git worktree add "${featureWorktreePath}" -b feature`, { cwd: mainWorktreePath })
	})

	afterEach(async function () {
		this.timeout(10000)

		try {
			if (tempDir) {
				await fs.rm(tempDir, { recursive: true, force: true })
			}
		} catch (error) {
			console.error("Error cleaning up temp directory:", error)
		}
	})

	describe("checkGitRepo", () => {
		it("should detect main worktree as git repository", async () => {
			const result = await checkGitRepo(mainWorktreePath)
			expect(result).to.be.true
		})

		it("should detect feature worktree as git repository", async () => {
			const result = await checkGitRepo(featureWorktreePath)
			expect(result).to.be.true
		})

		it("should detect bare repository as git repository", async () => {
			const result = await checkGitRepo(bareRepoPath)
			expect(result).to.be.true
		})

		it("should return false for non-git directory", async () => {
			const nonGitDir = path.join(tempDir, "not-git")
			await fs.mkdir(nonGitDir)
			const result = await checkGitRepo(nonGitDir)
			expect(result).to.be.false
		})

		it("should detect worktree when cwd is parent directory containing bare repo", async () => {
			const result = await checkGitRepo(tempDir)
			expect(result).to.be.false
		})
	})

	describe("isGitRepository", () => {
		it("should detect main worktree as git repository", async () => {
			const result = await isGitRepository(mainWorktreePath)
			expect(result).to.be.true
		})

		it("should detect feature worktree as git repository", async () => {
			const result = await isGitRepository(featureWorktreePath)
			expect(result).to.be.true
		})

		it("should detect bare repository as git repository", async () => {
			const result = await isGitRepository(bareRepoPath)
			expect(result).to.be.true
		})

		it("should return false for non-git directory", async () => {
			const nonGitDir = path.join(tempDir, "not-git")
			await fs.mkdir(nonGitDir)
			const result = await isGitRepository(nonGitDir)
			expect(result).to.be.false
		})
	})

	describe("getGitDiff", () => {
		it("should get diff from main worktree", async () => {
			await fs.writeFile(path.join(mainWorktreePath, "test.txt"), "modified content\n")
			await execAsync("git add test.txt", { cwd: mainWorktreePath })

			const diff = await getGitDiff(mainWorktreePath, true)
			expect(diff).to.include("test.txt")
			expect(diff).to.include("modified content")
		})

		it("should get diff from feature worktree", async () => {
			await fs.writeFile(path.join(featureWorktreePath, "feature.txt"), "feature content\n")
			await execAsync("git add feature.txt", { cwd: featureWorktreePath })

			const diff = await getGitDiff(featureWorktreePath, true)
			expect(diff).to.include("feature.txt")
			expect(diff).to.include("feature content")
		})

		it("should throw error when no changes exist", async () => {
			try {
				await getGitDiff(mainWorktreePath, true)
				expect.fail("Should have thrown error")
			} catch (error) {
				expect((error as Error).message).to.include("No changes in workspace")
			}
		})

		it("should get unstaged diff when stagedOnly is false", async () => {
			await fs.writeFile(path.join(mainWorktreePath, "test.txt"), "unstaged content\n")

			const diff = await getGitDiff(mainWorktreePath, false)
			expect(diff).to.include("test.txt")
			expect(diff).to.include("unstaged content")
		})
	})

	describe("getWorkingState", () => {
		it("should detect changes in main worktree", async () => {
			await fs.writeFile(path.join(mainWorktreePath, "new-file.txt"), "new content\n")

			const state = await getWorkingState(mainWorktreePath)
			expect(state).to.include("new-file.txt")
		})

		it("should detect changes in feature worktree", async () => {
			await fs.writeFile(path.join(featureWorktreePath, "feature-file.txt"), "feature content\n")

			const state = await getWorkingState(featureWorktreePath)
			expect(state).to.include("feature-file.txt")
		})

		it("should return 'No changes' when working directory is clean", async () => {
			const state = await getWorkingState(mainWorktreePath)
			expect(state).to.equal("No changes in working directory")
		})

		it("should handle new repository with no commits", async () => {
			const newRepoPath = path.join(tempDir, "new-repo")
			await fs.mkdir(newRepoPath)
			await execAsync(`git init "${newRepoPath}"`)
			await fs.writeFile(path.join(newRepoPath, "file.txt"), "content\n")

			const state = await getWorkingState(newRepoPath)
			expect(state).to.include("new repository")
			expect(state).to.include("file.txt")
		})
	})

	describe("getLatestGitCommitHash", () => {
		it("should get commit hash from main worktree", async () => {
			const hash = await getLatestGitCommitHash(mainWorktreePath)
			expect(hash).to.be.a("string")
			expect(hash).to.have.lengthOf(40)
		})

		it("should get commit hash from feature worktree", async () => {
			const hash = await getLatestGitCommitHash(featureWorktreePath)
			expect(hash).to.be.a("string")
			expect(hash).to.have.lengthOf(40)
		})

		it("should return null for non-git directory", async () => {
			const nonGitDir = path.join(tempDir, "not-git")
			await fs.mkdir(nonGitDir)
			const hash = await getLatestGitCommitHash(nonGitDir)
			expect(hash).to.be.null
		})

		it("should return same hash for main and feature worktree initially", async () => {
			const mainHash = await getLatestGitCommitHash(mainWorktreePath)
			const featureHash = await getLatestGitCommitHash(featureWorktreePath)
			expect(mainHash).to.equal(featureHash)
		})

		it("should return different hash after commit in feature worktree", async () => {
			const mainHashBefore = await getLatestGitCommitHash(mainWorktreePath)

			await fs.writeFile(path.join(featureWorktreePath, "feature.txt"), "feature content\n")
			await execAsync("git add feature.txt", { cwd: featureWorktreePath })
			await execAsync("git config user.email 'test@example.com'", { cwd: featureWorktreePath })
			await execAsync("git config user.name 'Test User'", { cwd: featureWorktreePath })
			await execAsync("git commit -m 'Add feature'", { cwd: featureWorktreePath })

			const mainHashAfter = await getLatestGitCommitHash(mainWorktreePath)
			const featureHash = await getLatestGitCommitHash(featureWorktreePath)

			expect(mainHashBefore).to.equal(mainHashAfter)
			expect(featureHash).to.not.equal(mainHashAfter)
		})
	})

	describe("Worktree-specific scenarios", () => {
		it("should handle worktree when parent directory contains bare repo", async () => {
			const parentContainingBare = tempDir
			const result = await isGitRepository(parentContainingBare)
			expect(result).to.be.false
		})

		it("should work with nested worktree paths", async () => {
			const nestedPath = path.join(tempDir, "nested", "worktree")
			await fs.mkdir(path.join(tempDir, "nested"), { recursive: true })
			await execAsync(`git worktree add "${nestedPath}" -b nested-branch`, { cwd: mainWorktreePath })

			const result = await isGitRepository(nestedPath)
			expect(result).to.be.true

			const diff = await getGitDiff(nestedPath, false).catch(() => "no changes")
			expect(diff).to.be.a("string")
		})

		it("should handle subdirectories within a worktree", async () => {
			const subdir = path.join(featureWorktreePath, "subdir")
			await fs.mkdir(subdir)

			const result = await isGitRepository(subdir)
			expect(result).to.be.true

			await fs.writeFile(path.join(subdir, "file.txt"), "content\n")
			const state = await getWorkingState(featureWorktreePath)
			expect(state).to.include("subdir")
		})

		it("should handle multiple worktrees from same bare repo", async () => {
			const secondFeaturePath = path.join(tempDir, "feature2")
			await execAsync(`git worktree add "${secondFeaturePath}" -b feature2`, { cwd: mainWorktreePath })

			const mainResult = await isGitRepository(mainWorktreePath)
			const feature1Result = await isGitRepository(featureWorktreePath)
			const feature2Result = await isGitRepository(secondFeaturePath)

			expect(mainResult).to.be.true
			expect(feature1Result).to.be.true
			expect(feature2Result).to.be.true
		})
	})
})
