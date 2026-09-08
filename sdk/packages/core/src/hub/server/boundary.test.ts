import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext, HubEventEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	SessionNotFoundError,
	type StartSessionInput,
	type StartSessionResult,
} from "../../runtime/host/runtime-host";
import { createSessionCompactionState } from "../../session/models/session-compaction";
import { SessionVersioningService } from "../../session/session-versioning-service";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "../server";
import {
	handleApprovalRespond,
	requestToolApproval,
} from "./handlers/approval-handlers";
import {
	ensureSessionParticipant,
	ensureSessionState,
	type HubTransportContext,
} from "./handlers/context";
import { projectSessionEvent } from "./handlers/session-event-projector";

describe("HubServerTransport boundaries", () => {
	function createTransport(options: Record<string, unknown> = {}) {
		const { sessionHost: sessionHostOverride, ...transportOptions } = options;
		return new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			sessionHost: {
				subscribe: vi.fn(),
				startSession: vi.fn(),
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockResolvedValue({
					sessionId: "session-1",
					status: "completed",
					startedAt: new Date(0).toISOString(),
					updatedAt: new Date(0).toISOString(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				}),
				getAccumulatedUsage: vi.fn().mockResolvedValue(undefined),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
				readSessionMessages: vi.fn(),
				...((sessionHostOverride as Record<string, unknown> | undefined) ?? {}),
			} as never,
			...transportOptions,
		});
	}

	function getContext(transport: HubServerTransport): HubTransportContext {
		return (transport as unknown as { ctx: HubTransportContext }).ctx;
	}

	it("continues publishing when one listener throws", () => {
		const transport = createTransport();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const delivered: string[] = [];

		try {
			transport.subscribe("bad", () => {
				throw new Error("listener boom");
			});
			transport.subscribe("good", (event) => {
				delivered.push(event.event);
			});

			(
				transport as unknown as {
					publish: (event: {
						event: string;
						timestamp: number;
						version: "v1";
						eventId: string;
					}) => void;
				}
			).publish({
				version: "v1",
				event: "ui.notify",
				eventId: "evt_1",
				timestamp: Date.now(),
			});

			expect(delivered).toEqual(["ui.notify"]);
			const logged = String(errorSpy.mock.calls[0]?.[0] ?? "");
			expect(logged.startsWith("[hub] ")).toBe(true);
			const payload = JSON.parse(logged.slice("[hub] ".length));
			expect(payload).toMatchObject({
				level: "error",
				component: "hub",
				message: "listener threw while publishing ui.notify",
			});
			expect(payload.error).toContain("listener boom");
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("keeps the hub available when the session search index cannot initialize", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cline-hub-search-unavailable-"));
		const dbPath = join(dir, "search.db");
		await writeFile(dbPath, "not a sqlite database");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const transport = createTransport({
			sessionSearchOptions: { dbPath },
			taskOptions: { dbPath: ":memory:", watchFiles: false },
		});

		try {
			expect(getContext(transport).sessionSearch.isAvailable()).toBe(false);
			const reply = await transport.handleCommand({
				version: "v1",
				requestId: "search-with-unavailable-index",
				command: "session.search",
				payload: { query: "parser" },
			});
			expect(reply.ok).toBe(true);
			expect(reply.payload?.hits).toEqual([]);
		} finally {
			await transport.stop();
			errorSpy.mockRestore();
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("serves indexed history and evicts a deleted session immediately", async () => {
		const session = {
			sessionId: "searchable-session",
			source: "core",
			pid: 1,
			startedAt: "2026-08-19T12:00:00.000Z",
			endedAt: "2026-08-19T12:01:00.000Z",
			exitCode: 0,
			status: "completed",
			interactive: true,
			provider: "test",
			model: "test-model",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			isSubagent: false,
			prompt: "Investigate indexing",
			metadata: { title: "Search prototype" },
			updatedAt: "2026-08-19T12:01:00.000Z",
		};
		const listSessions = vi.fn().mockResolvedValue([session]);
		const transport = createTransport({
			sessionSearchOptions: { dbPath: ":memory:" },
			taskOptions: { dbPath: ":memory:", watchFiles: false },
			sessionHost: {
				listSessions,
				deleteSession: vi.fn().mockResolvedValue(true),
				readSessionMessages: vi
					.fn()
					.mockResolvedValue([
						{ role: "user", content: "Find the ultramarine regression" },
					]),
			},
		});
		await getContext(transport).sessionSearch.refreshNow();

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "search-request",
			command: "session.search",
			payload: { query: "ultramarine" },
		});

		expect(reply.ok).toBe(true);
		expect(reply.payload?.hits).toEqual([
			expect.objectContaining({
				sessionId: "searchable-session",
				title: "Search prototype",
				role: "user",
			}),
		]);

		const deleteReply = await transport.handleCommand({
			version: "v1",
			requestId: "delete-searchable-session",
			command: "session.delete",
			payload: { sessionId: "searchable-session" },
		});
		const afterDelete = await transport.handleCommand({
			version: "v1",
			requestId: "search-after-delete",
			command: "session.search",
			payload: { query: "ultramarine" },
		});

		expect(deleteReply.payload?.deleted).toBe(true);
		expect(afterDelete.payload?.hits).toEqual([]);
		expect(listSessions).toHaveBeenCalledOnce();
		await transport.stop();
	});

	it("preserves canonical deletion results when search eviction fails", async () => {
		const deleteSession = vi.fn().mockResolvedValue(true);
		const transport = createTransport({
			sessionSearchOptions: { dbPath: ":memory:" },
			taskOptions: { dbPath: ":memory:", watchFiles: false },
			sessionHost: { deleteSession },
		});
		const ctx = getContext(transport);
		ensureSessionState(ctx, "deleted-session", "client-1", "creator");
		ensureSessionState(ctx, "restored-session", "client-1", "creator");
		const eviction = vi
			.spyOn(ctx.sessionSearch, "removeSession")
			.mockImplementation(() => {
				throw new Error("search index is unavailable");
			});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const restoreCheckpoint = vi
			.spyOn(SessionVersioningService.prototype, "restoreCheckpoint")
			.mockImplementationOnce(async (input) => {
				await input.cleanupStartedSession?.({
					sessionId: "restored-session",
				} as never);
				throw new Error("original restoration failure");
			});
		try {
			const deleteReply = await transport.handleCommand({
				version: "v1",
				requestId: "delete-with-failed-eviction",
				command: "session.delete",
				payload: { sessionId: "deleted-session" },
			});

			expect(deleteReply.ok).toBe(true);
			expect(deleteReply.payload?.deleted).toBe(true);
			expect(ctx.sessionState.has("deleted-session")).toBe(false);

			const restoreReply = await transport.handleCommand({
				version: "v1",
				requestId: "restore-with-failed-eviction",
				command: "session.restore",
				payload: {
					sessionId: "source-session",
					checkpointRunCount: 1,
					sessionConfig: {
						providerId: "test",
						modelId: "test-model",
						cwd: "/tmp/project",
						workspaceRoot: "/tmp/project",
					},
				},
			});

			expect(restoreReply.ok).toBe(false);
			expect(restoreReply.error?.message).toContain(
				"original restoration failure",
			);
			expect(restoreReply.error?.message).not.toContain(
				"search index is unavailable",
			);
			expect(ctx.sessionState.has("restored-session")).toBe(false);
			expect(deleteSession).toHaveBeenNthCalledWith(1, "deleted-session");
			expect(deleteSession).toHaveBeenNthCalledWith(2, "restored-session");
			expect(eviction).toHaveBeenCalledTimes(2);
		} finally {
			restoreCheckpoint.mockRestore();
			eviction.mockRestore();
			errorSpy.mockRestore();
			await transport.stop();
		}
	});

	it("evicts an indexed replacement when failed restoration cleans it up", async () => {
		const replacement = {
			sessionId: "restored-session",
			source: "core",
			pid: 1,
			startedAt: "2026-08-19T12:00:00.000Z",
			endedAt: "2026-08-19T12:01:00.000Z",
			exitCode: 0,
			status: "completed",
			interactive: true,
			provider: "test",
			model: "test-model",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			isSubagent: false,
			prompt: "Find the orphanmarker regression",
			metadata: { title: "Orphanmarker replacement" },
			updatedAt: "2026-08-19T12:01:00.000Z",
		};
		const sessions = [replacement];
		const listSessions = vi.fn(async () => sessions);
		const deleteSession = vi.fn(async (sessionId: string) => {
			expect(sessionId).toBe(replacement.sessionId);
			sessions.splice(0);
			return true;
		});
		const transport = createTransport({
			sessionSearchOptions: { dbPath: ":memory:" },
			taskOptions: { dbPath: ":memory:", watchFiles: false },
			sessionHost: {
				listSessions,
				deleteSession,
				readSessionMessages: vi
					.fn()
					.mockResolvedValue([
						{ role: "user", content: "Find the orphanmarker regression" },
					]),
			},
		});
		await getContext(transport).sessionSearch.refreshNow();
		expect(
			getContext(transport).sessionSearch.search({ query: "orphanmarker" }),
		).toHaveLength(1);

		const restoreCheckpoint = vi
			.spyOn(SessionVersioningService.prototype, "restoreCheckpoint")
			.mockImplementationOnce(async (input) => {
				await input.cleanupStartedSession?.({
					sessionId: replacement.sessionId,
				} as never);
				throw new Error("restore failed after replacement indexing");
			});
		try {
			const restoreReply = await transport.handleCommand({
				version: "v1",
				requestId: "restore-with-indexed-replacement",
				command: "session.restore",
				payload: {
					sessionId: "source-session",
					checkpointRunCount: 1,
					sessionConfig: {
						providerId: "test",
						modelId: "test-model",
						cwd: "/tmp/project",
						workspaceRoot: "/tmp/project",
					},
				},
			});

			expect(restoreReply.ok).toBe(false);
			expect(restoreReply.error?.message).toContain(
				"restore failed after replacement indexing",
			);
			expect(
				getContext(transport).sessionSearch.search({ query: "orphanmarker" }),
			).toEqual([]);
			expect(deleteSession).toHaveBeenCalledOnce();
			expect(listSessions).toHaveBeenCalledOnce();
		} finally {
			restoreCheckpoint.mockRestore();
			await transport.stop();
		}
	});

	it("delegates pathless session.create and returns the host-resolved workspace", async () => {
		let resolvedWorkspace = "";
		let capturedStartInput: StartSessionInput | undefined;
		const startSession = vi.fn(
			async (input: StartSessionInput): Promise<StartSessionResult> => {
				capturedStartInput = input;
				const sessionId = input.config.sessionId?.trim() || "missing-session";
				resolvedWorkspace = "/home/host/.cline/data/workspaces/chat";
				return {
					sessionId,
					manifest: {
						version: 1,
						session_id: sessionId,
						source: "core",
						pid: 1,
						started_at: new Date(0).toISOString(),
						status: "running",
						interactive: true,
						provider: "cline",
						model: "test-model",
						cwd: resolvedWorkspace,
						workspace_root: resolvedWorkspace,
						enable_tools: true,
						enable_spawn: true,
						enable_teams: false,
					},
					manifestPath: "",
					messagesPath: "",
					result: undefined,
				};
			},
		);
		const transport = createTransport({
			sessionHost: {
				startSession,
				getSession: vi.fn().mockImplementation(async (sessionId: string) => ({
					sessionId,
					source: "core",
					status: "running",
					startedAt: new Date(0).toISOString(),
					updatedAt: new Date(0).toISOString(),
					interactive: true,
					provider: "cline",
					model: "test-model",
					cwd: resolvedWorkspace,
					workspaceRoot: resolvedWorkspace,
					enableTools: true,
					enableSpawn: true,
					enableTeams: false,
					isSubagent: false,
				})),
			},
		});

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-pathless-create",
			command: "session.create",
			clientId: "client-1",
			payload: {
				sessionConfig: {
					sessionId: "session-boundary",
					providerId: "cline",
					modelId: "test-model",
					systemPrompt: "system",
				},
				metadata: { source: "core", interactive: true },
			},
		});

		expect(reply.ok).toBe(true);
		expect(startSession).toHaveBeenCalledTimes(1);
		expect(capturedStartInput?.config.sessionId).toBe("session-boundary");
		expect(capturedStartInput?.config.cwd).toBeUndefined();
		expect(capturedStartInput?.config.workspaceRoot).toBeUndefined();
		expect(reply.payload?.session).toMatchObject({
			cwd: resolvedWorkspace,
			workspaceRoot: resolvedWorkspace,
		});
		expect(reply.payload?.snapshot).toMatchObject({
			workspace: {
				cwd: resolvedWorkspace,
				root: resolvedWorkspace,
			},
		});
	});

	it("denies non-interactive approval requests immediately", async () => {
		const transport = createTransport();
		const ctx = getContext(transport);
		ensureSessionState(ctx, "session-1", "client-1", "creator", {
			interactive: false,
		});

		const result = await requestToolApproval(ctx, {
			sessionId: "session-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 1,
			toolCallId: "call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});

		expect(result).toEqual({
			approved: false,
			reason:
				"Tool approval requires an interactive session, but this session is non-interactive.",
		});
	});

	it("serves session messages from the hub-owned session host", async () => {
		const messages = [
			{
				role: "user",
				content: [{ type: "text", text: "created elsewhere" }],
			},
		];
		const readMessages = vi.fn().mockResolvedValue(messages);
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				startSession: vi.fn(),
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockResolvedValue({
					sessionId: "session-1",
					source: "cli",
					pid: 123,
					startedAt: new Date(0).toISOString(),
					status: "completed",
					interactive: false,
					provider: "cline",
					model: "test-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: true,
					enableSpawn: true,
					enableTeams: false,
					updatedAt: new Date(0).toISOString(),
				}),
				getAccumulatedUsage: vi.fn().mockResolvedValue(undefined),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
				readSessionMessages: readMessages,
			} as never,
		});

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-1",
			command: "session.messages",
			sessionId: "session-1",
		});

		expect(readMessages).toHaveBeenCalledWith("session-1");
		expect(reply).toMatchObject({
			version: "v1",
			requestId: "req-1",
			ok: true,
			payload: { sessionId: "session-1", messages },
		});
	});

	it("includes accumulated usage on session.get", async () => {
		const usage = {
			inputTokens: 10,
			outputTokens: 3,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
			totalCost: 0.11,
		};
		const aggregateUsage = {
			inputTokens: 17,
			outputTokens: 8,
			cacheReadTokens: 3,
			cacheWriteTokens: 3,
			totalCost: 0.23,
		};
		const getAccumulatedUsage = vi
			.fn()
			.mockResolvedValue({ usage, aggregateUsage });
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				startSession: vi.fn(),
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockResolvedValue({
					sessionId: "session-1",
					source: "cli",
					pid: 123,
					startedAt: new Date(0).toISOString(),
					status: "completed",
					interactive: false,
					provider: "cline",
					model: "test-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: true,
					enableSpawn: true,
					enableTeams: true,
					updatedAt: new Date(0).toISOString(),
				}),
				getAccumulatedUsage,
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
				readSessionMessages: vi.fn(),
			} as never,
		});

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-usage",
			command: "session.get",
			sessionId: "session-1",
		});

		expect(getAccumulatedUsage).toHaveBeenCalledWith("session-1");
		expect(reply).toMatchObject({
			version: "v1",
			requestId: "req-usage",
			ok: true,
			payload: {
				session: {
					sessionId: "session-1",
					usage,
					aggregateUsage,
				},
			},
		});
	});

	it("returns session_not_found when session messages are requested for an unknown session", async () => {
		const readMessages = vi.fn().mockResolvedValue([]);
		const telemetry = { capture: vi.fn() };
		const transport = createTransport({
			telemetry,
			sessionHost: {
				subscribe: vi.fn(),
				startSession: vi.fn(),
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockResolvedValue(undefined),
				getAccumulatedUsage: vi.fn().mockResolvedValue(undefined),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
				readSessionMessages: readMessages,
			} as never,
		});

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-1",
			command: "session.messages",
			sessionId: "missing-session",
		});

		expect(readMessages).not.toHaveBeenCalled();
		expect(reply).toMatchObject({
			version: "v1",
			requestId: "req-1",
			ok: false,
			error: {
				code: "session_not_found",
				message: "Unknown session: missing-session",
			},
		});
		expect(telemetry.capture).toHaveBeenCalledWith({
			event: "sdk.error",
			properties: expect.objectContaining({
				component: "core",
				operation: "hub.command_reply",
				severity: "warn",
				handled: true,
				command: "session.messages",
				requestId: "req-1",
				sessionId: "missing-session",
				errorCode: "session_not_found",
				error_message: "Unknown session: missing-session",
			}),
		});
	});

	it("keeps session list and get lightweight unless snapshots are requested", async () => {
		const readSessionMessages = vi
			.fn()
			.mockResolvedValue([{ role: "user", content: "heavy transcript" }]);
		const session = {
			sessionId: "session-1",
			source: "cli",
			status: "completed",
			startedAt: new Date(0).toISOString(),
			updatedAt: new Date(0).toISOString(),
			workspaceRoot: "/tmp/project",
			cwd: "/tmp/project",
			interactive: true,
			provider: "cline",
			model: "test-model",
			enableTools: true,
			enableSpawn: true,
			enableTeams: false,
		};
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				startSession: vi.fn(),
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockResolvedValue(session),
				getAccumulatedUsage: vi.fn().mockResolvedValue(undefined),
				listSessions: vi.fn().mockResolvedValue([session]),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
				readSessionMessages,
			} as never,
		});

		const listReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-list",
			command: "session.list",
			payload: { limit: 10 },
		});
		const getReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-get",
			command: "session.get",
			sessionId: "session-1",
		});

		expect(listReply.payload?.sessions).toHaveLength(1);
		expect(listReply.payload).not.toHaveProperty("snapshots");
		expect(getReply.payload).toHaveProperty("session");
		expect(getReply.payload).not.toHaveProperty("snapshot");
		expect(readSessionMessages).not.toHaveBeenCalled();

		const snapshotReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-get-snapshot",
			command: "session.get",
			sessionId: "session-1",
			payload: { includeSnapshot: true },
		});

		expect(snapshotReply.payload).toHaveProperty("snapshot");
		// Snapshots are state notifications: even when requested they never
		// carry (or read) the transcript — that's session.messages' job.
		expect(readSessionMessages).not.toHaveBeenCalled();
		expect(
			snapshotReply.payload?.snapshot as Record<string, unknown>,
		).not.toHaveProperty("messages");
	});

	it("keeps interactive approval requests pending until a response arrives", async () => {
		vi.useFakeTimers();
		try {
			const transport = createTransport();
			const events: HubEventEnvelope[] = [];
			let approvalId = "";
			transport.subscribe("test", (event) => {
				events.push(event);
				if (
					event.event === "approval.requested" &&
					typeof event.payload?.approvalId === "string"
				) {
					approvalId = event.payload.approvalId;
				}
			});
			const ctx = getContext(transport);
			ensureSessionState(ctx, "session-1", "client-1", "creator", {
				interactive: true,
			});

			let settled: unknown;
			const resultPromise = requestToolApproval(ctx, {
				sessionId: "session-1",
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 1,
				toolCallId: "call-1",
				toolName: "run_commands",
				input: { commands: ["echo hi"] },
				policy: { autoApprove: false },
			});
			resultPromise.then((result) => {
				settled = result;
			});

			await vi.advanceTimersByTimeAsync(10_000);
			await Promise.resolve();

			expect(settled).toBeUndefined();
			expect(approvalId).toMatch(/^approval_/);
			const requested = events.find(
				(event) => event.event === "approval.requested",
			);
			expect(requested?.sessionId).toBe("session-1");
			expect(requested?.payload).toMatchObject({
				sessionId: "session-1",
				conversationId: "conversation-1",
			});
			const reply = handleApprovalRespond(ctx, {
				version: "v1",
				requestId: "req-1",
				command: "approval.respond",
				payload: {
					approvalId,
					approved: true,
					reason: "approved by user",
				},
			});

			await expect(reply).resolves.toMatchObject({ ok: true });
			await expect(resultPromise).resolves.toEqual({
				approved: true,
				reason: "approved by user",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("replays a pending approval to a client that (re)subscribes after it was raised", async () => {
		const transport = createTransport();
		const ctx = getContext(transport);
		ensureSessionState(ctx, "session-1", "client-1", "creator", {
			interactive: true,
		});

		// No subscriber is attached yet: the approval is raised into the void.
		const resultPromise = requestToolApproval(ctx, {
			sessionId: "session-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 1,
			toolCallId: "call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});

		// Let the request actually publish (it awaits ctx.sessionHost.getSession
		// first) before anyone subscribes, so this exercises replay-on-subscribe
		// rather than catching a live broadcast in that async gap.
		for (let i = 0; i < 50 && ctx.pendingApprovals.size === 0; i += 1) {
			await Promise.resolve();
		}
		expect(ctx.pendingApprovals.size).toBe(1);

		// A client subscribing after the fact must still see the request.
		const events: HubEventEnvelope[] = [];
		transport.subscribe("late-client", (event) => events.push(event));
		await Promise.resolve();
		await Promise.resolve();

		const requested = events.find(
			(event) => event.event === "approval.requested",
		);
		expect(requested?.payload).toMatchObject({
			sessionId: "session-1",
			conversationId: "conversation-1",
			toolCallId: "call-1",
		});

		const approvalId = requested?.payload?.approvalId as string;
		await handleApprovalRespond(ctx, {
			version: "v1",
			requestId: "req-late",
			command: "approval.respond",
			payload: { approvalId, approved: true },
		});
		await expect(resultPromise).resolves.toEqual({
			approved: true,
			reason: undefined,
		});
	});

	it("rejects pending tool approvals when a run is aborted", async () => {
		const abort = vi.fn().mockResolvedValue(undefined);
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				startSession: vi.fn(),
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort,
				dispose: vi.fn(),
				getSession: vi.fn(),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
			} as never,
		});
		const ctx = getContext(transport);
		const events: HubEventEnvelope[] = [];
		let approvalId = "";
		transport.subscribe("test", (event) => {
			events.push(event);
			if (
				event.event === "approval.requested" &&
				typeof event.payload?.approvalId === "string"
			) {
				approvalId = event.payload.approvalId;
			}
		});
		ensureSessionState(ctx, "session-1", "client-1", "creator", {
			interactive: true,
		});

		const resultPromise = requestToolApproval(ctx, {
			sessionId: "session-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 1,
			toolCallId: "call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});
		await Promise.resolve();

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-abort",
			command: "run.abort",
			sessionId: "session-1",
			payload: { reason: "user cancelled" },
		});

		expect(reply.ok).toBe(true);
		expect(abort).toHaveBeenCalledWith("session-1", "user cancelled");
		expect(ctx.pendingApprovals.has(approvalId)).toBe(false);
		await expect(resultPromise).resolves.toEqual({
			approved: false,
			reason: "user cancelled",
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					event: "approval.resolved",
					sessionId: "session-1",
					payload: expect.objectContaining({
						approvalId,
						approved: false,
						cancelled: true,
						reason: "user cancelled",
					}),
				}),
			]),
		);
	});

	it("publishes capability-backed tools on the hub session stream", async () => {
		let capturedStartInput: StartSessionInput | undefined;
		const startSession = vi.fn(
			async (input: StartSessionInput): Promise<StartSessionResult> => {
				capturedStartInput = input;
				const sessionId = input.config.sessionId?.trim() || "missing-session";
				return {
					sessionId,
					manifest: {
						version: 1,
						session_id: sessionId,
						source: "cli",
						pid: 1,
						started_at: new Date(0).toISOString(),
						status: "running",
						interactive: true,
						provider: "cline",
						model: "test-model",
						cwd: "/tmp/project",
						workspace_root: "/tmp/project",
						enable_tools: true,
						enable_spawn: true,
						enable_teams: false,
					},
					manifestPath: "",
					messagesPath: "",
					result: undefined,
				};
			},
		);
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				startSession,
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockImplementation(async (sessionId: string) => ({
					sessionId,
					status: "running",
					startedAt: new Date(0).toISOString(),
					updatedAt: new Date(0).toISOString(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				})),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
				readSessionMessages: vi.fn(),
			} as never,
		});
		const events: HubEventEnvelope[] = [];
		transport.subscribe("client-1", (event) => events.push(event));

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-create",
			command: "session.create",
			clientId: "client-1",
			payload: {
				workspaceRoot: "/tmp/project",
				cwd: "/tmp/project",
				sessionConfig: {
					providerId: "cline",
					modelId: "test-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					systemPrompt: "system",
				},
				metadata: { source: "cli", interactive: true },
				runtimeOptions: {
					clientContributions: [
						{
							kind: "toolExecutor",
							executor: "askQuestion",
							capabilityName: "tool_executor.askQuestion",
						},
					],
				},
			},
		});

		expect(reply.ok).toBe(true);
		const sessionId = capturedStartInput?.config.sessionId?.trim() || "";
		expect(sessionId).toMatch(/^[0-9]/);
		const askQuestion =
			capturedStartInput?.capabilities?.toolExecutors?.askQuestion;
		if (!askQuestion) {
			throw new Error("Expected askQuestion executor to be registered");
		}
		const toolContext: AgentToolContext = {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		};
		const answerPromise = askQuestion(
			"Which path?",
			["Use hub", "Use local"],
			toolContext,
		);
		await Promise.resolve();

		const request = events.find(
			(event) => event.event === "capability.requested",
		);
		expect(request?.sessionId).toBe(sessionId);
		expect(request?.payload?.payload).toMatchObject({
			context: { conversationId: "conv-1" },
		});
		expect(request?.payload?.targetClientId).toBe("client-1");
		const requestId =
			typeof request?.payload?.requestId === "string"
				? request.payload.requestId
				: "";
		expect(requestId).toMatch(/^capreq_/);

		await transport.handleCommand({
			version: "v1",
			requestId: "req-response",
			command: "capability.respond",
			clientId: "client-1",
			sessionId,
			payload: {
				requestId,
				ok: true,
				payload: { result: "Use hub" },
			},
		});

		await expect(answerPromise).resolves.toBe("Use hub");
	});

	it("does not transfer capability ownership to attached clients", async () => {
		let createdSessionId = "";
		const startSession = vi.fn(async (input: StartSessionInput) => {
			createdSessionId = input.config.sessionId?.trim() || "missing-session";
			return {
				sessionId: createdSessionId,
				manifest: {
					version: 1,
					session_id: createdSessionId,
					source: "cli",
					pid: 1,
					started_at: new Date(0).toISOString(),
					status: "running",
					interactive: true,
					provider: "cline",
					model: "test-model",
					cwd: "/tmp/project",
					workspace_root: "/tmp/project",
					enable_tools: true,
					enable_spawn: true,
					enable_teams: false,
				},
				manifestPath: "",
				messagesPath: "",
				result: undefined,
			};
		});
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				startSession,
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockImplementation(async (sessionId: string) => ({
					sessionId,
					status: "running",
					startedAt: new Date(0).toISOString(),
					updatedAt: new Date(0).toISOString(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
					metadata: { hubCapabilityOwnerClientId: "owner-client" },
				})),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
				readSessionMessages: vi.fn(),
			} as never,
		});
		const events: HubEventEnvelope[] = [];
		transport.subscribe("owner-client", (event) => events.push(event));

		await transport.handleCommand({
			version: "v1",
			requestId: "req-create",
			command: "session.create",
			clientId: "owner-client",
			payload: {
				workspaceRoot: "/tmp/project",
				cwd: "/tmp/project",
				sessionConfig: {
					providerId: "cline",
					modelId: "test-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					systemPrompt: "system",
				},
				metadata: { source: "cli", interactive: true },
				runtimeOptions: {
					clientContributions: [
						{
							kind: "toolExecutor",
							executor: "askQuestion",
							capabilityName: "tool_executor.askQuestion",
						},
					],
				},
			},
		});
		await transport.handleCommand({
			version: "v1",
			requestId: "req-attach",
			command: "session.attach",
			clientId: "viewer-client",
			sessionId: createdSessionId,
		});

		const askQuestion =
			startSession.mock.calls[0]?.[0].capabilities?.toolExecutors?.askQuestion;
		if (!askQuestion) throw new Error("Expected askQuestion executor");
		const answerPromise = askQuestion("Which path?", ["Use hub"], {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		});
		await Promise.resolve();

		const request = events.find(
			(event) => event.event === "capability.requested",
		);
		expect(request?.payload?.targetClientId).toBe("owner-client");
		const requestId = String(request?.payload?.requestId ?? "");
		await transport.handleCommand({
			version: "v1",
			requestId: "req-response",
			command: "capability.respond",
			clientId: "owner-client",
			sessionId: createdSessionId,
			payload: { requestId, ok: true, payload: { result: "Use hub" } },
		});

		await expect(answerPromise).resolves.toBe("Use hub");
	});

	it("rejects capability responses from non-owner clients", async () => {
		const transport = createTransport();
		const ctx = getContext(transport);
		ctx.pendingCapabilityRequests.set("capreq-1", {
			sessionId: "session-1",
			targetClientId: "owner-client",
			capabilityName: "tool_executor.askQuestion",
			resolve: vi.fn(),
		});

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-response",
			command: "capability.respond",
			clientId: "viewer-client",
			sessionId: "session-1",
			payload: { requestId: "capreq-1", ok: true, payload: { result: "no" } },
		});

		expect(reply).toMatchObject({
			ok: false,
			error: { code: "capability_wrong_client" },
		});
		expect(ctx.pendingCapabilityRequests.has("capreq-1")).toBe(true);
	});

	it("does not let session metadata updates overwrite server-owned compaction owner", async () => {
		const updateSession = vi.fn().mockResolvedValue({ updated: true });
		const transport = createTransport({
			sessionHost: {
				updateSession,
			},
		});

		await transport.handleCommand({
			version: "v1",
			requestId: "req-update",
			command: "session.update",
			clientId: "attacker-client",
			sessionId: "session-1",
			payload: {
				metadata: {
					hubCapabilityOwnerClientId: "attacker-client",
					autoApproveTools: true,
					title: "safe title",
				},
			},
		});

		expect(updateSession).toHaveBeenCalledWith("session-1", {
			metadata: { title: "safe title" },
		});
	});

	it("authorizes compaction sidecar access from server session state, not mutable metadata", async () => {
		const readSessionCompactionState = vi.fn();
		const transport = createTransport({
			sessionHost: {
				getSession: vi.fn().mockResolvedValue({
					sessionId: "session-1",
					status: "completed",
					startedAt: new Date(0).toISOString(),
					updatedAt: new Date(0).toISOString(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
					metadata: { hubCapabilityOwnerClientId: "attacker-client" },
				}),
				readSessionCompactionState,
			},
		});
		const ctx = getContext(transport);
		ensureSessionState(ctx, "session-1", "owner-client", "creator");

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-compact",
			command: "session.compaction.get",
			clientId: "attacker-client",
			sessionId: "session-1",
		});

		expect(reply).toMatchObject({
			ok: false,
			error: { code: "session_wrong_client" },
		});
		expect(readSessionCompactionState).not.toHaveBeenCalled();
	});

	it("does not grant compaction sidecar ownership from session attach", async () => {
		const state = createSessionCompactionState({
			sourceMessages: [{ role: "user", content: "source" }],
			compactedMessages: [{ role: "user", content: "summary" }],
			conversationId: "session-1",
		});
		const readSessionCompactionState = vi.fn().mockResolvedValue(state);
		const updateSessionCompactionState = vi
			.fn()
			.mockResolvedValue({ updated: true });
		const transport = createTransport({
			sessionHost: {
				readSessionCompactionState,
				updateSessionCompactionState,
			},
		});
		const ctx = getContext(transport);
		expect(ctx.sessionState.has("session-1")).toBe(false);

		const attachReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-attach",
			command: "session.attach",
			clientId: "viewer-client",
			sessionId: "session-1",
		});

		expect(attachReply).toMatchObject({ ok: true });
		expect(
			ctx.sessionState.get("session-1")?.createdByClientId,
		).toBeUndefined();
		expect(
			ctx.sessionState.get("session-1")?.participants.has("viewer-client"),
		).toBe(true);

		const getReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-compact-get",
			command: "session.compaction.get",
			clientId: "viewer-client",
			sessionId: "session-1",
		});
		const updateReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-compact-update",
			command: "session.compaction.update",
			clientId: "viewer-client",
			sessionId: "session-1",
			payload: { state },
		});

		expect(getReply).toMatchObject({
			ok: false,
			error: { code: "session_wrong_client" },
		});
		expect(updateReply).toMatchObject({
			ok: false,
			error: { code: "session_wrong_client" },
		});
		expect(readSessionCompactionState).not.toHaveBeenCalled();
		expect(updateSessionCompactionState).not.toHaveBeenCalled();
	});

	it("allows a creator to claim ownerless compaction sidecar ownership", async () => {
		const state = createSessionCompactionState({
			sourceMessages: [{ role: "user", content: "source" }],
			compactedMessages: [{ role: "user", content: "summary" }],
			conversationId: "session-1",
		});
		const readSessionCompactionState = vi.fn().mockResolvedValue(state);
		const transport = createTransport({
			sessionHost: { readSessionCompactionState },
		});
		const ctx = getContext(transport);
		ensureSessionParticipant(ctx, "session-1", "viewer-client", "participant");

		expect(
			ctx.sessionState.get("session-1")?.createdByClientId,
		).toBeUndefined();

		ensureSessionState(ctx, "session-1", "owner-client", "creator");

		expect(ctx.sessionState.get("session-1")?.createdByClientId).toBe(
			"owner-client",
		);
		expect(
			ctx.sessionState.get("session-1")?.participants.has("viewer-client"),
		).toBe(true);

		const getReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-compact-get",
			command: "session.compaction.get",
			clientId: "owner-client",
			sessionId: "session-1",
		});

		expect(getReply).toMatchObject({
			ok: true,
			payload: { state },
		});
		expect(readSessionCompactionState).toHaveBeenCalledWith("session-1");
	});

	it("clears compaction sidecar ownership when the owner detaches", async () => {
		const readSessionCompactionState = vi.fn();
		const transport = createTransport({
			sessionHost: { readSessionCompactionState },
		});
		const ctx = getContext(transport);
		ensureSessionState(ctx, "session-1", "owner-client", "creator");
		ensureSessionParticipant(ctx, "session-1", "viewer-client", "participant");

		const detachReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-detach",
			command: "session.detach",
			clientId: "owner-client",
			sessionId: "session-1",
		});

		expect(detachReply).toMatchObject({ ok: true });
		expect(
			ctx.sessionState.get("session-1")?.participants.has("viewer-client"),
		).toBe(true);
		expect(
			ctx.sessionState.get("session-1")?.createdByClientId,
		).toBeUndefined();

		const getReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-compact-get",
			command: "session.compaction.get",
			clientId: "viewer-client",
			sessionId: "session-1",
		});

		expect(getReply).toMatchObject({
			ok: false,
			error: { code: "session_wrong_client" },
		});
		expect(readSessionCompactionState).not.toHaveBeenCalled();
	});

	it("clears compaction sidecar ownership when the owner unregisters", async () => {
		const readSessionCompactionState = vi.fn();
		const transport = createTransport({
			sessionHost: { readSessionCompactionState },
		});
		const ctx = getContext(transport);
		ensureSessionState(ctx, "session-1", "owner-client", "creator");
		ensureSessionParticipant(ctx, "session-1", "viewer-client", "participant");

		const unregisterReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-unregister",
			command: "client.unregister",
			clientId: "owner-client",
		});

		expect(unregisterReply).toMatchObject({ ok: true });
		expect(
			ctx.sessionState.get("session-1")?.participants.has("viewer-client"),
		).toBe(true);
		expect(
			ctx.sessionState.get("session-1")?.createdByClientId,
		).toBeUndefined();

		const getReply = await transport.handleCommand({
			version: "v1",
			requestId: "req-compact-get",
			command: "session.compaction.get",
			clientId: "viewer-client",
			sessionId: "session-1",
		});

		expect(getReply).toMatchObject({
			ok: false,
			error: { code: "session_wrong_client" },
		});
		expect(readSessionCompactionState).not.toHaveBeenCalled();
	});

	it("returns compaction sidecar state to the server-owned session client", async () => {
		const state = createSessionCompactionState({
			sourceMessages: [{ role: "user", content: "source" }],
			compactedMessages: [{ role: "user", content: "summary" }],
			conversationId: "session-1",
		});
		const readSessionCompactionState = vi.fn().mockResolvedValue(state);
		const transport = createTransport({
			sessionHost: { readSessionCompactionState },
		});
		const ctx = getContext(transport);
		ensureSessionState(ctx, "session-1", "owner-client", "creator");

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-compact-get",
			command: "session.compaction.get",
			clientId: "owner-client",
			sessionId: "session-1",
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: { sessionId: "session-1", state },
		});
		expect(readSessionCompactionState).toHaveBeenCalledWith("session-1");
	});

	it("rejects invalid compaction sidecar updates before calling the session host", async () => {
		const updateSessionCompactionState = vi.fn();
		const transport = createTransport({
			sessionHost: { updateSessionCompactionState },
		});
		const ctx = getContext(transport);
		ensureSessionState(ctx, "session-1", "owner-client", "creator");

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-compact-update-invalid",
			command: "session.compaction.update",
			clientId: "owner-client",
			sessionId: "session-1",
			payload: { state: { version: 1, messages: "bad" } },
		});

		expect(reply).toMatchObject({
			ok: false,
			error: { code: "invalid_compaction_state" },
		});
		expect(updateSessionCompactionState).not.toHaveBeenCalled();
	});

	it("never captures the transcript into event or reply snapshots", async () => {
		const transcript = [
			{ role: "user", content: [{ type: "text", text: "hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "world" }] },
		];
		let capturedSessionListener:
			| ((event: Record<string, unknown>) => void)
			| undefined;
		const readSessionMessages = vi.fn().mockResolvedValue(transcript);
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(
					(listener: (event: Record<string, unknown>) => void) => {
						capturedSessionListener = listener;
						return () => {};
					},
				),
				updateSession: vi.fn().mockResolvedValue({ updated: true }),
				readSessionMessages,
			},
		});
		const ctx = getContext(transport);
		const events: HubEventEnvelope[] = [];
		ensureSessionState(ctx, "session-1", "owner-client", "creator");
		transport.subscribe("owner-client", (event) => events.push(event));

		// A status change projects a session.updated whose snapshot carries
		// state (status, usage, ...) but never the conversation — the session
		// host's transcript must not even be read for it.
		capturedSessionListener?.({
			type: "status",
			payload: { sessionId: "session-1", status: "running" },
		});
		await vi.waitFor(() => {
			expect(events.some((event) => event.event === "session.updated")).toBe(
				true,
			);
		});
		const statusEvent = events.find(
			(event) => event.event === "session.updated",
		);
		const statusSnapshot = statusEvent?.payload?.snapshot as Record<
			string,
			unknown
		>;
		expect(statusSnapshot.status).toBe("completed");
		expect(statusSnapshot).not.toHaveProperty("messages");

		// A session.update command: neither the published event nor the reply
		// snapshot contains messages (clients fetch them via session.messages).
		events.length = 0;
		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-update-no-transcript",
			command: "session.update",
			clientId: "owner-client",
			sessionId: "session-1",
			payload: { metadata: { title: "renamed" } },
		});
		const replySnapshot = reply.payload?.snapshot as Record<string, unknown>;
		expect(replySnapshot).not.toHaveProperty("messages");
		const updated = events.find((event) => event.event === "session.updated");
		expect(updated).toBeDefined();
		const updatedSnapshot = updated?.payload?.snapshot as Record<
			string,
			unknown
		>;
		expect(updatedSnapshot).not.toHaveProperty("messages");
		expect(updatedSnapshot.status).toBe("completed");
		expect(readSessionMessages).not.toHaveBeenCalled();
	});

	it("publishes session updates after successful compaction sidecar updates", async () => {
		const state = createSessionCompactionState({
			sourceMessages: [{ role: "user", content: "source" }],
			compactedMessages: [{ role: "user", content: "summary" }],
			conversationId: "session-1",
		});
		const updateSessionCompactionState = vi
			.fn()
			.mockResolvedValue({ updated: true });
		const transport = createTransport({
			sessionHost: { updateSessionCompactionState },
		});
		const ctx = getContext(transport);
		const events: HubEventEnvelope[] = [];
		ensureSessionState(ctx, "session-1", "owner-client", "creator");
		transport.subscribe("owner-client", (event) => events.push(event));

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-compact-update",
			command: "session.compaction.update",
			clientId: "owner-client",
			sessionId: "session-1",
			payload: { state },
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: { updated: true },
		});
		expect(updateSessionCompactionState).toHaveBeenCalledWith(
			"session-1",
			state,
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					event: "session.updated",
					sessionId: "session-1",
				}),
			]),
		);
	});

	it("does not publish session updates when compaction sidecar update is stale", async () => {
		const state = createSessionCompactionState({
			sourceMessages: [{ role: "user", content: "source" }],
			compactedMessages: [{ role: "user", content: "summary" }],
			conversationId: "session-1",
		});
		const updateSessionCompactionState = vi
			.fn()
			.mockResolvedValue({ updated: false });
		const transport = createTransport({
			sessionHost: { updateSessionCompactionState },
		});
		const ctx = getContext(transport);
		const events: HubEventEnvelope[] = [];
		ensureSessionState(ctx, "session-1", "owner-client", "creator");
		transport.subscribe("owner-client", (event) => events.push(event));

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-compact-stale",
			command: "session.compaction.update",
			clientId: "owner-client",
			sessionId: "session-1",
			payload: { state },
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: { updated: false },
		});
		expect(events).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ event: "session.updated" }),
			]),
		);
	});

	it("cancels pending capability requests when a run is aborted", async () => {
		const abort = vi.fn().mockResolvedValue(undefined);
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				startSession: vi.fn(),
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort,
				dispose: vi.fn(),
				getSession: vi.fn(),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
			} as never,
		});
		const ctx = getContext(transport);
		const resolved = vi.fn();
		const events: HubEventEnvelope[] = [];
		transport.subscribe("owner-client", (event) => events.push(event));
		ctx.pendingCapabilityRequests.set("capreq-1", {
			sessionId: "session-1",
			targetClientId: "owner-client",
			capabilityName: "tool_executor.askQuestion",
			resolve: resolved,
		});

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-abort",
			command: "run.abort",
			sessionId: "session-1",
			payload: { reason: "user cancelled" },
		});

		expect(reply.ok).toBe(true);
		expect(resolved).toHaveBeenCalledWith({
			ok: false,
			error: "user cancelled",
		});
		expect(ctx.pendingCapabilityRequests.has("capreq-1")).toBe(false);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					event: "capability.resolved",
					payload: expect.objectContaining({
						requestId: "capreq-1",
						cancelled: true,
					}),
				}),
			]),
		);
	});

	it("returns session_not_found when a run starts against a stale active session", async () => {
		const runTurn = vi
			.fn()
			.mockRejectedValue(new SessionNotFoundError("stale-session"));
		const transport = createTransport({
			sessionHost: {
				runTurn,
				getSession: vi.fn().mockResolvedValue({
					sessionId: "stale-session",
					source: "cli",
					pid: 123,
					startedAt: new Date(0).toISOString(),
					status: "running",
					interactive: true,
					provider: "cline",
					model: "test-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: true,
					enableSpawn: true,
					enableTeams: false,
					updatedAt: new Date(0).toISOString(),
				}),
			},
		});
		const events: HubEventEnvelope[] = [];
		transport.subscribe("client-1", (event) => events.push(event));

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-stale-run",
			command: "run.start",
			clientId: "client-1",
			sessionId: "stale-session",
			payload: { prompt: "continue" },
		});

		expect(runTurn).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: "stale-session" }),
		);
		expect(reply).toMatchObject({
			version: "v1",
			requestId: "req-stale-run",
			ok: false,
			error: {
				code: "session_not_found",
				message: "session not found: stale-session",
			},
		});
		expect(events.some((event) => event.event === "run.failed")).toBe(false);
	});

	it("forwards run file attachment paths to the session host", async () => {
		const runTurn = vi.fn().mockResolvedValue(undefined);
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				startSession: vi.fn(),
				stopSession: vi.fn(),
				runTurn,
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
			} as never,
		});

		const reply = await (
			transport as unknown as {
				handleCommand: (envelope: {
					version: "v1";
					requestId: string;
					command: "run.start";
					sessionId: string;
					payload: {
						sessionId: string;
						prompt: string;
						mode?: string;
						attachments: { userFiles: string[] };
					};
				}) => Promise<{ ok: boolean }>;
			}
		).handleCommand({
			version: "v1",
			requestId: "req-1",
			command: "run.start",
			sessionId: "session-1",
			payload: {
				sessionId: "session-1",
				prompt: "Use this file",
				mode: "plan",
				attachments: { userFiles: ["/tmp/project/note.md"] },
			},
		});

		expect(reply.ok).toBe(true);
		expect(runTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-1",
				prompt: "Use this file",
				mode: "plan",
				userFiles: ["/tmp/project/note.md"],
			}),
		);
	});

	it("publishes result error text on failed run events", async () => {
		const runTurn = vi.fn().mockResolvedValue({
			text: "Provider rejected the request",
			finishReason: "error",
			iterations: 1,
			usage: { inputTokens: 0, outputTokens: 0 },
			toolCalls: [],
			messages: [],
			model: { id: "model-1", provider: "provider-1" },
			startedAt: new Date(0),
			endedAt: new Date(0),
			durationMs: 0,
		});
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				startSession: vi.fn(),
				stopSession: vi.fn(),
				runTurn,
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
			} as never,
		});
		const events: HubEventEnvelope[] = [];
		transport.subscribe("test", (event) => {
			events.push(event);
		});

		await (
			transport as unknown as {
				handleCommand: (envelope: {
					version: "v1";
					requestId: string;
					command: "run.start";
					sessionId: string;
					payload: { sessionId: string; prompt: string };
				}) => Promise<{ ok: boolean }>;
			}
		).handleCommand({
			version: "v1",
			requestId: "req-1",
			command: "run.start",
			sessionId: "session-1",
			payload: { sessionId: "session-1", prompt: "go" },
		});

		expect(events).toContainEqual(
			expect.objectContaining({
				event: "run.failed",
				payload: expect.objectContaining({
					error: "Provider rejected the request",
				}),
			}),
		);
	});

	it("publishes iteration lifecycle events from agent events", async () => {
		const transport = createTransport();
		const published: string[] = [];
		transport.subscribe("test", (event) => {
			published.push(event.event);
		});
		const ctx = getContext(transport);

		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: { type: "iteration_start", iteration: 3 },
			},
		});
		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "iteration_end",
					iteration: 3,
					hadToolCalls: true,
					toolCallCount: 1,
				},
			},
		});

		expect(published).toEqual(["iteration.started", "iteration.finished"]);
	});

	it("projects in-flight tool updates onto the hub stream", async () => {
		const transport = createTransport();
		const events: HubEventEnvelope[] = [];
		transport.subscribe("test", (event) => events.push(event));

		await projectSessionEvent(getContext(transport), {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_update",
					contentType: "tool",
					toolCallId: "call-1",
					toolName: "run_commands",
					update: {
						stream: "stdout",
						chunk: "\u001b[32mpassed\u001b[0m\n",
					},
				},
			},
		});

		expect(events).toContainEqual(
			expect.objectContaining({
				event: "tool.updated",
				sessionId: "session-1",
				payload: {
					toolCallId: "call-1",
					toolName: "run_commands",
					update: {
						stream: "stdout",
						chunk: "\u001b[32mpassed\u001b[0m\n",
					},
				},
			}),
		);
	});

	it("detaches a running command through the hub command boundary", async () => {
		const proceedWhileRunning = vi.fn().mockResolvedValue(2);
		const transport = createTransport({
			sessionHost: { proceedWhileRunning },
		});

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-proceed",
			command: "run.proceed_while_running",
			sessionId: "session-1",
			payload: { sessionId: "session-1", toolCallId: "call-1" },
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: { detachedCount: 2 },
		});
		expect(proceedWhileRunning).toHaveBeenCalledWith("session-1", "call-1");
	});

	it("projects detached command completion without ending the run", async () => {
		const transport = createTransport();
		const events: HubEventEnvelope[] = [];
		transport.subscribe("test", (event) => events.push(event));

		await projectSessionEvent(getContext(transport), {
			type: "detached_command_completed",
			payload: {
				sessionId: "session-1",
				executionId: "execution-1",
				toolCallId: "call-1",
				logPath: "/tmp/output.log",
				detachKind: "implicit",
				outcome: { kind: "exited", exitCode: 0 },
				ts: 123,
			},
		});

		expect(events).toContainEqual(
			expect.objectContaining({
				event: "command.detached_completed",
				sessionId: "session-1",
				payload: expect.objectContaining({
					executionId: "execution-1",
					detachKind: "implicit",
					outcome: { kind: "exited", exitCode: 0 },
				}),
			}),
		);
		expect(events.some((event) => event.event.startsWith("run."))).toBe(false);
	});

	it("projects an unreported non-recoverable agent error as run.failed", async () => {
		const transport = createTransport({
			sessionHost: {
				getSession: vi.fn().mockResolvedValue({
					sessionId: "session-1",
					status: "running",
					interactive: true,
					startedAt: new Date(0).toISOString(),
					updatedAt: new Date(0).toISOString(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				}),
				readSessionMessages: vi.fn().mockResolvedValue([]),
			},
		});
		const events: HubEventEnvelope[] = [];
		transport.subscribe("test", (event) => events.push(event));
		const ctx = getContext(transport);

		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "error",
					error: new Error("Model claude-3-haiku is unavailable"),
					recoverable: false,
					iteration: 0,
				},
			},
		});

		const failed = events.filter((event) => event.event === "run.failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]?.payload).toMatchObject({
			reason: "error",
			error: "Model claude-3-haiku is unavailable",
			text: "Model claude-3-haiku is unavailable",
		});
		// The snapshot lets interactive clients keep the session alive instead
		// of treating the failed turn as session end.
		expect(failed[0]?.payload?.snapshot).toMatchObject({
			interactive: true,
			status: "running",
		});
	});

	it("suppresses the agent-error projection while an RPC turn awaits the result", async () => {
		const transport = createTransport();
		const events: HubEventEnvelope[] = [];
		transport.subscribe("test", (event) => events.push(event));
		const ctx = getContext(transport);
		ctx.activeRpcTurnCountBySession.set("session-1", 1);

		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "error",
					error: new Error("Provider rejected the request"),
					recoverable: false,
					iteration: 0,
				},
			},
		});

		expect(events.filter((event) => event.event === "run.failed")).toEqual([]);
	});

	it("ignores recoverable and non-lead agent error events", async () => {
		const transport = createTransport();
		const events: HubEventEnvelope[] = [];
		transport.subscribe("test", (event) => events.push(event));
		const ctx = getContext(transport);

		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "error",
					error: new Error("extension setup hiccup"),
					recoverable: true,
					iteration: 0,
				},
			},
		});
		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "error",
					error: new Error("subagent blew up"),
					recoverable: false,
					iteration: 1,
					parentAgentId: "lead-agent",
				},
			},
		});
		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				teamRole: "teammate",
				event: {
					type: "error",
					error: new Error("teammate blew up"),
					recoverable: false,
					iteration: 1,
				},
			},
		});

		expect(events.filter((event) => event.event === "run.failed")).toEqual([]);
	});

	it("projects live usage events with aggregate usage and agent identity", async () => {
		const usage = {
			inputTokens: 10,
			outputTokens: 3,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
			totalCost: 0.11,
		};
		const aggregateUsage = {
			inputTokens: 17,
			outputTokens: 8,
			cacheReadTokens: 3,
			cacheWriteTokens: 3,
			totalCost: 0.23,
		};
		const getAccumulatedUsage = vi
			.fn()
			.mockResolvedValue({ usage, aggregateUsage });
		const transport = createTransport({
			sessionHost: { getAccumulatedUsage },
		});
		const events: HubEventEnvelope[] = [];
		transport.subscribe("test", (event) => {
			events.push(event);
		});
		const ctx = getContext(transport);

		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				teamAgentId: "investigator",
				teamRole: "teammate",
				event: {
					type: "usage",
					agentId: "agent-teammate-1",
					conversationId: "conv-teammate-1",
					parentAgentId: "lead",
					inputTokens: 7,
					outputTokens: 5,
					cacheReadTokens: 2,
					cacheWriteTokens: 1,
					cost: 0.12,
					totalInputTokens: 7,
					totalOutputTokens: 5,
					totalCacheReadTokens: 2,
					totalCacheWriteTokens: 1,
					totalCost: 0.12,
				},
			},
		});

		expect(getAccumulatedUsage).toHaveBeenCalledWith("session-1");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			event: "usage.updated",
			sessionId: "session-1",
			payload: {
				sessionId: "session-1",
				delta: {
					inputTokens: 7,
					outputTokens: 5,
					cacheReadTokens: 2,
					cacheWriteTokens: 1,
					totalCost: 0.12,
				},
				totals: {
					inputTokens: 7,
					outputTokens: 5,
					cacheReadTokens: 2,
					cacheWriteTokens: 1,
					totalCost: 0.12,
				},
				usage,
				aggregateUsage,
				agent: {
					kind: "teammate",
					agentId: "agent-teammate-1",
					conversationId: "conv-teammate-1",
					parentAgentId: "lead",
					teamAgentId: "investigator",
					teamRole: "teammate",
				},
			},
		});
	});

	it("projects notices with teammate provenance intact", async () => {
		const transport = createTransport();
		const events: HubEventEnvelope[] = [];
		transport.subscribe("test", (event) => events.push(event));
		const ctx = getContext(transport);

		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				teamAgentId: "investigator",
				teamRole: "teammate",
				event: {
					type: "notice",
					agentId: "agent-teammate-1",
					conversationId: "conv-teammate-1",
					parentAgentId: "lead",
					noticeType: "status",
					displayRole: "status",
					message: "auto-compacted",
					metadata: { kind: "auto_compaction", phase: "completed" },
				},
			},
		});

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			event: "session.notice",
			sessionId: "session-1",
			payload: {
				agent: {
					kind: "teammate",
					agentId: "agent-teammate-1",
					conversationId: "conv-teammate-1",
					parentAgentId: "lead",
					teamAgentId: "investigator",
					teamRole: "teammate",
				},
			},
		});
	});
});
