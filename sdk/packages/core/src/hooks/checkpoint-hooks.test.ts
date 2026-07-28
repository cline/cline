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

// The checkpoint run number is derived from the count of genuine user
// messages in the snapshot (not a per-invocation counter), so fixtures build
// the message list explicitly.
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
				writeSessionMetadata: async (next) => {
					metadata = next;
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
				writeSessionMetadata: async (next) => {
					metadata = next;
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
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});

			const messages = [userMessage("first")];
			await runCheckpointHooks(hooks, messages);

			const first = metadata?.checkpoint as CheckpointMetadata;
			expect(first.history).toHaveLength(1);
			expect(first.latest.kind).toBe("commit");

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
			await runCheckpointHooks(hooks, [userMessage("subagent turn")], {
				parentAgentId: "agent_root",
			});

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
			writeSessionMetadata: async (next) => {
				metadata = next;
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

	it("ignores synthetic system-injected messages when computing the run number", async () => {
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
			writeSessionMetadata: async (next) => {
				metadata = next;
			},
		});

		await runCheckpointHooks(hooks, [
			userMessage("first"),
			assistantMessage("reply"),
			userMessage("reminder", { kind: "completion_reminder" }),
			userMessage("recovered", { kind: "recovery_notice" }),
			userMessage(
				'<user_input mode="act">[TASK RESUMPTION] Please continue where you left off.</user_input>',
			),
			userMessage("second"),
		]);

		const checkpoint = metadata?.checkpoint as CheckpointMetadata;
		expect(checkpoint.latest.runCount).toBe(2);
	});

	it("skips checkpoint creation for runs triggered by a synthetic message", async () => {
		// A continuation run (recovery notice, host task-resumption prompt)
		// starts with an unchanged genuine-user count; writing a checkpoint
		// there would overwrite the entry recorded at the start of the current
		// genuine turn with the turn's half-finished workspace state.
		let metadata: Record<string, unknown> | undefined = {
			checkpoint: {
				latest: { ref: "one", createdAt: 1, runCount: 1, kind: "commit" },
				history: [{ ref: "one", createdAt: 1, runCount: 1, kind: "commit" }],
			},
		};
		let checkpointCalls = 0;
		const hooks = createCheckpointHooks({
			cwd: "/tmp",
			sessionId: "sess_synthetic_trigger",
			createCheckpoint: ({ runCount }) => {
				checkpointCalls += 1;
				return {
					ref: `mid-turn-${runCount}`,
					createdAt: 99,
					runCount,
					kind: "commit",
				};
			},
			readSessionMetadata: async () => metadata,
			writeSessionMetadata: async (next) => {
				metadata = next;
			},
		});

		await runCheckpointHooks(hooks, [
			userMessage("first"),
			assistantMessage("partial work"),
			userMessage("A transient error occurred, continuing.", {
				kind: "recovery_notice",
			}),
		]);
		await runCheckpointHooks(hooks, [
			userMessage("first"),
			assistantMessage("partial work"),
			userMessage("[TASK RESUMPTION] Please continue where you left off."),
		]);

		expect(checkpointCalls).toBe(0);
		const checkpoint = metadata?.checkpoint as CheckpointMetadata;
		expect(checkpoint.latest.ref).toBe("one");
		expect(checkpoint.history).toHaveLength(1);
	});

	it("continues checkpoint numbering after seeded messages", async () => {
		const cwd = await createGitRepo();
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_seeded",
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});

			// Two prior turns seeded into the conversation (e.g. after an
			// edit-and-regenerate), plus the new turn for this run.
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
			writeSessionMetadata: async (next) => {
				metadata = next;
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
