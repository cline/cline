import {
	createBotId,
	createRunId,
	createScheduleId,
	createSessionId,
	GATEWAY_PROTOCOL_VERSION,
	SERVER_REQUEST_METHODS,
} from "@cline/shared/gateway";
import { describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import type { SidecarContext } from "./types";

function context(
	client: Record<string, unknown>,
	overrides: Partial<SidecarContext> = {},
): SidecarContext {
	return {
		client: {
			listRuns: async () => ({ runs: [] }),
			...client,
		} as unknown as SidecarContext["client"],
		gatewayUpdateRequired: false,
		updateGateway: vi.fn(async () => {}),
		workspaceRoot: "/workspace/project",
		workspaceRootLocked: false,
		webSocketAddress: "ws://127.0.0.1:3126/",
		sockets: new Set(),
		activeRuns: new Map(),
		pendingServerRequests: new Map(),
		...overrides,
	};
}

describe("Gateway desktop commands", () => {
	it("keeps user questions separate from tool approvals and returns the answer to Gateway", async () => {
		const sessionId = createSessionId();
		const requestId = "srq_question";
		const resolveQuestion = vi.fn();
		const ctx = context({ resolveQuestion });
		ctx.pendingServerRequests.set(requestId, {
			version: GATEWAY_PROTOCOL_VERSION,
			id: requestId,
			method: SERVER_REQUEST_METHODS.question,
			scope: { sessionId },
			params: { question: "Which path?", options: ["A", "B"] },
		});

		expect(await handleCommand(ctx, "poll_tool_approvals")).toEqual([]);
		expect(
			await handleCommand(ctx, "respond_ask_question", {
				requestId,
				answer: "A",
			}),
		).toBe(true);
		expect(resolveQuestion).toHaveBeenCalledWith(requestId, "A");
		expect(ctx.pendingServerRequests.has(requestId)).toBe(true);
	});

	it("lists and submits only Gateway tool-approval requests", async () => {
		const sessionId = createSessionId();
		const requestId = "srq_approval";
		const resolveApproval = vi.fn();
		const ctx = context({ resolveApproval });
		ctx.pendingServerRequests.set(requestId, {
			version: GATEWAY_PROTOCOL_VERSION,
			id: requestId,
			method: SERVER_REQUEST_METHODS.toolApproval,
			scope: { sessionId },
			params: { toolName: "run_commands", toolCallId: "call_1" },
		});

		expect(await handleCommand(ctx, "poll_tool_approvals")).toEqual([
			{
				requestId,
				sessionId,
				toolName: "run_commands",
				toolCallId: "call_1",
			},
		]);
		await handleCommand(ctx, "respond_tool_approval", {
			requestId,
			approved: false,
			reason: "No",
		});
		expect(resolveApproval).toHaveBeenCalledWith(requestId, {
			approved: false,
			reason: "No",
		});
		// The authority's approval.resolved event removes this request. Keeping it
		// until then prevents an unacknowledged answer from vanishing in the UI.
		expect(ctx.pendingServerRequests.has(requestId)).toBe(true);
	});

	it("blocks normal commands until the user updates an incompatible Gateway", async () => {
		const ctx = context({});
		ctx.gatewayUpdateRequired = true;
		await expect(handleCommand(ctx, "list_bots")).rejects.toThrow(
			"Gateway must be updated",
		);
	});

	it("updates an incompatible Gateway only after an explicit command", async () => {
		const ctx = context({});
		ctx.gatewayUpdateRequired = true;
		const updateGateway = vi.fn(async () => {
			ctx.gatewayUpdateRequired = false;
		});
		ctx.updateGateway = updateGateway;
		expect(await handleCommand(ctx, "get_gateway_update_status")).toMatchObject(
			{
				updateRequired: true,
			},
		);
		await handleCommand(ctx, "update_gateway_server");
		expect(updateGateway).toHaveBeenCalledOnce();
	});

	it("reports the browser bridge and canonical history location without discovery credentials", async () => {
		const result = await handleCommand(
			context({
				getStatus: async () => ({
					counts: { runningRuns: 0 },
					dataDir: "/Users/test/.cline/gateway/desktop",
					gatewayId: "gw_test",
					namespace: "desktop",
				}),
			}),
			"get_process_context",
		);
		expect(result).toMatchObject({
			gateway: {
				dataDir: "/Users/test/.cline/gateway/desktop",
				historyDatabase: "/Users/test/.cline/gateway/desktop/gateway.db",
				status: "connected",
				webSocketAddress: "ws://127.0.0.1:3126/",
				webSocketProtocol: "cline-desktop-v1",
			},
		});
		expect(JSON.stringify(result)).not.toContain("auth");
	});

	it("resolves the UI bot key before reading and writing its Gateway system prompt", async () => {
		const botId = createBotId();
		const getBotSystemPrompt = vi.fn(async () => ({
			botId,
			content: "current prompt",
			bundledContent: "You are Cline Dad.",
			profileRulesContent: "Inspect before acting.",
			profileId: "cline-dad",
			revision: 3,
		}));
		const putBotSystemPrompt = vi.fn(async () => ({
			botId,
			content: "updated prompt",
			revision: 4,
		}));
		const ctx = context({
			listBots: async () => ({
				bots: [{ identity: { botId, name: "Cline Dad" } }],
			}),
			getBotSystemPrompt,
			putBotSystemPrompt,
		});

		expect(
			await handleCommand(ctx, "read_bot_system_prompt", { botId: "cline" }),
		).toEqual({
			botId,
			content: "current prompt",
			bundledContent: "You are Cline Dad.",
			profileRulesContent: "Inspect before acting.",
			profileId: "cline-dad",
			revision: 3,
		});
		await handleCommand(ctx, "write_bot_system_prompt", {
			botId: "cline",
			content: "updated prompt",
		});

		expect(getBotSystemPrompt).toHaveBeenCalledWith({ botId });
		expect(putBotSystemPrompt).toHaveBeenCalledWith({
			botId,
			content: "updated prompt",
			expectedRevision: 3,
		});
	});

	it("creates a Gateway bot for browser clients and applies its system prompt", async () => {
		const leadBotId = createBotId();
		const workerBotId = createBotId();
		const mutate = vi.fn(async () => ({
			identity: { botId: workerBotId, name: "Research" },
			revision: 0,
		}));
		const putBotSystemPrompt = vi.fn(async () => ({ revision: 1 }));
		const result = await handleCommand(
			context({
				listBots: async () => ({
					bots: [
						{
							identity: { botId: leadBotId, name: "Cline", role: "lead" },
							status: "active",
						},
					],
				}),
				mutate,
				putBotSystemPrompt,
			}),
			"create_bot",
			{ name: "Research", systemPrompt: "Investigate carefully." },
		);

		expect(mutate).toHaveBeenCalledWith("bot.delegate", {
			parentBotId: leadBotId,
			name: "Research",
			role: "worker",
			reason: "Created from the Cline Bots UI",
		});
		expect(putBotSystemPrompt).toHaveBeenCalledWith({
			botId: workerBotId,
			content: "Investigate carefully.",
			expectedRevision: 0,
		});
		expect(result).toEqual({ id: workerBotId, name: "Research" });
	});

	it("creates a session without requiring a prompt", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const createSession = vi.fn(async () => ({
			sessionId,
			botId,
			workspace: { rootPath: "/workspace/project" },
			state: "active",
			kind: "canonical",
			createdAt: 1,
			revision: 0,
		}));
		const result = await handleCommand(
			context({
				listBots: async () => ({
					bots: [{ identity: { botId } }],
				}),
				createSession,
			}),
			"chat_session_command",
			{ request: { action: "start", config: {} } },
		);
		expect(createSession).toHaveBeenCalledWith({
			botId,
			workspaceRoot: "/workspace/project",
			kind: "dedicated",
		});
		expect(result).toMatchObject({ sessionId });
	});

	it("forks persisted Gateway history into an independent session", async () => {
		const botId = createBotId();
		const sourceSessionId = createSessionId();
		const forkedSessionId = createSessionId();
		const forkSession = vi.fn(async () => ({
			session: {
				sessionId: forkedSessionId,
				botId,
				workspace: { rootPath: "/workspace/project" },
				state: "active",
				kind: "dedicated",
				createdAt: 2,
				revision: 0,
			},
			forkedFromSessionId: sourceSessionId,
			messageCount: 2,
		}));
		const result = await handleCommand(
			context({
				getSession: async () => ({
					session: {
						sessionId: sourceSessionId,
						botId,
						workspace: { rootPath: "/workspace/project" },
					},
				}),
				forkSession,
			}),
			"chat_session_command",
			{
				request: {
					action: "fork",
					sessionId: sourceSessionId,
					forkBeforeRunCount: 2,
				},
			},
		);

		expect(forkSession).toHaveBeenCalledWith({
			sessionId: sourceSessionId,
			beforeRunCount: 2,
		});
		expect(result).toEqual({
			sessionId: forkedSessionId,
			forkedFromSessionId: sourceSessionId,
			workspaceRoot: "/workspace/project",
			cwd: "/workspace/project",
		});
	});

	it("projects the durable Gateway run queue instead of returning an empty placeholder", async () => {
		const sessionId = createSessionId();
		const runningRunId = createRunId();
		const queuedRunId = createRunId();
		const result = await handleCommand(
			context({
				listRuns: async () => ({
					runs: [
						{
							runId: runningRunId,
							sessionId,
							state: "running",
							input: "first",
						},
						{
							runId: queuedRunId,
							sessionId,
							state: "queued",
							input: "follow up",
						},
					],
				}),
			}),
			"chat_session_command",
			{ request: { action: "pending_prompts", sessionId } },
		);

		expect(result).toEqual({
			sessionId,
			promptsInQueue: [{ id: queuedRunId, prompt: "follow up", steer: false }],
		});
	});

	it("atomically promotes a queued Gateway prompt into the active run", async () => {
		const sessionId = createSessionId();
		const runningRunId = createRunId();
		const queuedRunId = createRunId();
		const runs = [
			{
				runId: runningRunId,
				sessionId,
				state: "running",
				input: "first",
			},
			{
				runId: queuedRunId,
				sessionId,
				state: "queued",
				input: "follow up",
			},
		];
		const promoteQueuedRun = vi.fn(async () => {
			const queued = runs.find((run) => run.runId === queuedRunId);
			if (queued) queued.state = "aborted";
			return {
				queuedRunId,
				activeRunId: runningRunId,
				sessionId,
				merged: true,
			};
		});
		const result = await handleCommand(
			context({ listRuns: async () => ({ runs }), promoteQueuedRun }),
			"chat_session_command",
			{ request: { action: "steer_prompt", sessionId, promptId: queuedRunId } },
		);

		expect(promoteQueuedRun).toHaveBeenCalledWith({ runId: queuedRunId });
		expect(result).toEqual({
			sessionId,
			updated: true,
			promptsInQueue: [],
		});
	});

	it("updates a queued Gateway prompt in place", async () => {
		const sessionId = createSessionId();
		const queuedRunId = createRunId();
		const run = {
			runId: queuedRunId,
			sessionId,
			state: "queued",
			input: "before",
		};
		const updateQueuedRun = vi.fn(async ({ input }: { input: string }) => {
			run.input = input;
			return { run };
		});
		const result = await handleCommand(
			context({
				listRuns: async () => ({ runs: [run] }),
				updateQueuedRun,
			}),
			"chat_session_command",
			{
				request: {
					action: "update_pending_prompt",
					sessionId,
					promptId: queuedRunId,
					prompt: "after",
				},
			},
		);

		expect(updateQueuedRun).toHaveBeenCalledWith({
			runId: queuedRunId,
			input: "after",
		});
		expect(result).toEqual({
			sessionId,
			updated: true,
			prompt: { id: queuedRunId, prompt: "after", steer: false },
			promptsInQueue: [{ id: queuedRunId, prompt: "after", steer: false }],
		});
	});

	it("removes a queued Gateway prompt without stopping the active run", async () => {
		const sessionId = createSessionId();
		const runningRunId = createRunId();
		const queuedRunId = createRunId();
		const runs = [
			{
				runId: runningRunId,
				sessionId,
				state: "running",
				input: "first",
			},
			{
				runId: queuedRunId,
				sessionId,
				state: "queued",
				input: "remove me",
			},
		];
		const abortRun = vi.fn(async ({ runId }: { runId: string }) => {
			const target = runs.find((run) => run.runId === runId);
			if (target) target.state = "aborted";
			return { state: "aborted" };
		});
		const result = await handleCommand(
			context({ listRuns: async () => ({ runs }), abortRun }),
			"chat_session_command",
			{
				request: {
					action: "remove_pending_prompt",
					sessionId,
					promptId: queuedRunId,
				},
			},
		);

		expect(abortRun).toHaveBeenCalledWith({
			runId: queuedRunId,
			reason: "removed_from_queue",
		});
		expect(result).toEqual({
			sessionId,
			removed: true,
			prompt: { id: queuedRunId, prompt: "remove me", steer: false },
			promptsInQueue: [],
		});
	});

	it("resets every running or queued Gateway run in the session", async () => {
		const sessionId = createSessionId();
		const runningRunId = createRunId();
		const queuedRunId = createRunId();
		const abortRun = vi.fn(async () => ({ state: "aborted" }));
		const ctx = context({
			listRuns: async () => ({
				runs: [
					{ runId: runningRunId, state: "running" },
					{ runId: queuedRunId, state: "queued" },
				],
			}),
			abortRun,
		});
		ctx.activeRuns.set(sessionId, runningRunId);

		expect(
			await handleCommand(ctx, "chat_session_command", {
				request: { action: "reset", sessionId },
			}),
		).toEqual({ sessionId, ok: true, promptsInQueue: [] });
		expect(abortRun).toHaveBeenCalledTimes(2);
		expect(abortRun).toHaveBeenNthCalledWith(1, {
			runId: runningRunId,
			reason: "desktop_session_reset",
		});
		expect(abortRun).toHaveBeenNthCalledWith(2, {
			runId: queuedRunId,
			reason: "desktop_session_reset",
		});
		expect(ctx.activeRuns.has(sessionId)).toBe(false);
	});

	it("stops a newly admitted run before its started event arrives", async () => {
		const sessionId = createSessionId();
		const queuedRunId = createRunId();
		const interruptRun = vi.fn(async () => ({ state: "aborted" }));

		expect(
			await handleCommand(
				context({
					listRuns: async () => ({
						runs: [
							{
								runId: queuedRunId,
								sessionId,
								state: "queued",
								input: "hello",
							},
						],
					}),
					interruptRun,
				}),
				"chat_session_command",
				{ request: { action: "abort", sessionId } },
			),
		).toEqual({ sessionId, ok: true });
		expect(interruptRun).toHaveBeenCalledWith({
			runId: queuedRunId,
			reason: "abort",
		});
	});

	it("explains that Gateway sessions do not expose workspace checkpoints", async () => {
		await expect(
			handleCommand(context({}), "chat_session_command", {
				request: {
					action: "restore_checkpoint",
					sessionId: createSessionId(),
				},
			}),
		).rejects.toThrow("workspace checkpoints are not available");
	});

	it("uses the native bot workspace when a locked sidecar receives a stale project", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const createSession = vi.fn(async () => ({
			sessionId,
			botId,
			workspace: { rootPath: "/safe/bot/workspaces" },
			state: "active",
			kind: "canonical",
			createdAt: 1,
			revision: 0,
		}));
		await handleCommand(
			context(
				{
					listBots: async () => ({
						bots: [{ identity: { botId, name: "Cline" } }],
					}),
					createSession,
				},
				{
					botId,
					workspaceRoot: "/safe/bot/workspaces",
					workspaceRootLocked: true,
				},
			),
			"chat_session_command",
			{
				request: {
					action: "start",
					config: {
						botId: "a-different-bot",
						workspaceRoot: "/stale/unassigned/project",
					},
				},
			},
		);

		expect(createSession).toHaveBeenCalledWith({
			botId,
			workspaceRoot: "/safe/bot/workspaces",
			kind: "dedicated",
		});
	});

	it("carries the native workspace resolution through a shared packaged sidecar", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const createSession = vi.fn(async () => ({
			sessionId,
			botId,
			workspace: { rootPath: "/safe/bot/workspaces" },
			state: "active",
			kind: "canonical",
			createdAt: 1,
			revision: 0,
		}));
		await handleCommand(
			context({
				listBots: async () => ({
					bots: [{ identity: { botId, name: "Cline" } }],
				}),
				createSession,
			}),
			"chat_session_command",
			{
				request: {
					action: "start",
					config: { workspaceRoot: "/stale/unassigned/project" },
					desktopScope: {
						botId,
						workspaceRoot: "/safe/bot/workspaces",
					},
				},
			},
		);

		expect(createSession).toHaveBeenCalledWith({
			botId,
			workspaceRoot: "/safe/bot/workspaces",
			kind: "dedicated",
		});
	});

	it("keeps locked sends in the native bot workspace", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const startRun = vi.fn(async () => ({ runId: "run_locked" }));
		const result = await handleCommand(
			context(
				{
					listBots: async () => ({
						bots: [{ identity: { botId, name: "Cline" } }],
					}),
					getSession: async () => ({
						session: {
							botId,
							workspace: { rootPath: "/safe/bot/workspaces" },
						},
					}),
					startRun,
					listRuns: async () => ({ runs: [{ sessionId }] }),
				},
				{
					botId,
					workspaceRoot: "/safe/bot/workspaces",
					workspaceRootLocked: true,
				},
			),
			"chat_session_command",
			{
				request: {
					action: "send",
					sessionId,
					prompt: "continue",
					config: { workspaceRoot: "/stale/unassigned/project" },
				},
			},
		);

		expect(startRun).toHaveBeenCalledWith(
			expect.objectContaining({
				botId,
				workspaceRoot: "/safe/bot/workspaces",
			}),
		);
		expect(result).toMatchObject({
			workspaceRoot: "/safe/bot/workspaces",
			cwd: "/safe/bot/workspaces",
		});
	});

	it("does not hydrate a denied historical workspace into locked chat config", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const result = await handleCommand(
			context(
				{
					listBots: async () => ({
						bots: [{ identity: { botId, name: "Cline" } }],
					}),
					getSession: async () => ({
						runs: [],
						session: {
							botId,
							workspace: { rootPath: "/stale/unassigned/project" },
						},
					}),
				},
				{
					botId,
					workspaceRoot: "/safe/bot/workspaces",
					workspaceRootLocked: true,
				},
			),
			"chat_session_command",
			{ request: { action: "attach", sessionId } },
		);

		expect(result).toMatchObject({
			sessionId,
			workspaceRoot: "/safe/bot/workspaces",
			cwd: "/safe/bot/workspaces",
		});
	});

	it("rejects a direct send to a denied historical workspace before uploads or runs", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const mutate = vi.fn();
		const startRun = vi.fn();
		await expect(
			handleCommand(
				context(
					{
						listBots: async () => ({
							bots: [{ identity: { botId, name: "Cline" } }],
						}),
						getSession: async () => ({
							session: {
								botId,
								workspace: {
									rootPath: "/stale/unassigned/project",
								},
							},
						}),
						mutate,
						startRun,
					},
					{
						botId,
						workspaceRoot: "/safe/bot/workspaces",
						workspaceRootLocked: true,
					},
				),
				"chat_session_command",
				{
					request: {
						action: "send",
						sessionId,
						prompt: "continue",
						attachments: {
							userFiles: [{ name: "note.txt", content: "secret" }],
						},
					},
				},
			),
		).rejects.toThrow("Session workspace is unavailable");
		expect(mutate).not.toHaveBeenCalled();
		expect(startRun).not.toHaveBeenCalled();
	});

	it("uploads browser image and file attachments before starting the run", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const mutate = vi
			.fn()
			.mockResolvedValueOnce({ path: "/workspace/.cline/uploads/image.png" })
			.mockResolvedValueOnce({ path: "/workspace/.cline/uploads/notes.txt" });
		const startRun = vi.fn(async () => ({ runId: "run_test" }));
		await handleCommand(
			context({
				listBots: async () => ({ bots: [{ identity: { botId } }] }),
				mutate,
				startRun,
				listRuns: async () => ({ runs: [{ sessionId }] }),
			}),
			"chat_session_command",
			{
				request: {
					action: "send",
					sessionId,
					prompt: "inspect these",
					config: {},
					attachments: {
						userImages: ["data:image/png;base64,aW1hZ2U="],
						userFiles: [{ name: "notes.txt", content: "hello" }],
					},
				},
			},
		);
		expect(mutate).toHaveBeenNthCalledWith(1, "workspace.file.upload", {
			sessionId,
			name: "image-1.png",
			mediaType: "image/png",
			base64: "aW1hZ2U=",
		});
		expect(mutate).toHaveBeenNthCalledWith(2, "workspace.file.upload", {
			sessionId,
			name: "notes.txt",
			mediaType: "text/plain",
			base64: "aGVsbG8=",
		});
		expect(startRun).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId,
				prompt: expect.stringContaining(
					"[uploaded image: /workspace/.cline/uploads/image.png]",
				),
			}),
		);
	});

	it("returns Gateway sessions with the provider and model fields required by history", async () => {
		const botId = createBotId();
		const sessionId = createSessionId();
		const result = await handleCommand(
			context({
				listBots: async () => ({ bots: [] }),
				listConnectors: async () => ({
					connectors: [{ connectorId: "connector_slack", kind: "slack" }],
				}),
				listSessions: async () => ({
					sessions: [
						{
							sessionId,
							botId,
							workspace: { rootPath: "/workspace/project" },
							state: "active",
							createdAt: 10,
						},
					],
				}),
				getSession: async () => ({
					runs: [
						{
							state: "completed",
							provenance: {
								mode: "connector",
								connectorId: "connector_slack",
							},
						},
					],
					messages: [
						{
							message: {
								role: "user",
								content: [{ type: "text", text: "hello" }],
								createdAt: 11,
							},
						},
						{
							message: {
								role: "assistant",
								content: [{ type: "text", text: "hi" }],
								createdAt: 12,
								modelInfo: { provider: "anthropic", id: "claude" },
							},
						},
					],
				}),
			}),
			"list_discovered_sessions",
			{ limit: 50 },
		);
		expect(result).toEqual([
			expect.objectContaining({
				sessionId,
				provider: "anthropic",
				model: "claude",
				prompt: "hello",
				source: "slack",
				status: "completed",
			}),
		]);
	});

	it("bounds reopened history and truncates oversized tool payloads", async () => {
		const sessionId = createSessionId();
		const getSession = vi.fn(async () => ({
			messages: [
				{
					message: {
						id: "msg_large_tool_result",
						role: "tool",
						content: [
							{
								type: "tool-result",
								toolCallId: "call_1",
								toolName: "fetch_web_content",
								output: "x".repeat(100_000),
								isError: false,
							},
						],
						createdAt: 1,
					},
				},
			],
		}));

		const result = (await handleCommand(
			context({ getSession }),
			"read_session_messages",
			{ sessionId, maxMessages: 20 },
		)) as Array<{ content: string }>;

		expect(getSession).toHaveBeenCalledWith({ sessionId, messageLimit: 20 });
		expect(result[0]?.content).toContain("historical tool payload truncated");
		expect(result[0]?.content.length).toBeLessThan(18_000);
	});

	it("pairs persisted tool calls with their results for history rendering", async () => {
		const sessionId = createSessionId();
		const getSession = vi.fn(async () => ({
			messages: [
				{
					message: {
						id: "msg_assistant",
						role: "assistant",
						content: [
							{ type: "text", text: "Checking the repository." },
							{
								type: "tool-call",
								toolCallId: "call_1",
								toolName: "search_codebase",
								input: { query: "gateway" },
							},
						],
						createdAt: 10,
					},
				},
				{
					message: {
						id: "msg_tool",
						role: "tool",
						content: [
							{
								type: "tool-result",
								toolCallId: "call_1",
								toolName: "search_codebase",
								output: { matches: 3 },
								isError: false,
							},
						],
						createdAt: 20,
					},
				},
			],
		}));

		const result = (await handleCommand(
			context({ getSession }),
			"read_session_messages",
			{ sessionId, maxMessages: 20 },
		)) as Array<{
			role: string;
			content: string;
			meta?: { hookEventName?: string; toolCallId?: string };
		}>;

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			role: "assistant",
			content: "Checking the repository.",
		});
		expect(result[1]).toMatchObject({
			role: "tool",
			meta: {
				hookEventName: "history_tool_result",
				toolCallId: "call_1",
			},
		});
		expect(JSON.parse(result[1]?.content ?? "{}")).toEqual({
			toolName: "search_codebase",
			input: { query: "gateway" },
			result: { matches: 3 },
			isError: false,
		});
	});

	it("marks an orphaned historical tool call as interrupted", async () => {
		const sessionId = createSessionId();
		const getSession = vi.fn(async () => ({
			messages: [
				{
					message: {
						id: "msg_orphan",
						role: "assistant",
						content: [
							{
								type: "tool-call",
								toolCallId: "call_orphan",
								toolName: "run_commands",
								input: { commands: ["pwd"] },
							},
						],
						createdAt: 10,
					},
				},
			],
		}));

		const [tool] = (await handleCommand(
			context({ getSession }),
			"read_session_messages",
			{ sessionId, maxMessages: 20 },
		)) as Array<{ content: string; meta?: { hookEventName?: string } }>;

		expect(tool?.meta?.hookEventName).toBe("history_tool_result");
		expect(JSON.parse(tool?.content ?? "{}")).toMatchObject({
			toolName: "run_commands",
			isError: true,
			result: "Tool execution ended without a recorded result.",
		});
	});

	it("keeps an unresolved tool call pending while its run awaits approval", async () => {
		const sessionId = createSessionId();
		const runId = createRunId();
		const getSession = vi.fn(async () => ({
			runs: [{ runId, state: "running" }],
			messages: [
				{
					runId,
					message: {
						id: "msg_pending",
						role: "assistant",
						content: [
							{
								type: "tool-call",
								toolCallId: "call_pending",
								toolName: "run_commands",
								input: { commands: ["pwd"] },
							},
						],
						createdAt: 10,
					},
				},
			],
		}));

		const [tool] = (await handleCommand(
			context({ getSession }),
			"read_session_messages",
			{ sessionId, maxMessages: 20 },
		)) as Array<{
			content: string;
			meta?: { hookEventName?: string; toolCallId?: string };
		}>;

		expect(tool?.meta).toMatchObject({
			hookEventName: "history_tool_use",
			toolCallId: "call_pending",
		});
		expect(JSON.parse(tool?.content ?? "{}")).toEqual({
			toolName: "run_commands",
			input: { commands: ["pwd"] },
			result: null,
			isError: false,
		});
	});

	it("does not revive an orphan from an older run when a later run is active", async () => {
		const sessionId = createSessionId();
		const completedRunId = createRunId();
		const activeRunId = createRunId();
		const getSession = vi.fn(async () => ({
			runs: [
				{ runId: completedRunId, state: "completed" },
				{ runId: activeRunId, state: "running" },
			],
			messages: [
				{
					runId: completedRunId,
					message: {
						id: "msg_old_orphan",
						role: "assistant",
						content: [
							{
								type: "tool-call",
								toolCallId: "call_old",
								toolName: "run_commands",
								input: { commands: ["old"] },
							},
						],
						createdAt: 10,
					},
				},
			],
		}));

		const [tool] = (await handleCommand(
			context({ getSession }),
			"read_session_messages",
			{ sessionId, maxMessages: 20 },
		)) as Array<{ content: string; meta?: { hookEventName?: string } }>;

		expect(tool?.meta?.hookEventName).toBe("history_tool_result");
		expect(JSON.parse(tool?.content ?? "{}")).toMatchObject({
			isError: true,
			result: "Tool execution ended without a recorded result.",
		});
	});

	it("returns the native Gateway connector catalog and active records", async () => {
		const result = await handleCommand(
			context({
				listConnectors: async () => ({ connectors: [] }),
				getStatus: async () => ({
					instanceId: "gwi_test",
					pid: 42,
					namespace: "desktop",
				}),
			}),
			"list_connector_channels",
		);
		expect(
			(result as { available: Array<{ id: string }> }).available.map(
				(channel) => channel.id,
			),
		).toEqual(["telegram", "slack"]);
	});

	it("forwards provider catalog reads to the Gateway authority", async () => {
		const catalog = {
			providers: [{ id: "anthropic", name: "Anthropic" }],
			settingsPath: "/gateway/providers.json",
		};
		const listProviderCatalog = vi.fn(async () => catalog);
		const result = await handleCommand(
			context({ listProviderCatalog }),
			"list_provider_catalog",
		);
		expect(result).toBe(catalog);
		expect(listProviderCatalog).toHaveBeenCalledOnce();
	});

	it("translates provider mutations into typed Gateway calls", async () => {
		const patchProviderSettings = vi.fn(async () => ({ ok: true }));
		const addProvider = vi.fn(async () => ({ providerId: "custom" }));
		const updateProviderModels = vi.fn(async () => ({ providerId: "custom" }));
		const listProviderModels = vi.fn(async () => ({
			providerId: "custom",
			models: [],
		}));
		const ctx = context({
			patchProviderSettings,
			addProvider,
			updateProviderModels,
			listProviderModels,
		});

		await handleCommand(ctx, "save_provider_settings", {
			provider: "anthropic",
			enabled: true,
			api_key: "server-only-secret",
			base_url: "https://anthropic.example.test",
			settings: { region: "us-west-2" },
		});
		expect(patchProviderSettings).toHaveBeenCalledWith("anthropic", {
			enabled: true,
			settings: {
				apiKey: "server-only-secret",
				baseUrl: "https://anthropic.example.test",
				region: "us-west-2",
			},
		});

		await handleCommand(ctx, "add_provider", {
			provider_id: "custom",
			name: "Custom",
			base_url: "https://custom.example.test/v1",
			api_key: "custom-secret",
			models: ["model-a"],
			default_model_id: "model-a",
			capabilities: ["tools"],
		});
		expect(addProvider).toHaveBeenCalledWith({
			providerId: "custom",
			name: "Custom",
			baseUrl: "https://custom.example.test/v1",
			apiKey: "custom-secret",
			headers: undefined,
			timeoutMs: undefined,
			models: ["model-a"],
			defaultModelId: "model-a",
			modelsSourceUrl: undefined,
			capabilities: ["tools"],
		});

		await handleCommand(ctx, "update_provider_models", {
			provider: "custom",
			models: ["model-b"],
		});
		expect(updateProviderModels).toHaveBeenCalledWith({
			providerId: "custom",
			models: ["model-b"],
			defaultModelId: undefined,
		});
		await handleCommand(ctx, "list_provider_models", { provider: "custom" });
		expect(listProviderModels).toHaveBeenCalledWith("custom");
	});

	it("routes voice settings and transcription through typed Gateway calls", async () => {
		const setVoiceInput = vi.fn(async (selection) => ({
			...(selection ? { voiceInput: selection } : {}),
		}));
		const createStreamingTranscriptionSession = vi.fn(async () => ({
			token: "short-lived-token",
			url: "wss://voice.example.test",
		}));
		const transcribeAudio = vi.fn(async () => ({ text: "hello" }));
		const ctx = context({
			setVoiceInput,
			createStreamingTranscriptionSession,
			transcribeAudio,
		});

		expect(
			await handleCommand(ctx, "save_voice_input_settings", {
				provider: " elevenlabs ",
				model: " scribe_v2 ",
			}),
		).toEqual({
			voiceInput: { providerId: "elevenlabs", modelId: "scribe_v2" },
		});
		expect(setVoiceInput).toHaveBeenCalledWith({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
		});

		await handleCommand(ctx, "save_voice_input_settings", {});
		expect(setVoiceInput).toHaveBeenLastCalledWith(undefined);
		await expect(
			handleCommand(ctx, "save_voice_input_settings", {
				provider: "elevenlabs",
			}),
		).rejects.toThrow("configured together");

		expect(
			await handleCommand(ctx, "create_streaming_transcription_session"),
		).toEqual({
			token: "short-lived-token",
			url: "wss://voice.example.test",
		});
		expect(createStreamingTranscriptionSession).toHaveBeenCalledOnce();

		expect(
			await handleCommand(ctx, "transcribe_audio", {
				audioBase64: "YXVkaW8=",
				mediaType: "audio/webm",
			}),
		).toEqual({ text: "hello" });
		expect(transcribeAudio).toHaveBeenCalledWith({
			audioBase64: "YXVkaW8=",
			mediaType: "audio/webm",
		});
	});

	it("routes Cline OAuth and every account-view operation through typed Gateway calls", async () => {
		const loginProviderOAuth = vi.fn(async () => ({
			provider: "cline",
			configured: true,
		}));
		const cancelProviderOAuth = vi.fn(async () => ({
			provider: "cline",
			cancelled: true,
		}));
		const queryClineAccount = vi.fn(async (input) => input);
		const switchClineAccount = vi.fn(async () => ({ switched: true }));
		const ctx = context({
			loginProviderOAuth,
			cancelProviderOAuth,
			queryClineAccount,
			switchClineAccount,
		});

		expect(
			await handleCommand(ctx, "run_provider_oauth_login", {
				provider: "cline",
			}),
		).toEqual({ provider: "cline", configured: true });
		await handleCommand(ctx, "cancel_provider_oauth_login", {
			provider: "cline",
		});
		expect(loginProviderOAuth).toHaveBeenCalledWith("cline");
		expect(cancelProviderOAuth).toHaveBeenCalledWith("cline");

		const queries = [
			{ action: "clineAccount", operation: "fetchMe" },
			{
				action: "clineAccount",
				operation: "fetchBalance",
				userId: "user-1",
			},
			{
				action: "clineAccount",
				operation: "fetchUsageTransactions",
				userId: "user-1",
			},
			{
				action: "clineAccount",
				operation: "fetchPaymentTransactions",
				userId: "user-1",
			},
			{ action: "clineAccount", operation: "fetchUserOrganizations" },
			{
				action: "clineAccount",
				operation: "fetchOrganizationBalance",
				organizationId: "org-1",
			},
			{
				action: "clineAccount",
				operation: "fetchOrganizationUsageTransactions",
				organizationId: "org-1",
				memberId: "member-1",
			},
		] as const;
		for (const query of queries) {
			await handleCommand(ctx, "cline_account", query);
		}
		expect(queryClineAccount.mock.calls.map(([input]) => input)).toEqual(
			queries.map(({ action: _action, ...input }) => input),
		);

		await handleCommand(ctx, "cline_account", {
			action: "clineAccount",
			operation: "switchAccount",
			organizationId: "org-1",
		});
		expect(switchClineAccount).toHaveBeenCalledWith("org-1");
	});

	it("persists session title and metadata and deletes history through Gateway", async () => {
		const sessionId = createSessionId();
		const session = {
			sessionId,
			botId: createBotId(),
			workspace: { rootPath: "/workspace/project" },
			state: "active",
			kind: "dedicated",
			createdAt: 1,
			revision: 4,
			metadata: { category: "work" },
		};
		const updateSession = vi
			.fn()
			.mockResolvedValueOnce({ ...session, title: "Renamed", revision: 5 })
			.mockResolvedValueOnce({
				...session,
				metadata: { category: "work", pinned: true },
				revision: 5,
			});
		const deleteSession = vi.fn(async () => ({ deleted: true }));
		const ctx = context({
			getSession: async () => ({ session, messages: [], runs: [] }),
			updateSession,
			deleteSession,
		});

		expect(
			await handleCommand(ctx, "update_chat_session_title", {
				sessionId,
				title: "Renamed",
			}),
		).toBe(true);
		expect(updateSession).toHaveBeenNthCalledWith(1, {
			sessionId,
			title: "Renamed",
			expectedRevision: 4,
		});
		expect(
			await handleCommand(ctx, "update_chat_session_metadata", {
				sessionId,
				metadata: { pinned: true },
			}),
		).toEqual({ category: "work", pinned: true });
		expect(updateSession).toHaveBeenNthCalledWith(2, {
			sessionId,
			metadata: { pinned: true },
			expectedRevision: 4,
		});
		expect(await handleCommand(ctx, "delete_chat_session", { sessionId })).toBe(
			true,
		);
		expect(deleteSession).toHaveBeenCalledWith({ sessionId });
	});

	it("projects flat discovered-session history with durable title and metadata", async () => {
		const sessionId = createSessionId();
		const botId = createBotId();
		const ctx = context({
			listSessions: async () => ({
				sessions: [
					{
						sessionId,
						botId,
						workspace: { rootPath: "/workspace/project" },
						state: "active",
						kind: "dedicated",
						createdAt: 10,
						revision: 2,
						title: "Durable title",
						metadata: { pinned: true },
					},
				],
			}),
			listBots: async () => ({
				bots: [
					{
						identity: { botId, name: "Cline" },
						config: { providerId: "cline", modelId: "test-model" },
					},
				],
			}),
			listConnectors: async () => ({ connectors: [] }),
			getSession: async () => ({
				session: {},
				messages: [],
				runs: [],
			}),
		});
		const item = await handleCommand(ctx, "get_discovered_session", {
			sessionId,
		});
		expect(item).toMatchObject({
			sessionId,
			title: "Durable title",
			metadata: { pinned: true, title: "Durable title" },
			workspaceRoot: "/workspace/project",
			provider: "cline",
			model: "test-model",
		});
		expect(item).not.toHaveProperty("workspace");
	});

	it("maps Gateway schedules to the routine overview and routes every mutation", async () => {
		const scheduleId = createScheduleId();
		const botId = createBotId();
		const schedule = {
			scheduleId,
			botId,
			name: "Review",
			prompt: "Review this workspace",
			cronPattern: "0 9 * * MON-FRI",
			nextDueAt: 20_000,
			enabled: true,
			maxAttempts: 1,
			metadata: { owner: "desktop" },
			modelSelection: { providerId: "cline", modelId: "test-model" },
			mode: "yolo" as const,
			workspaceRoot: "/workspace/project",
			cwd: "/workspace/project",
			maxParallel: 1,
			createdAt: 1_000,
			updatedAt: 2_000,
			revision: 3,
		};
		const updated = { ...schedule, name: "Updated", revision: 4 };
		const createSchedule = vi.fn(async () => schedule);
		const updateSchedule = vi.fn(async () => updated);
		const disableSchedule = vi.fn(async () => ({
			...schedule,
			enabled: false,
		}));
		const enableSchedule = vi.fn(async () => schedule);
		const triggerSchedule = vi.fn(async () => ({
			job: {
				jobId: 7,
				scheduleId,
				dueAt: 3_000,
				state: "pending",
				attempts: 0,
				createdAt: 3_000,
			},
		}));
		const deleteSchedule = vi.fn(async () => ({ deleted: true }));
		const ctx = context({
			listBots: async () => ({
				bots: [{ identity: { botId, name: "Cline" } }],
			}),
			listSchedules: async () => ({ schedules: [schedule] }),
			scheduleReport: async () => ({ jobs: [] }),
			createSchedule,
			updateSchedule,
			disableSchedule,
			enableSchedule,
			triggerSchedule,
			deleteSchedule,
		});

		expect(await handleCommand(ctx, "list_routine_schedules")).toMatchObject({
			schedules: [
				{
					scheduleId,
					cronPattern: "0 9 * * MON-FRI",
					nextRunAt: 20_000,
				},
			],
			upcomingRuns: [{ scheduleId, name: "Review", nextRunAt: 20_000 }],
		});
		await handleCommand(ctx, "create_routine_schedule", {
			name: "Review",
			schedule_type: "recurring",
			cron_pattern: "0 9 * * MON-FRI",
			prompt: "Review this workspace",
			provider: "cline",
			model: "test-model",
			workspace_root: "/workspace/project",
			max_parallel: 1,
			enabled: true,
		});
		expect(createSchedule).toHaveBeenCalledWith(
			expect.objectContaining({ botId, cronPattern: "0 9 * * MON-FRI" }),
		);
		await handleCommand(ctx, "update_routine_schedule", {
			schedule_id: scheduleId,
			name: "Updated",
			schedule_type: "recurring",
			cron_pattern: "30 10 * * *",
			prompt: "Updated prompt",
			provider: "cline",
			model: "test-model",
			workspace_root: "/workspace/project",
			max_parallel: 1,
		});
		expect(updateSchedule).toHaveBeenCalledWith(
			expect.objectContaining({
				scheduleId,
				expectedRevision: 3,
				cronPattern: "30 10 * * *",
			}),
		);
		await handleCommand(ctx, "pause_routine_schedule", {
			schedule_id: scheduleId,
		});
		await handleCommand(ctx, "resume_routine_schedule", {
			schedule_id: scheduleId,
		});
		await handleCommand(ctx, "trigger_routine_schedule", {
			schedule_id: scheduleId,
		});
		await handleCommand(ctx, "delete_routine_schedule", {
			schedule_id: scheduleId,
		});
		expect(disableSchedule).toHaveBeenCalledWith({ scheduleId });
		expect(enableSchedule).toHaveBeenCalledWith({ scheduleId });
		expect(triggerSchedule).toHaveBeenCalledWith({ scheduleId });
		expect(deleteSchedule).toHaveBeenCalledWith({ scheduleId });
	});

	it("forwards global settings reads and patches to the Gateway", async () => {
		const getGlobalSettings = vi.fn(async () => ({
			telemetryOptOut: false,
			autoUpdateEnabled: true,
		}));
		const patchGlobalSettings = vi.fn(async () => ({
			telemetryOptOut: true,
			autoUpdateEnabled: false,
		}));
		const ctx = context({ getGlobalSettings, patchGlobalSettings });

		await handleCommand(ctx, "get_global_settings");
		await handleCommand(ctx, "set_telemetry_opt_out", {
			telemetry_opt_out: true,
		});
		await handleCommand(ctx, "set_auto_update_enabled", {
			auto_update_enabled: false,
		});
		await handleCommand(ctx, "set_web_search_enabled", {
			web_search_enabled: true,
		});

		expect(getGlobalSettings).toHaveBeenCalledOnce();
		expect(patchGlobalSettings).toHaveBeenNthCalledWith(1, {
			telemetryOptOut: true,
		});
		expect(patchGlobalSettings).toHaveBeenNthCalledWith(2, {
			autoUpdateEnabled: false,
		});
		expect(patchGlobalSettings).toHaveBeenNthCalledWith(3, {
			webSearchEnabled: true,
		});
	});
});
