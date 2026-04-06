import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
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
			await hooks.onRunStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				userMessage: "first",
			});
			await hooks.onBeforeAgentStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				systemPrompt: "system",
				messages: [],
			});

			const first = metadata?.checkpoint as CheckpointMetadata;
			expect(first.history).toHaveLength(1);
			expect(first.latest.runCount).toBe(1);
			expect(first.latest.ref).toMatch(/^[0-9a-f]{40}$/);

			await writeFile(join(cwd, "note.txt"), "run-two\n", "utf8");
			await hooks.onRunStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				userMessage: "second",
			});
			await hooks.onBeforeAgentStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				systemPrompt: "system",
				messages: [],
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

			await hooks.onRunStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				userMessage: "clean",
			});
			await hooks.onBeforeAgentStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				systemPrompt: "system",
				messages: [],
			});

			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint.history).toHaveLength(1);
			expect(checkpoint.latest.kind).toBe("commit");
			expect(checkpoint.latest.ref).toMatch(/^[0-9a-f]{40}$/);
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
			await hooks.onRunStart?.({
				agentId: "agent_child",
				conversationId: "conv_child",
				parentAgentId: "agent_root",
				userMessage: "child",
			});
			await hooks.onBeforeAgentStart?.({
				agentId: "agent_child",
				conversationId: "conv_child",
				parentAgentId: "agent_root",
				iteration: 1,
				systemPrompt: "system",
				messages: [],
			});

			expect(writes).toBe(0);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
