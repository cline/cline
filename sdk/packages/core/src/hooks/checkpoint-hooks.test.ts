import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentMessage } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	type CheckpointEntry,
	type CheckpointMetadata,
	checkpointScratchDir,
	createCheckpointHooks,
	deleteCheckpointRefs,
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

const assistantMessage = (text: string): AgentMessage => ({
	id: `assistant-${text}`,
	role: "assistant",
	content: [{ type: "text", text }],
	createdAt: 1,
});

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

	it("captures untracked files as a third parent so restore can rewind them", async () => {
		const cwd = await createGitRepo();
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_untracked",
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});

			// An untracked file present at checkpoint time (no tracked changes).
			await writeFile(join(cwd, "created.txt"), "snapshot-content\n", "utf8");
			await runCheckpointHooks(hooks);

			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint.latest.kind).toBe("stash");
			const ref = checkpoint.latest.ref;
			// The snapshot carries a third parent whose tree holds the untracked
			// file at its checkpoint-time content.
			expect(await runGit(cwd, "cat-file", "-t", `${ref}^3`)).toBe("commit");
			expect(await runGit(cwd, "show", `${ref}^3:created.txt`)).toBe(
				"snapshot-content",
			);
			// Capturing must not disturb the user's worktree/index/stash list.
			expect(await runGit(cwd, "status", "--porcelain")).toBe("?? created.txt");
			expect(await runGit(cwd, "stash", "list")).toBe("");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("creates a checkpoint when the host seeds the prompt before the run starts", async () => {
		// Regression test for the VS Code host: it persists the run's prompt
		// into session state before the run begins, so the prompt is already
		// present when beforeRun fires. The previous beforeRun-length boundary
		// treated the prompt as pre-existing and skipped every checkpoint.
		const cwd = await createGitRepo();
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_preseeded",
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});

			await writeFile(join(cwd, "note.txt"), "run-one\n", "utf8");
			await runCheckpointHooks(hooks, {
				messages: [userMessage("first request")],
				// Prompt already present at beforeRun, as the VS Code host does.
				messagesBeforeRun: [userMessage("first request")],
			});

			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint?.history).toHaveLength(1);
			expect(checkpoint.latest.runCount).toBe(1);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("does not overwrite a checkpoint when a reopened session resumes without a new user turn", async () => {
		let metadata: Record<string, unknown> | undefined;
		let refCounter = 0;
		const makeHooks = () =>
			createCheckpointHooks({
				cwd: "/tmp",
				sessionId: "sess_reopen",
				createCheckpoint: ({ runCount }) => ({
					ref: `ref-${++refCounter}`,
					createdAt: refCounter,
					runCount,
					kind: "commit" as const,
				}),
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});

		const transcript = [userMessage("first request")];
		await runCheckpointHooks(makeHooks(), {
			messages: transcript,
			messagesBeforeRun: transcript,
		});
		expect((metadata?.checkpoint as CheckpointMetadata).latest.ref).toBe(
			"ref-1",
		);

		const resumed = [
			...transcript,
			assistantMessage("did some edits"),
			userMessage("[TASK RESUMPTION] Please continue where you left off."),
		];
		await runCheckpointHooks(makeHooks(), {
			messages: resumed,
			messagesBeforeRun: resumed,
		});
		expect((metadata?.checkpoint as CheckpointMetadata).latest.ref).toBe(
			"ref-1",
		);
	});

	it("creates a checkpoint for the first user turn after compaction shrinks the transcript", async () => {
		let metadata: Record<string, unknown> | undefined;
		const createCheckpoint = vi.fn(({ runCount }: { runCount: number }) => ({
			ref: `ref-${runCount}`,
			createdAt: runCount,
			runCount,
			kind: "commit" as const,
		}));
		const hooks = createCheckpointHooks({
			cwd: "/tmp",
			sessionId: "sess_compaction",
			createCheckpoint,
			readSessionMetadata: async () => metadata,
			writeSessionMetadata: async (next) => {
				metadata = next;
			},
		});

		const longTranscript = [
			userMessage("first request"),
			assistantMessage("a1"),
			assistantMessage("a2"),
			userMessage("second request"),
			assistantMessage("a3"),
			assistantMessage("a4"),
		];
		await runCheckpointHooks(hooks, {
			messages: longTranscript,
			messagesBeforeRun: longTranscript,
		});

		const compacted = [
			userMessage("Compacted context", {
				kind: "compaction",
				displayRole: "system",
				userRunSpan: 2,
			}),
			userMessage("third request"),
		];
		await runCheckpointHooks(hooks, {
			messages: compacted,
			messagesBeforeRun: compacted,
		});

		expect(createCheckpoint).toHaveBeenLastCalledWith(
			expect.objectContaining({ runCount: 3 }),
		);
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

	it("starts checkpointing after the user runs git init mid-session", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "core-checkpoint-nogit-"));
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_git_init_later",
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});

			// First turn: no git repo yet, so no checkpoint is written.
			await writeFile(join(cwd, "note.txt"), "before-init\n", "utf8");
			await runCheckpointHooks(hooks);
			expect(metadata?.checkpoint).toBeUndefined();

			// The user initializes git mid-session.
			await runGit(cwd, "init");
			await runGit(cwd, "config", "user.name", "Codex Test");
			await runGit(cwd, "config", "user.email", "codex@example.com");
			await runGit(cwd, "add", "note.txt");
			await runGit(cwd, "commit", "-m", "initial");

			// Next turn on the same hook instance picks up the new repo and
			// checkpoints from here forward.
			await writeFile(join(cwd, "note.txt"), "after-init\n", "utf8");
			await runCheckpointHooks(hooks, {
				messages: [userMessage("first request"), userMessage("second request")],
			});

			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint.history).toHaveLength(1);
			expect(checkpoint.latest.runCount).toBe(2);
			expect(checkpoint.latest.kind).toBe("stash");
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

	it("emits one checkpoint.snapshot event per snapshot attempt without file paths", async () => {
		const cwd = await createGitRepo();
		const sessionId = "sess_telemetry";
		let metadata: Record<string, unknown> | undefined;
		const events: { event: string; properties?: Record<string, unknown> }[] =
			[];
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId,
				telemetry: {
					capture: (input) => {
						events.push(input);
					},
				},
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});

			await writeFile(join(cwd, "loose-data.txt"), "loose\n", "utf8");
			await runCheckpointHooks(hooks);

			expect(events).toHaveLength(1);
			expect(events[0]?.event).toBe("checkpoint.snapshot");
			expect(events[0]?.properties).toMatchObject({
				sessionId,
				runCount: 1,
				outcome: "stash",
			});
			expect(typeof events[0]?.properties?.durationMs).toBe("number");
			// Durations and outcomes only — never workspace file paths.
			expect(JSON.stringify(events[0])).not.toContain("loose-data");
		} finally {
			await deleteCheckpointRefs(cwd, sessionId);
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("drops persistent-index entries for untracked files that disappear between runs", async () => {
		// The per-session GIT_INDEX_FILE caches untracked hashes across turns so
		// unchanged files are not re-hashed; a file that was deleted (or became
		// tracked) in the meantime must not ghost into later snapshots.
		const cwd = await createGitRepo();
		const sessionId = "sess_stale_index";
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId,
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});

			await writeFile(join(cwd, "a.txt"), "a\n", "utf8");
			await writeFile(join(cwd, "b.txt"), "b\n", "utf8");
			await runCheckpointHooks(hooks);

			const first = (metadata?.checkpoint as CheckpointMetadata).latest;
			const firstTree = await runGit(
				cwd,
				"ls-tree",
				"-r",
				"--name-only",
				`${first.ref}^3`,
			);
			expect(firstTree.split("\n").sort()).toEqual(["a.txt", "b.txt"]);
			// The scratch index survives the turn — that is the cross-turn cache.
			expect(existsSync(join(checkpointScratchDir(sessionId), "index"))).toBe(
				true,
			);

			await rm(join(cwd, "a.txt"));
			await runCheckpointHooks(hooks, {
				messages: [userMessage("first request"), userMessage("second request")],
			});

			const second = (metadata?.checkpoint as CheckpointMetadata).latest;
			expect(second.runCount).toBe(2);
			const secondTree = await runGit(
				cwd,
				"ls-tree",
				"-r",
				"--name-only",
				`${second.ref}^3`,
			);
			expect(secondTree.split("\n")).toEqual(["b.txt"]);
		} finally {
			await deleteCheckpointRefs(cwd, sessionId);
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("removes the per-session scratch dir together with the checkpoint refs", async () => {
		const cwd = await createGitRepo();
		const sessionId = "sess_scratch_cleanup";
		let metadata: Record<string, unknown> | undefined;
		try {
			const hooks = createCheckpointHooks({
				cwd,
				sessionId,
				readSessionMetadata: async () => metadata,
				writeSessionMetadata: async (next) => {
					metadata = next;
				},
			});
			await writeFile(join(cwd, "loose.txt"), "loose\n", "utf8");
			await runCheckpointHooks(hooks);
			expect(existsSync(checkpointScratchDir(sessionId))).toBe(true);

			await deleteCheckpointRefs(cwd, sessionId);

			expect(existsSync(checkpointScratchDir(sessionId))).toBe(false);
		} finally {
			await deleteCheckpointRefs(cwd, sessionId);
			await rm(cwd, { recursive: true, force: true });
		}
	});

});
