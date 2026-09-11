import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SqliteSessionStore } from "@cline/core";
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

describe("remove_git_worktree command", () => {
	const ctx = {
		logger: { log: vi.fn(), error: vi.fn(), debug: vi.fn() },
	} as unknown as SidecarContext;

	it("rolls back a worktree whose session never started", async () => {
		const worktree = await run(repo);

		await handleCommand(ctx, "remove_git_worktree", { path: worktree.path });

		expect(existsSync(dirname(worktree.path))).toBe(false);
		expect(git(repo, "worktree", "list")).not.toContain(worktree.path);
		expect(git(repo, "branch", "--list", worktree.branch)).toBe("");
	});

	it("refuses paths outside ~/.cline/worktrees/<id>/<repo>", async () => {
		await expect(
			handleCommand(ctx, "remove_git_worktree", { path: repo }),
		).rejects.toThrow("Not a task worktree");
		expect(existsSync(repo)).toBe(true);
	});
});

describe("delete_chat_session worktree cleanup", () => {
	function sessionRecord(sessionId: string, cwd: string) {
		return {
			sessionId,
			source: "desktop",
			pid: 1,
			startedAt: new Date().toISOString(),
			status: "completed",
			interactive: true,
			provider: "cline",
			model: "test",
			cwd,
			workspaceRoot: cwd,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			isSubagent: false,
		};
	}

	async function deleteSession(store: SqliteSessionStore, sessionId: string) {
		const events: Array<{ name: string; payload: unknown }> = [];
		const ctx = {
			liveSessions: new Map(),
			wsClients: new Set([
				{
					send: (raw: string) => {
						events.push(JSON.parse(raw).event);
					},
				},
			]),
			sessionManager: { delete: async () => true },
			logger: { log: vi.fn(), error: vi.fn(), debug: vi.fn() },
		} as unknown as SidecarContext;
		const deleted = await handleCommand(ctx, "delete_chat_session", {
			sessionId,
		});
		store.close();
		return { deleted, events };
	}

	it("removes the task worktree and its branch, even with uncommitted changes", async () => {
		const worktree = await run(repo);
		writeFileSync(join(worktree.path, "wip.txt"), "unsaved work");
		const store = new SqliteSessionStore();
		store.create(sessionRecord("session-wt", worktree.path) as never);

		const { deleted, events } = await deleteSession(store, "session-wt");

		expect(deleted).toBe(true);
		// The UI needs both paths to move off the vanished workspace.
		expect(events).toContainEqual({
			name: "session_deleted",
			payload: expect.objectContaining({
				sessionId: "session-wt",
				removedWorktree: { path: worktree.path, repoRoot: repo },
			}),
		});
		expect(existsSync(worktree.path)).toBe(false);
		expect(existsSync(dirname(worktree.path))).toBe(false);
		expect(git(repo, "worktree", "list")).not.toContain(worktree.path);
		expect(git(repo, "branch", "--list", worktree.branch)).toBe("");
	});

	it("keeps a branch the task switched to, deleting only cline/<id>", async () => {
		const worktree = await run(repo);
		git(worktree.path, "checkout", "-q", "-b", "feature/keep-me");
		git(worktree.path, "commit", "-q", "--allow-empty", "-m", "task work");
		const store = new SqliteSessionStore();
		store.create(sessionRecord("session-wt", worktree.path) as never);

		await deleteSession(store, "session-wt");

		expect(existsSync(worktree.path)).toBe(false);
		expect(git(repo, "branch", "--list", worktree.branch)).toBe("");
		expect(git(repo, "branch", "--list", "feature/keep-me")).toContain(
			"feature/keep-me",
		);
	});

	it("keeps a worktree that another session still uses", async () => {
		const worktree = await run(repo);
		const store = new SqliteSessionStore();
		store.create(sessionRecord("session-a", worktree.path) as never);
		store.create(sessionRecord("session-b", worktree.path) as never);

		const { events } = await deleteSession(store, "session-a");

		expect(existsSync(worktree.path)).toBe(true);
		expect(git(repo, "worktree", "list")).toContain(worktree.path);
		expect(events[0]?.payload).not.toHaveProperty("removedWorktree.path");
	});

	it("keeps a worktree that another session uses from a subfolder", async () => {
		const worktree = await run(repo);
		const store = new SqliteSessionStore();
		store.create(sessionRecord("session-a", worktree.path) as never);
		store.create(
			sessionRecord(
				"session-b",
				join(worktree.path, "packages", "ui"),
			) as never,
		);

		await deleteSession(store, "session-a");

		expect(existsSync(worktree.path)).toBe(true);
	});

	it("never removes anything for a cwd that is not a <id>/<repo> worktree", async () => {
		const worktree = await run(repo);
		const store = new SqliteSessionStore();
		// A session pointed at the <id> folder itself, or at the worktrees home.
		store.create(
			sessionRecord("session-id-dir", dirname(worktree.path)) as never,
		);
		store.create(
			sessionRecord("session-home", dirname(dirname(worktree.path))) as never,
		);

		await deleteSession(store, "session-id-dir");
		await deleteSession(new SqliteSessionStore(), "session-home");

		expect(existsSync(worktree.path)).toBe(true);
		expect(git(repo, "worktree", "list")).toContain(worktree.path);
	});

	it("leaves a regular workspace folder alone", async () => {
		const store = new SqliteSessionStore();
		store.create(sessionRecord("session-plain", repo) as never);

		await deleteSession(store, "session-plain");

		expect(existsSync(repo)).toBe(true);
		expect(git(repo, "branch", "--show-current")).toBe("main");
	});
});
