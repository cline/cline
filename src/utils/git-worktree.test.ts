import { execSync } from "node:child_process"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { after, before, describe, it } from "mocha"
import "should"
import { createTaskWorktree, getTaskWorktreesHomePath } from "./git-worktree"

/**
 * Tests for createTaskWorktree — the shared helper any surface (CLI, VS Code,
 * JetBrains) can use to auto-provision a worktree under ~/.cline/worktrees/.
 *
 * We override $HOME for the duration of these tests so we never touch the
 * user's real ~/.cline/worktrees directory.
 */
describe("createTaskWorktree", () => {
	const sandboxRoot = path.join(os.tmpdir(), `cline-create-task-wt-${Math.random().toString(36).slice(2)}`)
	const fakeHome = path.join(sandboxRoot, "home")
	const repoPath = path.join(sandboxRoot, "myrepo")
	const nonRepoPath = path.join(sandboxRoot, "not-a-repo")
	let originalHome: string | undefined

	before(async () => {
		await fs.mkdir(fakeHome, { recursive: true })
		await fs.mkdir(repoPath, { recursive: true })
		await fs.mkdir(nonRepoPath, { recursive: true })

		// Minimal git repo with one commit so HEAD resolves.
		execSync("git init -q -b main", { cwd: repoPath })
		await fs.writeFile(path.join(repoPath, "file.txt"), "hello")
		execSync("git add .", { cwd: repoPath })
		execSync('git -c user.email=test@example.com -c user.name=Test commit -q -m "init"', { cwd: repoPath })

		originalHome = process.env.HOME
		process.env.HOME = fakeHome
	})

	after(async () => {
		if (originalHome !== undefined) {
			process.env.HOME = originalHome
		} else {
			delete process.env.HOME
		}
		await fs.rm(sandboxRoot, { recursive: true, force: true })
	})

	it("places the home path under ~/.cline/worktrees", () => {
		getTaskWorktreesHomePath().should.equal(path.join(fakeHome, ".cline", "worktrees"))
	})

	it("creates a detached worktree at ~/.cline/worktrees/<taskId>/<repoName>", async () => {
		const result = await createTaskWorktree({ cwd: repoPath, taskId: "my-task" })

		result.success.should.equal(true, `expected success but got: ${result.message}`)
		result.taskId!.should.equal("my-task")
		result.path!.should.equal(path.join(fakeHome, ".cline", "worktrees", "my-task", "myrepo"))
		// repoRoot points back at the source checkout so callers can surface it in UI.
		result.repoRoot!.should.equal(repoPath)

		// Worktree directory exists and is a git worktree.
		const stat = await fs.stat(result.path!)
		stat.isDirectory().should.equal(true)
		execSync("git rev-parse --is-inside-work-tree", { cwd: result.path! }).toString().trim().should.equal("true")

		// HEAD is detached at the same commit as the source repo.
		const sourceHead = execSync("git rev-parse HEAD", { cwd: repoPath }).toString().trim()
		const worktreeHead = execSync("git rev-parse HEAD", { cwd: result.path! }).toString().trim()
		worktreeHead.should.equal(sourceHead)
	})

	it("generates a uuid taskId when none is provided", async () => {
		const result = await createTaskWorktree({ cwd: repoPath })
		result.success.should.equal(true, `expected success but got: ${result.message}`)
		// Default is a uuid v4 (8-4-4-4-12 hex segments).
		result.taskId!.should.match(/^[0-9a-f-]{36}$/i)
	})

	it("rejects when cwd is not a git repository", async () => {
		const result = await createTaskWorktree({ cwd: nonRepoPath })
		result.success.should.equal(false)
		result.message.should.match(/Not a git repository/)
	})

	it("rejects unsafe taskIds (path traversal)", async () => {
		const result = await createTaskWorktree({ cwd: repoPath, taskId: "../escape" })
		result.success.should.equal(false)
		result.message.should.match(/Invalid worktree id/)
	})

	it("rejects taskIds containing a null byte", async () => {
		// A null byte could otherwise sneak past the `..` substring check on some kernels.
		const result = await createTaskWorktree({ cwd: repoPath, taskId: "safe\0../escape" })
		result.success.should.equal(false)
		result.message.should.match(/Invalid worktree id/)
	})
})
