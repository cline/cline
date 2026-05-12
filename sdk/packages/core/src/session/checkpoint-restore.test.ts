import { execFileSync } from "node:child_process";
import {
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
	applyCheckpointToWorktree,
	createCheckpointRestorePlan,
	createRestoredCheckpointMetadata,
	trimMessagesBeforeCheckpoint,
	trimMessagesToCheckpoint,
} from "./checkpoint-restore";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function createRepo(cwd: string): void {
	git(cwd, ["init"]);
	git(cwd, ["config", "user.name", "Codex Test"]);
	git(cwd, ["config", "user.email", "codex@example.com"]);
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
		expect(trimMessagesBeforeCheckpoint(messages, 2)).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "first response" },
		]);
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
