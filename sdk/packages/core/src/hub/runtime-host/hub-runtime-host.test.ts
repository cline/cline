import type { AgentToolContext, HubEventEnvelope } from "@clinebot/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSource } from "../../types/common";

const commandMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());
const getClientIdMock = vi.hoisted(() => vi.fn(() => "client-1"));

vi.mock("../client", () => ({
	NodeHubClient: class {
		command = commandMock;
		subscribe = subscribeMock;
		close = closeMock;
		dispose = disposeMock;
		getClientId = getClientIdMock;
	},
}));

function createConfig() {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-haiku-4.5",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		systemPrompt: "system",
		mode: "act" as const,
		checkpoint: { enabled: true },
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	};
}

function agentDoneEvents(events: unknown[]) {
	return events.filter(
		(
			event,
		): event is {
			type: "agent_event";
			payload: { event: { type: "done"; [key: string]: unknown } };
		} =>
			!!event &&
			typeof event === "object" &&
			(event as { type?: unknown }).type === "agent_event" &&
			(event as { payload?: { event?: { type?: unknown } } }).payload?.event
				?.type === "done",
	);
}

describe("HubRuntimeHost", () => {
	afterEach(() => {
		commandMock.mockReset();
		subscribeMock.mockReset();
		closeMock.mockReset();
		disposeMock.mockReset();
		getClientIdMock.mockClear();
	});

	it("does not auto-start a run during session creation", async () => {
		subscribeMock.mockReturnValue(() => {});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		const started = await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		expect(started.sessionId).toBe("sess-1");
		expect(started.result).toBeUndefined();
		expect(commandMock).toHaveBeenCalledTimes(1);
		expect(subscribeMock).toHaveBeenCalledWith(expect.any(Function), {
			sessionId: "sess-1",
		});
		expect(commandMock).toHaveBeenCalledWith("session.create", {
			workspaceRoot: "/tmp/project",
			cwd: "/tmp/project",
			sessionConfig: expect.objectContaining({
				providerId: "cline",
				modelId: "anthropic/claude-haiku-4.5",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				systemPrompt: "system",
				mode: "act",
				checkpoint: { enabled: true },
				enableTools: true,
				enableSpawnAgent: true,
				enableAgentTeams: true,
			}),
			metadata: expect.objectContaining({
				source: SessionSource.CLI,
				prompt: "Hey",
				interactive: false,
			}),
			runtimeOptions: {},
			toolPolicies: undefined,
			initialMessages: undefined,
		});
	});

	it("starts runs only through send", async () => {
		subscribeMock.mockReturnValue(() => {});
		const result = {
			text: "Hey!",
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
			messages: [],
			toolCalls: [],
			iterations: 1,
			finishReason: "completed",
			model: {
				id: "anthropic/claude-haiku-4.5",
				provider: "cline",
				info: {},
			},
			startedAt: new Date("2026-04-21T00:00:00.000Z"),
			endedAt: new Date("2026-04-21T00:00:01.000Z"),
			durationMs: 1000,
		};
		commandMock.mockResolvedValue({ ok: true, payload: { result } });

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		const sent = await host.runTurn({
			sessionId: "sess-1",
			prompt: "Hey",
			delivery: "queue",
		});

		expect(subscribeMock).toHaveBeenCalledWith(expect.any(Function), {
			sessionId: "sess-1",
		});
		expect(commandMock).toHaveBeenCalledWith(
			"run.start",
			{
				sessionId: "sess-1",
				input: "Hey",
				attachments: undefined,
				delivery: "queue",
			},
			"sess-1",
			{ timeoutMs: null },
		);
		expect(sent).toEqual(result);
	});

	it("projects canonical hub snapshots from replies and lifecycle events", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		const snapshot = {
			version: 1,
			sessionId: "sess-snapshot",
			source: SessionSource.CLI,
			status: "running",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			endedAt: null,
			exitCode: null,
			interactive: true,
			workspace: { cwd: "/tmp/project", root: "/tmp/project" },
			model: {
				providerId: "cline",
				modelId: "anthropic/claude-haiku-4.5",
			},
			capabilities: {
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
			},
			lineage: {
				agentId: "agent-1",
				conversationId: "conversation-1",
				isSubagent: false,
			},
			prompt: "Hey",
			messages: [{ role: "user", content: "Hey" }],
			usage: {
				inputTokens: 1,
				outputTokens: 2,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.01,
			},
		};
		commandMock.mockResolvedValueOnce({ ok: true, payload: { snapshot } });

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		const events: unknown[] = [];
		host.subscribe((event) => events.push(event));

		const started = await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
			interactive: true,
		});

		expect(started.sessionId).toBe("sess-snapshot");
		expect(started.manifest).toMatchObject({
			session_id: "sess-snapshot",
			provider: "cline",
			model: "anthropic/claude-haiku-4.5",
			interactive: true,
			prompt: "Hey",
		});

		onEvent?.({
			version: "v1",
			event: "session.updated",
			sessionId: "sess-snapshot",
			payload: {
				snapshot: { ...snapshot, status: "completed", exitCode: 0 },
			},
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "session_snapshot",
					payload: expect.objectContaining({
						sessionId: "sess-snapshot",
						snapshot: expect.objectContaining({
							version: 1,
							sessionId: "sess-snapshot",
							status: "completed",
							workspace: { cwd: "/tmp/project", root: "/tmp/project" },
						}),
					}),
				}),
			]),
		);

		commandMock.mockResolvedValueOnce({ ok: true, payload: { snapshot } });
		await expect(host.getSession("sess-snapshot")).resolves.toMatchObject({
			sessionId: "sess-snapshot",
			provider: "cline",
			model: "anthropic/claude-haiku-4.5",
			agentId: "agent-1",
			conversationId: "conversation-1",
		});
	});

	it("bridges hub approval requests through runtime capabilities", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: string;
					sessionId: string;
					payload: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock
			.mockResolvedValueOnce({
				payload: {
					session: {
						sessionId: "sess-1",
						status: "running",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						workspaceRoot: "/tmp/project",
						cwd: "/tmp/project",
					},
				},
			})
			.mockResolvedValueOnce({ ok: true, payload: {} });
		const eventOrder: string[] = [];
		const requestToolApproval = vi.fn(async () => {
			eventOrder.push("approval-requested");
			return {
				approved: true,
				reason: "ok",
			};
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({
			url: "ws://127.0.0.1:25463/hub",
			capabilities: { requestToolApproval },
		});
		host.subscribe((event) => {
			if (
				event.type === "agent_event" &&
				event.payload.event.type === "content_start" &&
				event.payload.event.contentType === "tool"
			) {
				eventOrder.push("tool-started");
			}
		});

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});
		onEvent?.({
			version: 1,
			event: "approval.requested",
			sessionId: "sess-1",
			payload: {
				approvalId: "approval-1",
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 2,
				toolCallId: "call-1",
				toolName: "run_commands",
				inputJson: '{"commands":["echo hi"]}',
				policy: { autoApprove: false },
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(eventOrder).toEqual(["tool-started", "approval-requested"]);
		expect(requestToolApproval).toHaveBeenCalledWith({
			sessionId: "sess-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 2,
			toolCallId: "call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});
		expect(commandMock).toHaveBeenLastCalledWith(
			"approval.respond",
			{ approvalId: "approval-1", approved: true, reason: "ok" },
			"sess-1",
		);

		onEvent?.({
			version: 1,
			event: "tool.started",
			sessionId: "sess-1",
			payload: {
				toolCallId: "call-1",
				toolName: "run_commands",
				input: { commands: ["echo hi"] },
			},
		});
		expect(eventOrder).toEqual(["tool-started", "approval-requested"]);
	});

	it("uses one app runtime capability object for hub tool executors and approvals", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock
			.mockResolvedValueOnce({
				payload: {
					session: {
						sessionId: "sess-1",
						status: "running",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						workspaceRoot: "/tmp/project",
						cwd: "/tmp/project",
					},
				},
			})
			.mockResolvedValueOnce({ ok: true, payload: {} })
			.mockResolvedValueOnce({ ok: true, payload: {} });
		const askQuestion = vi.fn(
			async (
				_question: string,
				_options: string[],
				_context: AgentToolContext,
			) => "Use the SDK",
		);
		const requestToolApproval = vi.fn(async () => ({
			approved: true,
			reason: "approved by app handler",
		}));
		const appCapabilities = {
			toolExecutors: { askQuestion },
			requestToolApproval,
		};

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			capabilities: appCapabilities,
		});
		expect(commandMock.mock.calls[0]?.[0]).toBe("session.create");
		expect(commandMock.mock.calls[0]?.[1]).toMatchObject({
			runtimeOptions: {
				clientContributions: [
					{
						kind: "toolExecutor",
						executor: "askQuestion",
						capabilityName: "tool_executor.askQuestion",
					},
				],
			},
		});

		onEvent?.({
			version: "v1",
			event: "run.completed",
			sessionId: "sess-1",
			payload: { reason: "completed" },
		});
		onEvent?.({
			version: "v1",
			event: "capability.requested",
			sessionId: "sess-1",
			payload: {
				requestId: "capreq-1",
				targetClientId: "client-1",
				capabilityName: "tool_executor.askQuestion",
				payload: {
					args: ["Which approach?", ["Use the SDK", "Write custom code"]],
					context: {
						agentId: "agent-1",
						conversationId: "conversation-1",
						iteration: 1,
					},
				},
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(askQuestion).toHaveBeenCalledWith(
			"Which approach?",
			["Use the SDK", "Write custom code"],
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 1,
			}),
		);
		expect(commandMock).toHaveBeenLastCalledWith(
			"capability.respond",
			{
				requestId: "capreq-1",
				ok: true,
				payload: { result: "Use the SDK" },
			},
			"sess-1",
		);

		onEvent?.({
			version: "v1",
			event: "approval.requested",
			sessionId: "sess-1",
			payload: {
				approvalId: "approval-1",
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 2,
				toolCallId: "call-approval-1",
				toolName: "run_commands",
				inputJson: '{"commands":["echo hi"]}',
				policy: { autoApprove: false },
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(requestToolApproval).toHaveBeenCalledWith({
			sessionId: "sess-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 2,
			toolCallId: "call-approval-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});
		expect(commandMock).toHaveBeenLastCalledWith(
			"approval.respond",
			{
				approvalId: "approval-1",
				approved: true,
				reason: "approved by app handler",
			},
			"sess-1",
		);
	});

	it("passes cancellation into long-running hub capability handlers", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValueOnce({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		let receivedSignal: AbortSignal | undefined;
		let resolveExecutor: ((value: string) => void) | undefined;
		const askQuestion = vi.fn(
			async (
				_question: string,
				_options: string[],
				context: AgentToolContext,
			) => {
				receivedSignal = context.signal;
				return await new Promise<string>((resolve) => {
					resolveExecutor = resolve;
				});
			},
		);

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			capabilities: { toolExecutors: { askQuestion } },
		});

		onEvent?.({
			version: "v1",
			event: "capability.requested",
			sessionId: "sess-1",
			payload: {
				requestId: "capreq-1",
				targetClientId: "client-1",
				capabilityName: "tool_executor.askQuestion",
				payload: {
					args: ["Which approach?", ["Use the SDK"]],
					context: {
						agentId: "agent-1",
						conversationId: "conversation-1",
						iteration: 1,
					},
				},
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(receivedSignal).toBeDefined();
		expect(receivedSignal?.aborted).toBe(false);
		onEvent?.({
			version: "v1",
			event: "capability.resolved",
			sessionId: "sess-1",
			payload: {
				requestId: "capreq-1",
				capabilityName: "tool_executor.askQuestion",
				targetClientId: "client-1",
				ok: false,
				cancelled: true,
				error: "user cancelled",
			},
		});

		expect(receivedSignal?.aborted).toBe(true);
		resolveExecutor?.("Use the SDK");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(commandMock).not.toHaveBeenLastCalledWith(
			"capability.respond",
			expect.anything(),
			"sess-1",
		);
	});

	it("tears down session stream subscriptions when a session stops", async () => {
		const unsubscribe = vi.fn();
		subscribeMock.mockReturnValue(unsubscribe);
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		commandMock.mockResolvedValue({ ok: true, payload: {} });
		await host.stopSession("sess-1");

		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(commandMock).toHaveBeenLastCalledWith(
			"session.detach",
			{ sessionId: "sess-1" },
			"sess-1",
		);
	});

	it("maps hub completion events back to agent and lifecycle events without duplicating done", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event:
						| "assistant.finished"
						| "reasoning.finished"
						| "agent.done"
						| "run.completed";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "assistant.finished",
			sessionId: "sess-1",
			payload: { text: "hello" },
		});
		onEvent?.({
			version: 1,
			event: "reasoning.finished",
			sessionId: "sess-1",
			payload: { reasoning: "thought" },
		});
		onEvent?.({
			version: 1,
			event: "agent.done",
			sessionId: "sess-1",
			payload: {
				reason: "completed",
				text: "hello",
				iterations: 1,
				usage: { inputTokens: 2, outputTokens: 3, totalCost: 0.01 },
			},
		});
		onEvent?.({
			version: 1,
			event: "run.completed",
			sessionId: "sess-1",
			payload: { reason: "completed" },
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: { type: "content_end", contentType: "text", text: "hello" },
					}),
				}),
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: {
							type: "content_end",
							contentType: "reasoning",
							reasoning: "thought",
						},
					}),
				}),
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: expect.objectContaining({
							type: "done",
							reason: "completed",
							text: "hello",
							iterations: 1,
						}),
					}),
				}),
			]),
		);
		expect(agentDoneEvents(events)).toHaveLength(1);
		expect(agentDoneEvents(events)[0]?.payload.event).toMatchObject({
			type: "done",
			reason: "completed",
			text: "hello",
			iterations: 1,
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "ended",
					payload: expect.objectContaining({
						sessionId: "sess-1",
						reason: "completed",
					}),
				}),
			]),
		);
	});

	it("synthesizes done from run.completed when no agent.done was observed", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: "run.completed";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "run.completed",
			sessionId: "sess-1",
			payload: {
				reason: "completed",
				result: {
					finishReason: "completed",
					text: "fallback text",
					iterations: 2,
				},
			},
		});

		expect(agentDoneEvents(events)).toHaveLength(1);
		expect(agentDoneEvents(events)[0]?.payload.event).toMatchObject({
			type: "done",
			reason: "completed",
			text: "fallback text",
			iterations: 2,
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "ended",
					payload: expect.objectContaining({
						sessionId: "sess-1",
						reason: "completed",
					}),
				}),
			]),
		);
	});

	it("maps hub iteration lifecycle events back to agent events", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: "iteration.started" | "iteration.finished";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "iteration.started",
			sessionId: "sess-1",
			payload: { iteration: 2 },
		});
		onEvent?.({
			version: 1,
			event: "iteration.finished",
			sessionId: "sess-1",
			payload: { iteration: 2, hadToolCalls: true, toolCallCount: 1 },
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: { type: "iteration_start", iteration: 2 },
					}),
				}),
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: {
							type: "iteration_end",
							iteration: 2,
							hadToolCalls: true,
							toolCallCount: 1,
						},
					}),
				}),
			]),
		);
	});

	it("maps hub aborted runs back to aborted agent events", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: "run.aborted";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "run.aborted",
			sessionId: "sess-1",
			payload: {},
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: expect.objectContaining({
							type: "done",
							reason: "aborted",
						}),
					}),
				}),
				expect.objectContaining({
					type: "ended",
					payload: expect.objectContaining({
						sessionId: "sess-1",
						reason: "aborted",
					}),
				}),
			]),
		);
	});

	it("maps failed hub runs back to error agent events", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: "run.failed";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "run.failed",
			sessionId: "sess-1",
			payload: {
				reason: "error",
				text: "run failed",
				iterations: 2,
			},
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: expect.objectContaining({
							type: "done",
							reason: "error",
							text: "run failed",
							iterations: 2,
						}),
					}),
				}),
				expect.objectContaining({
					type: "ended",
					payload: expect.objectContaining({
						sessionId: "sess-1",
						reason: "error",
					}),
				}),
			]),
		);
	});

	it("forwards image attachments when sending a run", async () => {
		commandMock.mockResolvedValue({ ok: true, payload: { result: undefined } });

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.runTurn({
			sessionId: "sess-1",
			prompt: "Describe this image",
			userImages: ["data:image/png;base64,aGVsbG8="],
		});

		expect(commandMock).toHaveBeenCalledWith(
			"run.start",
			{
				sessionId: "sess-1",
				input: "Describe this image",
				attachments: {
					userImages: ["data:image/png;base64,aGVsbG8="],
				},
				delivery: undefined,
			},
			"sess-1",
			{ timeoutMs: null },
		);
	});

	it("forwards file attachments when sending a run", async () => {
		commandMock.mockResolvedValue({ ok: true, payload: { result: undefined } });

		const filePath = "/tmp/project/note.md";

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.runTurn({
			sessionId: "sess-1",
			prompt: "Use this file",
			userFiles: [filePath],
		});

		expect(commandMock).toHaveBeenCalledWith(
			"run.start",
			{
				sessionId: "sess-1",
				input: "Use this file",
				attachments: {
					userFiles: [filePath],
				},
				delivery: undefined,
			},
			"sess-1",
			{ timeoutMs: null },
		);
	});

	it("reads messages through the hub instead of dereferencing client-local artifact paths", async () => {
		const messages = [
			{
				role: "user",
				content: [{ type: "text", text: "hello from another client" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "hello" }],
			},
		];
		commandMock.mockResolvedValue({ ok: true, payload: { messages } });

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(host.readSessionMessages(" sess-1 ")).resolves.toEqual(
			messages,
		);
		expect(commandMock).toHaveBeenCalledWith(
			"session.messages",
			{ sessionId: "sess-1" },
			"sess-1",
		);
	});

	it("throws when the hub rejects message reads", async () => {
		commandMock.mockResolvedValue({
			ok: false,
			error: {
				code: "session_not_found",
				message: "Unknown session: sess-missing",
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(host.readSessionMessages("sess-missing")).rejects.toThrow(
			"Unknown session: sess-missing",
		);
	});

	it("throws when the hub rejects settings list", async () => {
		commandMock.mockResolvedValue({
			ok: false,
			error: {
				code: "settings_list_failed",
				message: "Invalid settings list payload",
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(host.listSettings({ cwd: "/tmp/project" })).rejects.toThrow(
			"Invalid settings list payload",
		);
		expect(commandMock).toHaveBeenCalledWith("settings.list", {
			cwd: "/tmp/project",
		});
	});

	it("throws when the hub rejects settings toggle", async () => {
		commandMock.mockResolvedValue({
			ok: false,
			error: {
				code: "settings_toggle_failed",
				message: "Unknown settings type",
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(
			host.toggleSetting({ type: "skills", id: "skill-one" }),
		).rejects.toThrow("Unknown settings type");
		expect(commandMock).toHaveBeenCalledWith("settings.toggle", {
			type: "skills",
			id: "skill-one",
		});
	});

	it("detaches active sessions when disposed", async () => {
		commandMock.mockResolvedValueOnce({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});
		await host.dispose();

		expect(commandMock).toHaveBeenLastCalledWith(
			"session.detach",
			{ sessionId: "sess-1" },
			"sess-1",
		);
		expect(disposeMock).toHaveBeenCalledTimes(1);
	});
});
