import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentMessage } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	type CheckpointEntry,
	type CheckpointMetadata,
	createCheckpointHooks,
} from "./checkpoint-hooks";

const execFile = promisify(execFileCallback);

async function runGit(cwd: string, ...args: string[]): Promise<string> {
	const result = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
	});
	return result.stdout.trim();
}

async function createGitRepo(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "core-checkpoint-"));
	await runGit(cwd, "init");
	await runGit(cwd, "config", "user.name", "Codex Test");
	await runGit(cwd, "config", "user.email", "codex@example.com");
	await writeFile(join(cwd, "note.txt"), "base\n", "utf8");
	await runGit(cwd, "add", "note.txt");
	await runGit(cwd, "commit", "-m", "initial");
	return cwd;
}

// Checkpoint runCount is derived from the count of genuine user-authored
// messages in the snapshot (see ./checkpoint-run-counting.ts) rather than a
// counter incremented on every root run/continue invocation - so test
// fixtures build up the message list explicitly instead of relying on an
// internal counter or an `initialRunCount` option (both removed).
let nextMessageId = 0;

function userMessage(
	text: string,
	metadata?: Record<string, unknown>,
): AgentMessage {
	nextMessageId += 1;
	return {
		id: `msg_${nextMessageId}`,
		role: "user",
		content: [{ type: "text", text }],
		createdAt: nextMessageId,
		...(metadata ? { metadata } : {}),
	};
}

function assistantMessage(text: string): AgentMessage {
	nextMessageId += 1;
	return {
		id: `msg_${nextMessageId}`,
		role: "assistant",
		content: [{ type: "text", text }],
		createdAt: nextMessageId,
	};
}

async function runCheckpointHooks(
	hooks: ReturnType<typeof createCheckpointHooks>,
	messages: AgentMessage[],
	options: { parentAgentId?: string | null } = {},
): Promise<void> {
	await hooks.beforeModel?.({
		snapshot: {
			agentId: options.parentAgentId ? "agent_child" : "agent_1",
			parentAgentId: options.parentAgentId,
			conversationId: options.parentAgentId ? "conv_child" : "conv_1",
			runId: options.parentAgentId ? "run_child" : "run_1",
			status: "running" as const,
			iteration: 1,
			messages,
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		request: {
			messages: [],
			tools: [],
		},
	});
}

describe("createCheckpointHooks", () => {
	it("creates one checkpoint at the start of each root run and appends metadata", async () => {
		const cwd = await createGitRepo();
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_1",
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (updater) => {
					metadata = updater(metadata);
				},
			});

			await writeFile(join(cwd, "note.txt"), "run-one\n", "utf8");
			await runCheckpointHooks(hooks, [userMessage("first")]);

			const first = metadata?.checkpoint as CheckpointMetadata;
			expect(first.history).toHaveLength(1);
			expect(first.latest.runCount).toBe(1);
			expect(first.latest.ref).toMatch(/^[0-9a-f]{40}$/);

			await writeFile(join(cwd, "note.txt"), "run-two\n", "utf8");
			await runCheckpointHooks(hooks, [
				userMessage("first"),
				assistantMessage("reply"),
				userMessage("second"),
			]);

			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint.latest.runCount).toBe(2);
			expect(checkpoint.history).toHaveLength(2);
			expect(
				checkpoint.history.map((entry: CheckpointEntry) => entry.runCount),
			).toEqual([1, 2]);
			expect(checkpoint.latest.kind).toBe("stash");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("falls back to a commit checkpoint when the worktree is clean", async () => {
		const cwd = await createGitRepo();
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_clean",
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (updater) => {
					metadata = updater(metadata);
				},
			});

			await runCheckpointHooks(hooks, [userMessage("first")]);

			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint.history).toHaveLength(1);
			expect(checkpoint.latest.kind).toBe("commit");
			expect(checkpoint.latest.ref).toMatch(/^[0-9a-f]{40}$/);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("does not append a checkpoint when the snapshot matches the latest checkpoint", async () => {
		const cwd = await createGitRepo();
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_no_change",
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (updater) => {
					metadata = updater(metadata);
				},
			});

			const messages = [userMessage("first")];
			await runCheckpointHooks(hooks, messages);

			const first = metadata?.checkpoint as CheckpointMetadata;
			expect(first.history).toHaveLength(1);
			expect(first.latest.kind).toBe("commit");

			// Same message count (no new genuine user turn) and a still-clean
			// worktree - HEAD hasn't moved, so this must be recognized as the
			// same checkpoint and not appended again.
			await runCheckpointHooks(hooks, messages);

			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint.history).toHaveLength(1);
			expect(checkpoint.latest.runCount).toBe(1);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("skips checkpoint creation for subagents", async () => {
		const cwd = await createGitRepo();
		let writes = 0;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_1",
				readSessionMetadata: async () => undefined,
				writeSessionMetadata: async () => {
					writes += 1;
				},
			});

			await writeFile(join(cwd, "note.txt"), "subagent-dirty\n", "utf8");
			await runCheckpointHooks(
				hooks,
				[userMessage("subagent turn")],
				{ parentAgentId: "agent_root" },
			);

			expect(writes).toBe(0);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("does not advance root checkpoint numbering for subagent runs", async () => {
		let metadata: Record<string, unknown> | undefined;
		const hooks = createCheckpointHooks({
			cwd: "/tmp",
			sessionId: "sess_subagent_count",
			createCheckpoint: ({ runCount }) => ({
				ref: `checkpoint-${runCount}`,
				createdAt: runCount,
				runCount,
				kind: "commit",
			}),
			readSessionMetadata: async () => metadata,
			writeSessionMetadata: async (updater) => {
				metadata = updater(metadata);
			},
		});

		// A subagent run has its own, unrelated conversation - it must never
		// influence the root session's checkpoint numbering.
		await runCheckpointHooks(
			hooks,
			[userMessage("a"), userMessage("b"), userMessage("c")],
			{ parentAgentId: "agent_root" },
		);
		await runCheckpointHooks(hooks, [userMessage("root turn one")]);

		const checkpoint = metadata?.checkpoint as CheckpointMetadata;
		expect(checkpoint.latest.runCount).toBe(1);
		expect(checkpoint.history.map((entry) => entry.runCount)).toEqual([1]);
	});

	it("ignores synthetic system-injected messages when computing runCount", async () => {
		let metadata: Record<string, unknown> | undefined;
		const hooks = createCheckpointHooks({
			cwd: "/tmp",
			sessionId: "sess_synthetic",
			createCheckpoint: ({ runCount }) => ({
				ref: `checkpoint-${runCount}`,
				createdAt: runCount,
				runCount,
				kind: "commit",
			}),
			readSessionMetadata: async () => metadata,
			writeSessionMetadata: async (updater) => {
				metadata = updater(metadata);
			},
		});

		// Two genuine user turns, plus several synthetic `role: "user"`
		// messages the system injects internally (completion reminders,
		// recovery notices, etc - see checkpoint-run-counting.ts). None of
		// these should count as a new run.
		await runCheckpointHooks(hooks, [
			userMessage("first"),
			assistantMessage("reply"),
			userMessage("reminder", { kind: "completion_reminder" }),
			userMessage("recovered", { kind: "recovery_notice" }),
			userMessage("second"),
		]);

		const checkpoint = metadata?.checkpoint as CheckpointMetadata;
		expect(checkpoint.latest.runCount).toBe(2);
	});

	it("continues checkpoint numbering after seeded messages", async () => {
		const cwd = await createGitRepo();
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_seeded",
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (updater) => {
					metadata = updater(metadata);
				},
			});

			// Two prior turns already seeded into the conversation (e.g. after
			// a checkpoint restore), plus one new turn for this run.
			await writeFile(join(cwd, "note.txt"), "run-three\n", "utf8");
			await runCheckpointHooks(hooks, [
				userMessage("seeded one"),
				assistantMessage("seeded reply one"),
				userMessage("seeded two"),
				assistantMessage("seeded reply two"),
				userMessage("run three"),
			]);

			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint.latest.runCount).toBe(3);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("replaces an existing checkpoint entry for the same run count", async () => {
		let metadata: Record<string, unknown> | undefined = {
			checkpoint: {
				latest: {
					ref: "old-three",
					createdAt: 3,
					runCount: 3,
					kind: "commit",
				},
				history: [
					{ ref: "one", createdAt: 1, runCount: 1, kind: "commit" },
					{ ref: "two", createdAt: 2, runCount: 2, kind: "commit" },
					{
						ref: "old-three",
						createdAt: 3,
						runCount: 3,
						kind: "commit",
					},
				],
			},
		};
		const hooks = createCheckpointHooks({
			cwd: "/tmp",
			sessionId: "sess_replace",
			createCheckpoint: ({ runCount }) => ({
				ref: "new-three",
				createdAt: 4,
				runCount,
				kind: "commit",
			}),
			readSessionMetadata: async () => metadata,
			writeSessionMetadata: async (updater) => {
				metadata = updater(metadata);
			},
		});

		await runCheckpointHooks(hooks, [
			userMessage("one"),
			userMessage("two"),
			userMessage("three"),
		]);

		const checkpoint = metadata?.checkpoint as CheckpointMetadata;
		expect(checkpoint.latest).toMatchObject({
			ref: "new-three",
			runCount: 3,
		});
		expect(checkpoint.history.map((entry) => entry.runCount)).toEqual([
			1, 2, 3,
		]);
		expect(checkpoint.history.at(-1)).toMatchObject({
			ref: "new-three",
			runCount: 3,
		});
	});
});
