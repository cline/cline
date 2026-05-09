import type { AgentToolContext, HubEventEnvelope } from "@clinebot/shared";
import { describe, expect, it, vi } from "vitest";
import type {
	StartSessionInput,
	StartSessionResult,
} from "../../runtime/host/runtime-host";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "../server";
import {
	handleApprovalRespond,
	requestToolApproval,
} from "./handlers/approval-handlers";
import {
	ensureSessionState,
	type HubTransportContext,
} from "./handlers/context";
import { projectSessionEvent } from "./handlers/session-event-projector";

describe("HubServerTransport boundaries", () => {
	function createTransport(options: Record<string, unknown> = {}) {
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
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				dispatchHookEvent: vi.fn(),
				readSessionMessages: vi.fn(),
			} as never,
			...options,
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

	it("returns session_not_found when session messages are requested for an unknown session", async () => {
		const readMessages = vi.fn().mockResolvedValue([]);
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				startSession: vi.fn(),
				stopSession: vi.fn(),
				runTurn: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn().mockResolvedValue(undefined),
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
		expect(readSessionMessages).toHaveBeenCalledWith("session-1");
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
				getSession: vi.fn(),
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
				attachments: { userFiles: ["/tmp/project/note.md"] },
			},
		});

		expect(reply.ok).toBe(true);
		expect(runTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-1",
				prompt: "Use this file",
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
				getSession: vi.fn(),
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
});
