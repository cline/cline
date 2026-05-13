import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { setClineDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskWorktree, getTaskWorktreesHomePath } from "./worktree";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

describe("createTaskWorktree", () => {
	let sandboxRoot: string;
	let clineDir: string;
	let repoPath: string;
	let nonRepoPath: string;
	let originalClineDir: string | undefined;

	beforeEach(async () => {
		sandboxRoot = await mkdtemp(path.join(tmpdir(), "cline-sdk-worktree-"));
		clineDir = path.join(sandboxRoot, ".cline");
		repoPath = path.join(sandboxRoot, "myrepo");
		nonRepoPath = path.join(sandboxRoot, "not-a-repo");
		originalClineDir = process.env.CLINE_DIR;
		process.env.CLINE_DIR = clineDir;
		setClineDir(clineDir);

		await writeFile(path.join(sandboxRoot, ".keep"), "");
		await rm(repoPath, { recursive: true, force: true });
		await rm(nonRepoPath, { recursive: true, force: true });
		await mkdir(repoPath, { recursive: true });
		await mkdir(nonRepoPath, { recursive: true });

		git(repoPath, ["init", "-q", "-b", "main"]);
		await writeFile(path.join(repoPath, "file.txt"), "hello");
		git(repoPath, ["add", "."]);
		git(repoPath, [
			"-c",
			"user.email=test@example.com",
			"-c",
			"user.name=Test",
			"commit",
			"-q",
			"-m",
			"init",
		]);
	});

	afterEach(async () => {
		if (originalClineDir === undefined) {
			delete process.env.CLINE_DIR;
		} else {
			process.env.CLINE_DIR = originalClineDir;
		}
		setClineDir(originalClineDir ?? path.join("~", ".cline"));
		await rm(sandboxRoot, { recursive: true, force: true });
	});

	it("places worktrees under ~/.cline/worktrees", () => {
		expect(getTaskWorktreesHomePath()).toBe(path.join(clineDir, "worktrees"));
	});

	it("creates a detached worktree at ~/.cline/worktrees/<taskId>/<repoName>", async () => {
		const result = await createTaskWorktree({
			cwd: repoPath,
			taskId: "my-task",
		});

		expect(result.success).toBe(true);
		expect(result.taskId).toBe("my-task");
		expect(result.repoRoot).toBeDefined();
		expect(result.path).toBeDefined();
		if (!result.repoRoot || !result.path) {
			throw new Error("Expected worktree result to include repoRoot and path.");
		}
		const worktreePath = result.path;

		expect(await realpath(result.repoRoot)).toBe(await realpath(repoPath));
		expect(result.path).toBe(
			path.join(clineDir, "worktrees", "my-task", "myrepo"),
		);
		expect(git(worktreePath, ["rev-parse", "--is-inside-work-tree"])).toBe(
			"true",
		);
		expect(git(worktreePath, ["rev-parse", "HEAD"])).toBe(
			git(repoPath, ["rev-parse", "HEAD"]),
		);
		expect(git(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
			"HEAD",
		);
	});

	it("generates a Kanban-style short taskId when none is provided", async () => {
		const result = await createTaskWorktree({ cwd: repoPath });

		expect(result.success).toBe(true);
		expect(result.taskId).toMatch(/^[0-9a-f]{5}$/i);
		expect(result.taskId).toBeDefined();
		if (!result.taskId) {
			throw new Error("Expected generated taskId.");
		}
		expect(result.path).toBe(
			path.join(clineDir, "worktrees", result.taskId, "myrepo"),
		);
	});

	it("rejects when cwd is not a git repository", async () => {
		const result = await createTaskWorktree({ cwd: nonRepoPath });

		expect(result.success).toBe(false);
		expect(result.message).toMatch(/Not a git repository/);
	});

	it("rejects unsafe taskIds", async () => {
		const traversal = await createTaskWorktree({
			cwd: repoPath,
			taskId: "../escape",
		});
		const nullByte = await createTaskWorktree({
			cwd: repoPath,
			taskId: "safe\0../escape",
		});

		expect(traversal.success).toBe(false);
		expect(traversal.message).toMatch(/Invalid worktree id/);
		expect(nullByte.success).toBe(false);
		expect(nullByte.message).toMatch(/Invalid worktree id/);
	});
});
