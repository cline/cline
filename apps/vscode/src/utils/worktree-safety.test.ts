import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import simpleGit from "simple-git"
import { getManagedWorktreeRoot, inspectWorktreeMutation } from "./worktree-safety"

describe("worktree mutation safety", () => {
	let repositoryRoot = ""

	afterAll(async () => {
		if (repositoryRoot) {
			await rm(repositoryRoot, { recursive: true, force: true })
		}
	})

	test("allows a reviewed managed creation and rejects deletion of the repository root", async () => {
		repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "cline-worktree-safety-"))
		const git = simpleGit(repositoryRoot)
		await git.init()
		await git.addConfig("user.name", "Cline Test")
		await git.addConfig("user.email", "cline-test@example.invalid")
		await writeFile(path.join(repositoryRoot, "README.md"), "test\n")
		await git.add("README.md")
		await git.commit("initial")

		const managedPath = path.join(getManagedWorktreeRoot(repositoryRoot), "task-001")
		const creation = await inspectWorktreeMutation(repositoryRoot, {
			operation: "create",
			worktreePath: managedPath,
			branch: "team/task-001",
			baseBranch: "HEAD",
			createNewBranch: true,
			affectedTaskId: "task_0001",
			affectedAgentId: "agent-1",
		})

		expect(creation.allowed).toBe(true)
		expect(creation.repositoryRoot).toBe(repositoryRoot)
		expect(creation.gitOperation).toEqual([
			"git",
			"worktree",
			"add",
			"-b",
			"team/task-001",
			path.resolve(managedPath),
			"HEAD",
		])
		expect(creation.affectedTaskId).toBe("task_0001")
		expect(creation.affectedAgentId).toBe("agent-1")

		const unsafeDeletion = await inspectWorktreeMutation(repositoryRoot, {
			operation: "delete",
			worktreePath: repositoryRoot,
		})
		expect(unsafeDeletion.allowed).toBe(false)
		expect(unsafeDeletion.reason).toContain("repository root")
	})
})
