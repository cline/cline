import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AgentRuntime } from "@cline/agents";
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
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

function userMessage(
	text: string,
	metadata?: Record<string, unknown>,
): AgentMessage {
	return {
		id: `user-${text}`,
		role: "user",
		content: [{ type: "text", text }],
		createdAt: 1,
		metadata,
	};
}

async function runCheckpointHooks(
	hooks: ReturnType<typeof createCheckpointHooks>,
	options: {
		messages?: AgentMessage[];
		messagesBeforeRun?: AgentMessage[];
		parentAgentId?: string | null;
	} = {},
): Promise<void> {
	const messages = options.messages ?? [userMessage("first request")];
	const snapshot = {
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
	};
	await hooks.beforeRun?.({
		snapshot: {
			...snapshot,
			iteration: 0,
			messages: options.messagesBeforeRun ?? messages.slice(0, -1),
		},
	});
	await hooks.beforeModel?.({
		snapshot,
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
			await runCheckpointHooks(hooks);

			const first = metadata?.checkpoint as CheckpointMetadata;
			expect(first.history).toHaveLength(1);
			expect(first.latest.runCount).toBe(1);
			expect(first.latest.ref).toMatch(/^[0-9a-f]{40}$/);

			await writeFile(join(cwd, "note.txt"), "run-two\n", "utf8");
			await runCheckpointHooks(hooks, {
				messages: [userMessage("first request"), userMessage("second request")],
			});

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

	it("creates a checkpoint when the user message was seeded before beforeRun", async () => {
		// SessionRuntime appends the user turn to the transcript and seeds it
		// into `initialMessages` before starting the run, then calls
		// `runtime.run("")`. beforeRun therefore already observes the user
		// message and the beforeRun/beforeModel delta is empty. The hook must
		// still create a checkpoint for the new run.
		const cwd = await createGitRepo();
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_seeded_before_run",
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});

			await writeFile(join(cwd, "note.txt"), "seeded-run-one\n", "utf8");
			const firstRun = [userMessage("first request")];
			await runCheckpointHooks(hooks, {
				messages: firstRun,
				messagesBeforeRun: firstRun,
			});

			const first = metadata?.checkpoint as CheckpointMetadata;
			expect(first.history).toHaveLength(1);
			expect(first.latest.runCount).toBe(1);
			expect(first.latest.kind).toBe("stash");

			await writeFile(join(cwd, "note.txt"), "seeded-run-two\n", "utf8");
			const secondRun = [
				userMessage("first request"),
				userMessage("second request"),
			];
			await runCheckpointHooks(hooks, {
				messages: secondRun,
				messagesBeforeRun: secondRun,
			});

			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint.latest.runCount).toBe(2);
			expect(
				checkpoint.history.map((entry: CheckpointEntry) => entry.runCount),
			).toEqual([1, 2]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("does not checkpoint a seeded continuation that reuses the run count", async () => {
		// Auth retries and task resumptions re-run without a new user turn, so
		// the run count is unchanged. In the seeded path the delta is empty, so
		// the hook must skip these to avoid duplicate checkpoints for a run.
		const createCheckpoint = vi.fn(({ runCount }: { runCount: number }) => ({
			ref: `checkpoint-${runCount}`,
			createdAt: runCount,
			runCount,
			kind: "commit" as const,
		}));
		let metadata: Record<string, unknown> | undefined;
		const hooks = createCheckpointHooks({
			cwd: "/tmp",
			sessionId: "sess_seeded_continuation",
			createCheckpoint,
			readSessionMetadata: async () => metadata,
			writeSessionMetadata: async (next) => {
				metadata = next;
			},
		});

		const firstRun = [userMessage("first request")];
		await runCheckpointHooks(hooks, {
			messages: firstRun,
			messagesBeforeRun: firstRun,
		});
		// Continuation: same transcript re-run (no new user turn), seeded.
		await runCheckpointHooks(hooks, {
			messages: firstRun,
			messagesBeforeRun: firstRun,
		});

		expect(createCheckpoint).toHaveBeenCalledTimes(1);
		expect(
			(metadata?.checkpoint as CheckpointMetadata).history.map(
				(entry) => entry.runCount,
			),
		).toEqual([1]);
	});

	it("creates a checkpoint when driven by the real AgentRuntime seeded like SessionRuntime", async () => {
		// End-to-end guard against the production contract: SessionRuntime
		// (used by both the CLI and the VS Code extension) seeds the user turn
		// into `initialMessages` and calls `runtime.run("")` — see
		// executeRunInternal in runtime/orchestration/session-runtime-orchestrator.ts.
		const cwd = await createGitRepo();
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_runtime_seeded",
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});
			await writeFile(join(cwd, "note.txt"), "runtime-seeded\n", "utf8");
			const model: AgentModel = {
				stream: async () =>
					(async function* (): AsyncIterable<AgentModelEvent> {
						yield { type: "text-delta", text: "ok" };
						yield { type: "finish", reason: "stop" };
					})(),
			};
			const runtime = new AgentRuntime({
				model,
				hooks,
				initialMessages: [userMessage("first request")],
			});

			const result = await runtime.run("");

			expect(result.status).toBe("completed");
			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint).toBeDefined();
			expect(checkpoint.latest.runCount).toBe(1);
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

			await runCheckpointHooks(hooks);

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

			await runCheckpointHooks(hooks);

			const first = metadata?.checkpoint as CheckpointMetadata;
			expect(first.history).toHaveLength(1);
			expect(first.latest.kind).toBe("commit");

			await runCheckpointHooks(hooks);

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
			await runCheckpointHooks(hooks, { parentAgentId: "agent_root" });

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

		await runCheckpointHooks(hooks, { parentAgentId: "agent_root" });
		await runCheckpointHooks(hooks);

		const checkpoint = metadata?.checkpoint as CheckpointMetadata;
		expect(checkpoint.latest.runCount).toBe(1);
		expect(checkpoint.history.map((entry) => entry.runCount)).toEqual([1]);
	});

	it("derives checkpoint numbering from compacted and seeded messages", async () => {
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

			await writeFile(join(cwd, "note.txt"), "run-three\n", "utf8");
			await runCheckpointHooks(hooks, {
				messages: [
					userMessage("Compacted context", {
						kind: "compaction",
						displayRole: "system",
						userRunSpan: 2,
					}),
					userMessage("third request"),
				],
			});

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

		await runCheckpointHooks(hooks, {
			messages: [
				userMessage("first request"),
				userMessage("second request"),
				userMessage("third request"),
			],
		});

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

	it("does not overwrite a checkpoint for synthetic continuations", async () => {
		let metadata: Record<string, unknown> | undefined;
		const createCheckpoint = vi.fn(({ runCount }: { runCount: number }) => ({
			ref: `checkpoint-${runCount}`,
			createdAt: runCount,
			runCount,
			kind: "commit" as const,
		}));
		const hooks = createCheckpointHooks({
			cwd: "/tmp",
			sessionId: "sess_continuation",
			createCheckpoint,
			readSessionMetadata: async () => metadata,
			writeSessionMetadata: async (next) => {
				metadata = next;
			},
		});
		const firstRequest = userMessage("first request");

		await runCheckpointHooks(hooks, { messages: [firstRequest] });
		await runCheckpointHooks(hooks, {
			messages: [
				firstRequest,
				userMessage(
					'<user_input mode="act">[TASK RESUMPTION] Please continue where you left off.</user_input>',
				),
			],
		});

		expect(createCheckpoint).toHaveBeenCalledTimes(1);
		expect(
			(metadata?.checkpoint as CheckpointMetadata).history.map(
				(entry) => entry.runCount,
			),
		).toEqual([1]);
	});

	it("creates the run checkpoint before trailing internal reminders", async () => {
		let metadata: Record<string, unknown> | undefined;
		const createCheckpoint = vi.fn(({ runCount }: { runCount: number }) => ({
			ref: `checkpoint-${runCount}`,
			createdAt: runCount,
			runCount,
			kind: "commit" as const,
		}));
		const hooks = createCheckpointHooks({
			cwd: "/tmp",
			sessionId: "sess_reminder",
			createCheckpoint,
			readSessionMetadata: async () => metadata,
			writeSessionMetadata: async (next) => {
				metadata = next;
			},
		});

		const firstRunMessages = [
			userMessage("first request"),
			userMessage("Internal completion reminder", { userRunSpan: 0 }),
		];
		await runCheckpointHooks(hooks, {
			messages: firstRunMessages,
			messagesBeforeRun: [],
		});
		await runCheckpointHooks(hooks, {
			messages: [...firstRunMessages, userMessage("second request")],
			messagesBeforeRun: firstRunMessages,
		});

		expect(createCheckpoint).toHaveBeenCalledTimes(2);
		expect(
			createCheckpoint.mock.calls.map(([input]) => input.runCount),
		).toEqual([1, 2]);
	});
});
