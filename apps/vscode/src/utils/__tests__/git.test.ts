import { afterEach, beforeEach, describe, it } from "bun:test"
import { exec } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import "should"
import { getGitDiff } from "../git"

const execAsync = promisify(exec)

describe("getGitDiff", () => {
	let repoDir: string

	async function git(args: string): Promise<void> {
		await execAsync(`git ${args}`, { cwd: repoDir })
	}

	beforeEach(async () => {
		repoDir = await mkdtemp(path.join(tmpdir(), "cline-git-diff-"))
		await git("init")
		await git('config user.email "test@example.com"')
		await git('config user.name "Test"')
	})

	afterEach(async () => {
		await rm(repoDir, { recursive: true, force: true })
	})

	it("includes untracked files when nothing is staged (add-only working tree)", async () => {
		// Reproduces #12060: a brand-new file that has never been staged is
		// invisible to `git diff` and `git diff --staged`, so commit-message
		// generation used to fail with "No changes in workspace for commit message".
		await writeFile(path.join(repoDir, "new-file.txt"), "hello from an untracked file\n")

		const diff = await getGitDiff(repoDir, false)

		diff.should.match(/new-file\.txt/)
		diff.should.match(/hello from an untracked file/)
	})

	it("includes untracked files alongside an existing commit", async () => {
		await writeFile(path.join(repoDir, "tracked.txt"), "tracked\n")
		await git("add tracked.txt")
		await git('commit -m "initial"')
		await writeFile(path.join(repoDir, "untracked.txt"), "brand new\n")

		const diff = await getGitDiff(repoDir, false)

		diff.should.match(/untracked\.txt/)
		diff.should.match(/brand new/)
	})

	it("handles untracked filenames with spaces and shell metacharacters", async () => {
		// The filename is passed as a separate argv entry (no shell), so a name
		// containing spaces and `$` must not break the diff or execute anything.
		const trickyName = "a file with $VAR and spaces.txt"
		await writeFile(path.join(repoDir, trickyName), "content of the tricky file\n")

		const diff = await getGitDiff(repoDir, false)

		diff.should.match(/content of the tricky file/)
	})

	it("includes both a tracked unstaged edit and an untracked file", async () => {
		// A modified tracked file makes `git diff HEAD` non-empty; the new file must
		// still be appended so the commit message covers the whole working tree.
		await writeFile(path.join(repoDir, "tracked.txt"), "original\n")
		await git("add tracked.txt")
		await git('commit -m "initial"')
		await writeFile(path.join(repoDir, "tracked.txt"), "original\nmodified line\n")
		await writeFile(path.join(repoDir, "brand-new.txt"), "the new file\n")

		const diff = await getGitDiff(repoDir, false)

		diff.should.match(/modified line/)
		diff.should.match(/brand-new\.txt/)
		diff.should.match(/the new file/)
	})

	it("prefers staged changes over untracked files", async () => {
		await writeFile(path.join(repoDir, "staged.txt"), "staged content\n")
		await git("add staged.txt")
		await writeFile(path.join(repoDir, "untracked.txt"), "untracked content\n")

		const diff = await getGitDiff(repoDir, true)

		diff.should.match(/staged\.txt/)
		diff.should.not.match(/untracked\.txt/)
	})

	it("throws when there are no changes at all", async () => {
		await writeFile(path.join(repoDir, "committed.txt"), "done\n")
		await git("add committed.txt")
		await git('commit -m "only commit"')

		let error: Error | undefined
		try {
			await getGitDiff(repoDir, false)
		} catch (e) {
			error = e as Error
		}
		;(error !== undefined).should.be.true()
		error!.message.should.equal("No changes in workspace for commit message")
	})
})
