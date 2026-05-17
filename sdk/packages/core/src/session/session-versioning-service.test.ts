import { describe, expect, it, vi } from "vitest";
import { SessionSource } from "../types/common";
import type { SessionRecord } from "../types/sessions";
import { createCoreSessionSnapshot } from "./session-snapshot";
import {
	type SessionVersioningError,
	SessionVersioningService,
} from "./session-versioning-service";

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		sessionId: "source-session",
		source: SessionSource.CLI,
		pid: 123,
		startedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:01:00.000Z",
		endedAt: null,
		exitCode: null,
		status: "completed",
		interactive: true,
		provider: "provider-a",
		model: "model-a",
		cwd: "/workspace/project",
		workspaceRoot: "/workspace/project",
		teamName: "team-a",
		enableTools: true,
		enableSpawn: true,
		enableTeams: false,
		parentSessionId: "parent-session",
		parentAgentId: "parent-agent",
		agentId: "agent-a",
		conversationId: "conversation-a",
		isSubagent: false,
		prompt: "original prompt",
		messagesPath: "/workspace/project/source.messages.json",
		metadata: {
			title: "Original",
			checkpointEnabled: true,
			checkpoint: {
				latest: { ref: "cccc", createdAt: 3, runCount: 3 },
				history: [
					{ ref: "aaaa", createdAt: 1, runCount: 1, kind: "commit" },
					{ ref: "bbbb", createdAt: 2, runCount: 2, kind: "stash" },
					{ ref: "cccc", createdAt: 3, runCount: 3, kind: "stash" },
				],
			},
		},
		...overrides,
	};
}

const messages = [
	{ role: "user" as const, content: "first" },
	{ role: "assistant" as const, content: "first response" },
	{ role: "user" as const, content: "second" },
	{ role: "assistant" as const, content: "second response" },
];

describe("createCoreSessionSnapshot", () => {
	it("projects session records into the canonical snapshot shape", () => {
		const snapshot = createCoreSessionSnapshot({
			session: makeSession(),
			messages,
			usage: {
				inputTokens: 1,
				outputTokens: 2,
				cacheReadTokens: 3,
				cacheWriteTokens: 4,
				totalCost: 0.5,
			},
		});

		expect(snapshot).toMatchObject({
			version: 1,
			sessionId: "source-session",
			workspace: { cwd: "/workspace/project", root: "/workspace/project" },
			model: { providerId: "provider-a", modelId: "model-a" },
			capabilities: {
				enableTools: true,
				enableSpawn: true,
				enableTeams: false,
			},
			lineage: {
				parentSessionId: "parent-session",
				parentAgentId: "parent-agent",
				agentId: "agent-a",
				conversationId: "conversation-a",
				isSubagent: false,
			},
			team: { name: "team-a" },
			checkpoint: {
				enabled: true,
				latest: { ref: "cccc", createdAt: 3, runCount: 3, kind: "stash" },
			},
			usage: { totalCost: 0.5 },
		});
		expect(snapshot.messages).toEqual(messages);
		expect(snapshot.messages).not.toBe(messages);
		expect(snapshot.metadata).not.toBe(makeSession().metadata);
	});
});

describe("SessionVersioningService", () => {
	it("plans and materializes checkpoint restore through shared semantics", async () => {
		const sourceSession = makeSession();
		const restoredSession = makeSession({
			sessionId: "restored-session",
			metadata: {
				checkpoint: { history: [{ ref: "aaaa", createdAt: 1, runCount: 1 }] },
			},
		});
		const applyWorkspaceCheckpoint = vi.fn(async () => undefined);
		const retainCheckpointRefs = vi.fn(async () => undefined);
		const startSession = vi.fn(
			async (input: { initialMessages?: unknown[] }) => {
				expect(input.initialMessages).toEqual([
					{ role: "user", content: "first" },
					{ role: "assistant", content: "first response" },
					{ role: "user", content: "second" },
				]);
				return { sessionId: "restored-session" };
			},
		);

		const result = await new SessionVersioningService().restoreCheckpoint({
			sessionId: "source-session",
			checkpointRunCount: 2,
			restore: { messages: true, workspace: true },
			start: { marker: true },
			getSession: async (sessionId) =>
				sessionId === "source-session" ? sourceSession : restoredSession,
			readMessages: async () => messages,
			applyWorkspaceCheckpoint,
			retainCheckpointRefs,
			buildStartInput: (context, start) => ({
				...start,
				initialMessages: context.initialMessages,
				checkpoint: context.restoredCheckpointMetadata,
			}),
			startSession,
			getStartedSessionId: (startResult) => startResult.sessionId,
			readRestoredSession: async () => restoredSession,
		});

		expect(result.sessionId).toBe("restored-session");
		expect(result.checkpoint).toMatchObject({ ref: "bbbb", runCount: 2 });
		expect(result.sourceSnapshot.sessionId).toBe("source-session");
		expect(result.restoredSnapshot?.sessionId).toBe("restored-session");
		expect(applyWorkspaceCheckpoint).toHaveBeenCalledWith(
			"/workspace/project",
			expect.objectContaining({ ref: "bbbb" }),
		);
		expect(retainCheckpointRefs).toHaveBeenCalledWith(
			"/workspace/project",
			"restored-session",
			[
				expect.objectContaining({ ref: "aaaa" }),
				expect.objectContaining({ ref: "bbbb" }),
			],
		);
	});

	it("supports workspace-only restore without starting a new session", async () => {
		const applyWorkspaceCheckpoint = vi.fn(async () => undefined);
		const result = await new SessionVersioningService().restoreCheckpoint({
			sessionId: "source-session",
			checkpointRunCount: 1,
			restore: { messages: false, workspace: true },
			getSession: async () => makeSession(),
			readMessages: async () => {
				throw new Error("messages should not be read");
			},
			applyWorkspaceCheckpoint,
		});

		expect(result.sessionId).toBeUndefined();
		expect(result.checkpoint).toMatchObject({ ref: "aaaa", runCount: 1 });
		expect(applyWorkspaceCheckpoint).toHaveBeenCalledOnce();
	});

	it("raises typed validation errors", async () => {
		await expect(
			new SessionVersioningService().restoreCheckpoint({
				sessionId: "source-session",
				checkpointRunCount: 1,
				restore: { messages: true, workspace: false },
				getSession: async () => makeSession(),
				readMessages: async () => [],
			}),
		).rejects.toMatchObject({
			code: "invalid_restore",
			message: "start is required when restore.messages is true",
		} satisfies Partial<SessionVersioningError>);
	});
});
