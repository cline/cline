import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentMessage } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	type CheckpointMetadata,
	createCheckpointHooks,
} from "./checkpoint-hooks";

// A stalled filesystem hangs syscalls, not just git subprocesses. Simulate it
// by making every lstat never settle; the snapshot budget must still bound the
// turn. Isolated in its own file because the module mock applies file-wide.
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		// A promise with no timer/handle: keeps nothing alive, never settles.
		lstat: vi.fn(() => new Promise<never>(() => {})),
	};
});

const execFile = promisify(execFileCallback);

async function runGit(cwd: string, ...args: string[]): Promise<string> {
	const result = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
	});
	return result.stdout.trim();
}

const userMessage = (text: string): AgentMessage => ({
	id: `user-${text}`,
	role: "user",
	content: [{ type: "text", text }],
	createdAt: 1,
});

describe("checkpoint stat-scan timeout", () => {
	it("degrades to a HEAD checkpoint when the untracked lstat scan hangs", async () => {
		// importOriginal gives us the real fs back for fixture setup.
		const realFs =
			await vi.importActual<typeof import("node:fs/promises")>(
				"node:fs/promises",
			);
		const cwd = await realFs.mkdtemp(join(tmpdir(), "core-checkpoint-stat-"));
		let metadata: Record<string, unknown> | undefined;
		try {
			await runGit(cwd, "init");
			await runGit(cwd, "config", "user.name", "Codex Test");
			await runGit(cwd, "config", "user.email", "codex@example.com");
			await realFs.writeFile(join(cwd, "note.txt"), "base\n", "utf8");
			await runGit(cwd, "add", "note.txt");
			await runGit(cwd, "commit", "-m", "initial");
			// An untracked file forces the snapshot into the lstat scan.
			await realFs.writeFile(join(cwd, "loose.txt"), "loose\n", "utf8");

			const events: { event: string; properties?: Record<string, unknown> }[] =
				[];
			const hooks = createCheckpointHooks({
				cwd,
				sessionId: "sess_stat_hang",
				gitTimeoutMs: 1500,
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

			const runTurn = async (messages: AgentMessage[]) => {
				const snapshot = {
					agentId: "agent_1",
					parentAgentId: undefined,
					conversationId: "conv_1",
					runId: "run_1",
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
						messages: messages.slice(0, -1),
					},
				});
				await hooks.beforeModel?.({
					snapshot,
					request: { messages: [], tools: [] },
				});
			};

			const startedAt = performance.now();
			await runTurn([userMessage("first request")]);
			const elapsed = performance.now() - startedAt;

			// The turn is bounded by the budget instead of hanging on lstat, and
			// the checkpoint degrades to the HEAD fallback.
			expect(elapsed).toBeLessThan(10_000);
			const checkpoint = metadata?.checkpoint as CheckpointMetadata;
			expect(checkpoint.latest.kind).toBe("commit");
			expect(checkpoint.latest.ref).toMatch(/^[0-9a-f]{40}$/);

			// The abandoned scan cannot be cancelled, so a later turn must not
			// stack another lstat batch onto the stalled filesystem: the guard
			// throws before scanning and the turn degrades to HEAD again.
			const mockedFs = await import("node:fs/promises");
			const lstatCallsAfterFirstTurn = vi.mocked(mockedFs.lstat).mock.calls
				.length;
			expect(lstatCallsAfterFirstTurn).toBeGreaterThan(0);
			await runTurn([userMessage("first request"), userMessage("second")]);
			expect(vi.mocked(mockedFs.lstat).mock.calls.length).toBe(
				lstatCallsAfterFirstTurn,
			);

			// Both degradations are reported with their distinct reasons.
			expect(
				events.map((entry) => ({
					event: entry.event,
					outcome: entry.properties?.outcome,
					reason: entry.properties?.reason,
				})),
			).toEqual([
				{
					event: "checkpoint.snapshot",
					outcome: "head_fallback",
					reason: "timeout",
				},
				{
					event: "checkpoint.snapshot",
					outcome: "head_fallback",
					reason: "stat_scan_pending",
				},
			]);
		} finally {
			await realFs.rm(cwd, { recursive: true, force: true });
		}
	});
});
