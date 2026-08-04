import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CheckpointEntry,
	createCheckpointHooks,
} from "../hooks/checkpoint-hooks";
import {
	applyCheckpointToWorktree,
	beginWorktreeRestoreTransaction,
	createCheckpointRestorePlan,
	createRestoredCheckpointMetadata,
	trimMessagesBeforeUserRun,
	trimMessagesToCheckpoint,
} from "./checkpoint-restore";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

/**
 * Creates a checkpoint of the CURRENT worktree through the real creation hook,
 * so the snapshot captures untracked files as a third parent exactly like
 * production. Returns the recorded checkpoint entry.
 */
async function snapshotCurrentWorktree(
	cwd: string,
	sessionId = "snap",
): Promise<CheckpointEntry> {
	let metadata: Record<string, unknown> | undefined;
	const hooks = createCheckpointHooks({
		cwd,
		sessionId,
		readSessionMetadata: async () => metadata,
		writeSessionMetadata: async (next) => {
			metadata = next;
		},
	});
	const userMessage = {
		id: "user-make-a-change",
		role: "user" as const,
		content: [{ type: "text" as const, text: "make a change" }],
		createdAt: 1,
	};
	const snapshot = {
		agentId: "agent_1",
		parentAgentId: undefined,
		conversationId: "conv_1",
		runId: "run_1",
		status: "running" as const,
		iteration: 1,
		messages: [userMessage],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	};
	await hooks.beforeRun?.({ snapshot: { ...snapshot, iteration: 0 } });
	await hooks.beforeModel?.({ snapshot, request: { messages: [], tools: [] } });
	const checkpoint = (
		metadata?.checkpoint as { latest?: CheckpointEntry } | undefined
	)?.latest;
	if (!checkpoint) {
		throw new Error("failed to record a checkpoint for the current worktree");
	}
	return checkpoint;
}

function createRepo(cwd: string): void {
	git(cwd, ["init"]);
	git(cwd, ["config", "user.name", "Codex Test"]);
	git(cwd, ["config", "user.email", "codex@example.com"]);
	// Keep fixture contents stable regardless of the runner's global Windows
	// checkout settings. These tests validate restoration, not autocrlf.
	git(cwd, ["config", "core.autocrlf", "false"]);
	writeFileSync(join(cwd, "tracked.txt"), "base\n", "utf8");
	git(cwd, ["add", "tracked.txt"]);
	git(cwd, ["commit", "-m", "initial"]);
}

describe("applyCheckpointToWorktree", () => {
	let dir = "";

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "checkpoint-restore-"));
		mkdirSync(dir, { recursive: true });
		createRepo(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("validates the checkpoint ref before resetting or cleaning the worktree", async () => {
		writeFileSync(join(dir, "tracked.txt"), "dirty\n", "utf8");
		writeFileSync(join(dir, "untracked.txt"), "keep me\n", "utf8");

		await expect(
			applyCheckpointToWorktree(dir, {
				ref: "0000000000000000000000000000000000000000",
				createdAt: Date.now(),
				runCount: 1,
				kind: "stash",
			}),
		).rejects.toThrow();

		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("dirty\n");
		expect(readFileSync(join(dir, "untracked.txt"), "utf8")).toBe("keep me\n");
	});

	it("restores a stash checkpoint on its original base after later commits", async () => {
		writeFileSync(join(dir, "tracked.txt"), "checkpoint state\n", "utf8");
		const checkpointRef = git(dir, [
			"stash",
			"create",
			"checkpoint before edited run",
		]);
		const checkpointBase = git(dir, ["rev-parse", `${checkpointRef}^1`]);

		writeFileSync(join(dir, "tracked.txt"), "discarded later state\n", "utf8");
		git(dir, ["add", "tracked.txt"]);
		git(dir, ["commit", "-m", "discarded later commit"]);
		writeFileSync(join(dir, "later-untracked.txt"), "keep me\n", "utf8");

		await applyCheckpointToWorktree(dir, {
			ref: checkpointRef,
			createdAt: Date.now(),
			runCount: 2,
			kind: "stash",
		});

		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe(
			"checkpoint state\n",
		);
		// Legacy 2-parent stash (no untracked third parent): untracked files
		// cannot be reconstructed, so they are left untouched rather than
		// destroyed.
		expect(readFileSync(join(dir, "later-untracked.txt"), "utf8")).toBe(
			"keep me\n",
		);
		expect(git(dir, ["rev-parse", "HEAD"])).toBe(checkpointBase);
	});

	it("fully rewinds a snapshot checkpoint: untracked reverted, created-after removed, no apply conflict", async () => {
		// State captured by the checkpoint: a tracked edit plus an untracked
		// file at "v2".
		writeFileSync(join(dir, "tracked.txt"), "checkpoint\n", "utf8");
		writeFileSync(join(dir, "untracked.md"), "v2\n", "utf8");
		const checkpoint = await snapshotCurrentWorktree(dir);
		// The snapshot must carry the untracked third parent.
		expect(git(dir, ["cat-file", "-t", `${checkpoint.ref}^3`])).toBe("commit");

		// Work done after the checkpoint: mutate tracked, mutate the untracked
		// file to different content (this is the "already exists" apply-conflict
		// case), and create a brand-new file.
		writeFileSync(join(dir, "tracked.txt"), "later\n", "utf8");
		writeFileSync(join(dir, "untracked.md"), "v3\n", "utf8");
		writeFileSync(join(dir, "created-after.txt"), "made later\n", "utf8");

		await applyCheckpointToWorktree(dir, checkpoint);

		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("checkpoint\n");
		// Untracked file modified after the checkpoint is reverted to its
		// checkpoint-time content (from the ^3 parent), not left at "v3".
		expect(readFileSync(join(dir, "untracked.md"), "utf8")).toBe("v2\n");
		// A file created after the checkpoint is rewound away.
		expect(existsSync(join(dir, "created-after.txt"))).toBe(false);
	});

	it("keeps .gitignored files when rewinding a snapshot checkpoint", async () => {
		writeFileSync(join(dir, ".gitignore"), "ignored.log\n", "utf8");
		git(dir, ["add", ".gitignore"]);
		git(dir, ["commit", "-m", "add gitignore"]);
		writeFileSync(join(dir, "tracked.txt"), "checkpoint\n", "utf8");
		writeFileSync(join(dir, "kept.txt"), "keep\n", "utf8");
		const checkpoint = await snapshotCurrentWorktree(dir);

		writeFileSync(join(dir, "tracked.txt"), "later\n", "utf8");
		writeFileSync(join(dir, "ignored.log"), "build output\n", "utf8");

		await applyCheckpointToWorktree(dir, checkpoint);

		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("checkpoint\n");
		expect(readFileSync(join(dir, "kept.txt"), "utf8")).toBe("keep\n");
		// git clean -fd (no -x) never touches ignored paths.
		expect(readFileSync(join(dir, "ignored.log"), "utf8")).toBe(
			"build output\n",
		);
	});

	it("infers a kindless stash checkpoint without treating it as a commit", async () => {
		writeFileSync(join(dir, "tracked.txt"), "checkpoint state\n", "utf8");
		const checkpointRef = git(dir, [
			"stash",
			"create",
			"cline checkpoint session=legacy run=1",
		]);
		const checkpointBase = git(dir, ["rev-parse", `${checkpointRef}^1`]);

		writeFileSync(join(dir, "tracked.txt"), "discarded state\n", "utf8");
		git(dir, ["add", "tracked.txt"]);
		git(dir, ["commit", "-m", "discarded commit"]);

		await applyCheckpointToWorktree(dir, {
			ref: checkpointRef,
			createdAt: Date.now(),
			runCount: 1,
		});

		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe(
			"checkpoint state\n",
		);
		expect(git(dir, ["rev-parse", "HEAD"])).toBe(checkpointBase);
	});

	it("restores a kindless root commit without reading a nonexistent parent", async () => {
		const checkpointRef = git(dir, ["rev-parse", "HEAD"]);
		writeFileSync(join(dir, "tracked.txt"), "discarded state\n", "utf8");
		git(dir, ["add", "tracked.txt"]);
		git(dir, ["commit", "-m", "discarded commit"]);
		writeFileSync(join(dir, "later-untracked.txt"), "keep me\n", "utf8");

		await applyCheckpointToWorktree(dir, {
			ref: checkpointRef,
			createdAt: Date.now(),
			runCount: 1,
		});

		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("base\n");
		// HEAD-commit fallback (no untracked third parent): untracked left alone.
		expect(readFileSync(join(dir, "later-untracked.txt"), "utf8")).toBe(
			"keep me\n",
		);
		expect(git(dir, ["rev-parse", "HEAD"])).toBe(checkpointRef);
	});

	it("rolls back HEAD plus staged, unstaged, and untracked changes", async () => {
		writeFileSync(join(dir, "tracked.txt"), "existing stash\n", "utf8");
		git(dir, ["stash", "push", "--message", "existing user stash"]);
		const stashListBefore = git(dir, ["stash", "list"]);
		const originalHead = git(dir, ["rev-parse", "HEAD"]);

		writeFileSync(join(dir, "tracked.txt"), "staged state\n", "utf8");
		git(dir, ["add", "tracked.txt"]);
		writeFileSync(join(dir, "tracked.txt"), "unstaged state\n", "utf8");
		writeFileSync(join(dir, "untracked.txt"), "untracked state\n", "utf8");

		const transaction = await beginWorktreeRestoreTransaction(dir);
		expect(git(dir, ["status", "--short"])).toBe("");
		expect(git(dir, ["stash", "list"])).toBe(stashListBefore);

		writeFileSync(join(dir, "tracked.txt"), "replacement state\n", "utf8");
		git(dir, ["add", "tracked.txt"]);
		git(dir, ["commit", "-m", "replacement checkpoint"]);
		writeFileSync(join(dir, "replacement.txt"), "remove me\n", "utf8");

		await transaction.rollback();

		expect(git(dir, ["rev-parse", "HEAD"])).toBe(originalHead);
		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe(
			"unstaged state\n",
		);
		expect(git(dir, ["show", ":tracked.txt"])).toBe("staged state");
		expect(readFileSync(join(dir, "untracked.txt"), "utf8")).toBe(
			"untracked state\n",
		);
		expect(existsSync(join(dir, "replacement.txt"))).toBe(false);
		expect(git(dir, ["stash", "list"])).toBe(stashListBefore);
		expect(
			git(dir, [
				"for-each-ref",
				"--format=%(refname)",
				"refs/cline/restore-transactions",
			]),
		).toBe("");
	});

	it("discards the recovery snapshot after a committed restore", async () => {
		writeFileSync(join(dir, "tracked.txt"), "discarded state\n", "utf8");
		writeFileSync(join(dir, "untracked.txt"), "discarded untracked\n", "utf8");
		const stashListBefore = git(dir, ["stash", "list"]);

		const transaction = await beginWorktreeRestoreTransaction(dir);
		await transaction.commit();

		expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("base\n");
		expect(existsSync(join(dir, "untracked.txt"))).toBe(false);
		expect(git(dir, ["stash", "list"])).toBe(stashListBefore);
		expect(
			git(dir, [
				"for-each-ref",
				"--format=%(refname)",
				"refs/cline/restore-transactions",
			]),
		).toBe("");
	});

	it("carries checkpoint metadata through the restored run", () => {
		const metadata = createRestoredCheckpointMetadata(
			{
				metadata: {
					checkpoint: {
						latest: { ref: "cccc", createdAt: 3, runCount: 3 },
						history: [
							{ ref: "aaaa", createdAt: 1, runCount: 1 },
							{ ref: "bbbb", createdAt: 2, runCount: 2 },
							{ ref: "cccc", createdAt: 3, runCount: 3 },
						],
					},
				},
			},
			2,
		);

		expect(metadata?.latest.runCount).toBe(2);
		expect(metadata?.history.map((entry) => entry.runCount)).toEqual([1, 2]);
	});
});

describe("checkpoint message trimming", () => {
	it("can trim either through or before the checkpoint user message", () => {
		const messages = [
			{ role: "user" as const, content: "first" },
			{ role: "assistant" as const, content: "first response" },
			{ role: "user" as const, content: "second" },
			{ role: "assistant" as const, content: "second response" },
		];

		expect(trimMessagesToCheckpoint(messages, 2)).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "first response" },
			{ role: "user", content: "second" },
		]);
		expect(trimMessagesBeforeUserRun(messages, 2)).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "first response" },
		]);
		expect(trimMessagesBeforeUserRun(messages, 1)).toEqual([]);
	});

	it("preserves absolute run positions across system-displayed compaction messages", () => {
		const compactedContext = {
			role: "user" as const,
			content: "Compacted context",
			metadata: {
				kind: "compaction",
				displayRole: "system",
				userRunSpan: 3,
			},
		};
		const recoveryNotice = {
			role: "user" as const,
			content: "Recovered context",
			metadata: {
				kind: "recovery_notice",
			},
		};
		const messages = [
			compactedContext,
			recoveryNotice,
			{ role: "user" as const, content: "first visible prompt" },
			{ role: "assistant" as const, content: "first response" },
			{ role: "user" as const, content: "second visible prompt" },
		];

		expect(trimMessagesBeforeUserRun(messages, 4)).toEqual([
			compactedContext,
			recoveryNotice,
		]);
		expect(trimMessagesBeforeUserRun(messages, 5)).toEqual([
			compactedContext,
			recoveryNotice,
			{ role: "user", content: "first visible prompt" },
			{ role: "assistant", content: "first response" },
		]);
		expect(trimMessagesToCheckpoint(messages, 5)).toEqual(messages);
		expect(() => trimMessagesToCheckpoint(messages, 2)).toThrow(
			"folded into a compacted message spanning runs 1-3",
		);
		expect(() => trimMessagesBeforeUserRun(messages, 3)).toThrow(
			"Cannot fork before run 3",
		);
	});

	it("uses the nearest earlier checkpoint when an identical snapshot was deduplicated", () => {
		const messages = [
			{ role: "user" as const, content: "first" },
			{ role: "assistant" as const, content: "first response" },
			{ role: "user" as const, content: "second" },
			{ role: "assistant" as const, content: "second response" },
			{ role: "user" as const, content: "third" },
		];

		const plan = createCheckpointRestorePlan({
			session: {
				sessionId: "session-1",
				source: "cli",
				status: "running",
				startedAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				interactive: true,
				provider: "mock",
				model: "mock",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
				isSubagent: false,
				metadata: {
					checkpoint: {
						latest: { ref: "cccc", createdAt: 3, runCount: 3 },
						history: [
							{ ref: "aaaa", createdAt: 1, runCount: 1 },
							{ ref: "cccc", createdAt: 3, runCount: 3 },
						],
					},
				},
			},
			messages,
			checkpointRunCount: 2,
		});

		expect(plan.checkpoint).toMatchObject({ ref: "aaaa", runCount: 1 });
		expect(plan.messages).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "first response" },
			{ role: "user", content: "second" },
		]);
	});
});
