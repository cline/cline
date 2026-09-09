import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import type { SidecarContext } from "./types";

let sandbox: string;
let repo: string;

function git(cwd: string, ...args: string[]): string {
	return execFileSync(
		"git",
		["-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
		{ cwd, encoding: "utf8" },
	).trim();
}

beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "cline-worktree-"));
	repo = join(sandbox, "my-app");
	git(sandbox, "init", "-q", "-b", "main", repo);
	git(repo, "commit", "-q", "--allow-empty", "-m", "init");
	vi.stubEnv("CLINE_DIR", join(sandbox, "cline-dir"));
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(sandbox, { recursive: true, force: true });
});

async function run(cwd: string) {
	return (await handleCommand(
		{ workspaceRoot: cwd } as unknown as SidecarContext,
		"create_git_worktree",
		{ cwd },
	)) as { path: string; branch: string };
}

describe("create_git_worktree command", () => {
	it("creates a worktree on a new branch under ~/.cline/worktrees/<id>/<repo>", async () => {
		const result = await run(repo);

		expect(
			result.path.startsWith(join(sandbox, "cline-dir", "worktrees")),
		).toBe(true);
		expect(result.path.endsWith(join("my-app"))).toBe(true);
		expect(result.branch).toMatch(/^cline\/[0-9a-f]{5}$/);
		expect(existsSync(join(result.path, ".git"))).toBe(true);
		expect(git(result.path, "branch", "--show-current")).toBe(result.branch);
		// The original checkout is untouched.
		expect(git(repo, "branch", "--show-current")).toBe("main");
		expect(git(repo, "worktree", "list")).toContain(result.path);
	});

	it("resolves the repo root from a nested cwd", async () => {
		const nested = join(repo, "src", "deep");
		mkdirSync(nested, { recursive: true });

		const result = await run(nested);

		expect(result.path.endsWith("my-app")).toBe(true);
		expect(git(repo, "worktree", "list")).toContain(result.path);
	});

	it("rejects a folder that is not a git repository", async () => {
		const plain = join(sandbox, "plain");
		mkdirSync(plain, { recursive: true });

		await expect(run(plain)).rejects.toThrow("Not a git repository");
	});
});
