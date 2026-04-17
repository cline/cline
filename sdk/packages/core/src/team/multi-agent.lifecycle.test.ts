import type { AgentEvent } from "@clinebot/shared";
import { describe, expect, it, vi } from "vitest";
import {
	AgentTeamsRuntime,
	type TeamEvent,
	TeamMessageType,
} from "./multi-agent";

const { createAgentMock } = vi.hoisted(() => ({
	createAgentMock: vi.fn(),
}));

vi.mock("@clinebot/agents", async () => {
	const actual =
		await vi.importActual<typeof import("@clinebot/agents")>(
			"@clinebot/agents",
		);

	return {
		...actual,
		createAgent: createAgentMock,
	};
});

describe("AgentTeamsRuntime teammate lifecycle events", () => {
	it("spawns teammates with a 10 minute API timeout", () => {
		createAgentMock.mockReturnValueOnce({
			abort: vi.fn(),
			run: vi.fn(),
			continue: vi.fn(),
			canStartRun: vi.fn(() => true),
			getAgentId: vi.fn(() => "teammate-1"),
			getConversationId: vi.fn(() => "conv-1"),
			getMessages: vi.fn(() => []),
		});
		const runtime = new AgentTeamsRuntime({
			teamName: "test-team",
		});

		runtime.spawnTeammate({
			agentId: "python-poet",
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				systemPrompt: "Write concise Python-focused haiku",
				tools: [],
			},
		});

		expect(createAgentMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiTimeoutMs: 10 * 60 * 1000,
			}),
		);
	});

	it("does not emit task_start when teammate is already busy", async () => {
		const events: TeamEvent[] = [];
		createAgentMock.mockReturnValueOnce({
			abort: vi.fn(),
			run: vi.fn(),
			continue: vi.fn(),
			canStartRun: vi.fn(() => false),
			getAgentId: vi.fn(() => "teammate-1"),
			getConversationId: vi.fn(() => "conv-1"),
			getMessages: vi.fn(() => []),
		});
		const runtime = new AgentTeamsRuntime({
			teamName: "test-team",
			onTeamEvent: (event) => events.push(event),
		});

		runtime.spawnTeammate({
			agentId: "python-poet",
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				systemPrompt: "Write concise Python-focused haiku",
				maxIterations: 7,
				tools: [],
			},
		});

		await expect(
			runtime.routeToTeammate("python-poet", "write something"),
		).rejects.toThrow(
			"Cannot start a new run while another run is already in progress",
		);
		expect(
			events.some((event) => event.type === TeamMessageType.TaskStart),
		).toBe(false);
	});

	it("emits teammate_spawned with lifecycle payload", () => {
		const events: TeamEvent[] = [];
		createAgentMock.mockReturnValueOnce({
			abort: vi.fn(),
			run: vi.fn(),
			continue: vi.fn(),
			canStartRun: vi.fn(() => true),
			getAgentId: vi.fn(() => "teammate-1"),
			getConversationId: vi.fn(() => "conv-1"),
			getMessages: vi.fn(() => []),
		});
		const runtime = new AgentTeamsRuntime({
			teamName: "test-team",
			onTeamEvent: (event) => events.push(event),
		});

		runtime.spawnTeammate({
			agentId: "python-poet",
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				systemPrompt: "Write concise Python-focused haiku",
				maxIterations: 7,
				tools: [],
			},
		});

		expect(events).toContainEqual({
			type: TeamMessageType.TeammateSpawned,
			agentId: "python-poet",
			role: undefined,
			teammate: {
				rolePrompt: "Write concise Python-focused haiku",
				modelId: "claude-sonnet-4-5-20250929",
				maxIterations: 7,
				runtimeAgentId: "teammate-1",
				conversationId: "conv-1",
				parentAgentId: null,
			},
		});
	});

	it("prepends unread mailbox notification to teammate message", async () => {
		let routedMessage: string | undefined;
		createAgentMock.mockReturnValueOnce({
			abort: vi.fn(),
			run: vi.fn(async (message) => {
				routedMessage = message;
				return {
					text: "Task completed",
					iterations: 1,
					finishReason: "end_turn",
					durationMs: 100,
					usage: {
						inputTokens: 10,
						outputTokens: 20,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0,
					},
					messages: [],
				};
			}),
			continue: vi.fn(),
			canStartRun: vi.fn(() => true),
			getAgentId: vi.fn(() => "teammate-1"),
			getConversationId: vi.fn(() => "conv-1"),
			getMessages: vi.fn(() => []),
		});
		const runtime = new AgentTeamsRuntime({
			teamName: "test-team",
		});

		runtime.spawnTeammate({
			agentId: "alice",
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				systemPrompt: "Helper teammate",
				tools: [],
			},
		});

		// Send message from lead to alice
		runtime.sendMessage(
			"lead",
			"alice",
			"Status check",
			"How is your work going?",
		);

		// Route task to alice
		await runtime.routeToTeammate("alice", "Complete your task");

		// Verify the routed message includes mailbox notification
		expect(routedMessage).toBeDefined();
		expect(routedMessage).toContain("[MAILBOX]");
		expect(routedMessage).toContain("You have 1 unread message(s)");
		expect(routedMessage).toContain(
			"Message from lead | subject: Status check",
		);
		expect(routedMessage).toContain("How is your work going?");
		expect(routedMessage).toContain("Complete your task");

		// Verify message is marked as read
		const unreadAfter = runtime.listMailbox("alice", { unreadOnly: true });
		expect(unreadAfter).toHaveLength(0);
	});

	it("does not prepend notification when no unread mail", async () => {
		let routedMessage: string | undefined;
		createAgentMock.mockReturnValueOnce({
			abort: vi.fn(),
			run: vi.fn(async (message) => {
				routedMessage = message;
				return {
					text: "Task completed",
					iterations: 1,
					finishReason: "end_turn",
					durationMs: 100,
					usage: {
						inputTokens: 10,
						outputTokens: 20,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0,
					},
					messages: [],
				};
			}),
			continue: vi.fn(),
			canStartRun: vi.fn(() => true),
			getAgentId: vi.fn(() => "teammate-1"),
			getConversationId: vi.fn(() => "conv-1"),
			getMessages: vi.fn(() => []),
		});
		const runtime = new AgentTeamsRuntime({
			teamName: "test-team",
		});

		runtime.spawnTeammate({
			agentId: "bob",
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				systemPrompt: "Helper teammate",
				tools: [],
			},
		});

		// Route task to bob with no prior messages
		await runtime.routeToTeammate("bob", "Complete your task");

		// Verify the routed message does not contain mailbox notification
		expect(routedMessage).toBeDefined();
		expect(routedMessage).toBe("Complete your task");
		expect(routedMessage).not.toContain("[MAILBOX]");
	});

	it("queues steer message notification when recipient is running", () => {
		let consumePendingMessage: (() => string | undefined) | undefined;
		createAgentMock.mockImplementationOnce((config) => {
			consumePendingMessage = config.consumePendingUserMessage;
			return {
				abort: vi.fn(),
				run: vi.fn(),
				continue: vi.fn(),
				canStartRun: vi.fn(() => true),
				getAgentId: vi.fn(() => "teammate-1"),
				getConversationId: vi.fn(() => "conv-1"),
				getMessages: vi.fn(() => []),
			};
		});
		const runtime = new AgentTeamsRuntime({
			teamName: "test-team",
		});

		runtime.spawnTeammate({
			agentId: "charlie",
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				systemPrompt: "Helper teammate",
				tools: [],
			},
		});

		// Simulate teammate is running by incrementing runningCount
		const runtimeMembers = (
			runtime as unknown as { members: Map<string, { runningCount: number }> }
		).members;
		const member = runtimeMembers.get("charlie");
		if (member) {
			member.runningCount = 1;
		}

		// Send message from lead while charlie is running
		runtime.sendMessage("lead", "charlie", "urgent update", "Fix the bug now!");

		// Verify steer message is queued
		expect(consumePendingMessage).toBeDefined();
		const steerMsg = consumePendingMessage?.();
		expect(steerMsg).toBeDefined();
		expect(steerMsg).toContain("[MAILBOX]");
		expect(steerMsg).toContain("lead");
		expect(steerMsg).toContain("urgent update");
		expect(steerMsg).toContain("team_read_mailbox");

		// Verify consuming again returns undefined
		expect(consumePendingMessage?.()).toBeUndefined();
	});

	it("does not queue steer message when recipient is idle", () => {
		let consumePendingMessage: (() => string | undefined) | undefined;
		createAgentMock.mockImplementationOnce((config) => {
			consumePendingMessage = config.consumePendingUserMessage;
			return {
				abort: vi.fn(),
				run: vi.fn(),
				continue: vi.fn(),
				canStartRun: vi.fn(() => true),
				getAgentId: vi.fn(() => "teammate-1"),
				getConversationId: vi.fn(() => "conv-1"),
				getMessages: vi.fn(() => []),
			};
		});
		const runtime = new AgentTeamsRuntime({
			teamName: "test-team",
		});

		runtime.spawnTeammate({
			agentId: "diana",
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				systemPrompt: "Helper teammate",
				tools: [],
			},
		});

		// Send message from lead while diana is idle (runningCount = 0)
		runtime.sendMessage("lead", "diana", "hello", "Hi there");

		// Verify no steer message is queued
		expect(consumePendingMessage?.()).toBeUndefined();

		// Message should still be in mailbox for next route
		const mailbox = runtime.listMailbox("diana", { unreadOnly: true });
		expect(mailbox).toHaveLength(1);
		expect(mailbox[0].subject).toBe("hello");
	});

	it("includes tool and run error details in run_progress activity", async () => {
		const events: TeamEvent[] = [];
		let wrappedOnEvent: ((event: AgentEvent) => void) | undefined;
		createAgentMock.mockImplementationOnce((config) => {
			wrappedOnEvent = config.onEvent;
			return {
				abort: vi.fn(),
				run: vi.fn(async () => {
					wrappedOnEvent?.({
						type: "content_end",
						contentType: "tool",
						toolName: "team_mission_log",
						error: "RPC backend returned 500 while appending mission log",
					});
					wrappedOnEvent?.({
						type: "error",
						error: new Error("API request timed out after 120000ms"),
						recoverable: false,
						iteration: 11,
					});
					throw new Error("API request timed out after 120000ms");
				}),
				continue: vi.fn(),
				canStartRun: vi.fn(() => true),
				getAgentId: vi.fn(() => "teammate-1"),
				getConversationId: vi.fn(() => "conv-1"),
				getMessages: vi.fn(() => []),
			};
		});
		const runtime = new AgentTeamsRuntime({
			teamName: "test-team",
			onTeamEvent: (event) => events.push(event),
		});

		runtime.spawnTeammate({
			agentId: "providers-investigator",
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				systemPrompt: "Investigate providers thoroughly",
				tools: [],
			},
		});

		const run = runtime.startTeammateRun(
			"providers-investigator",
			"Investigate providers",
		);
		const settled = await runtime.awaitRun(run.id);

		expect(settled.status).toBe("failed");
		expect(events).toContainEqual(
			expect.objectContaining({
				type: TeamMessageType.RunProgress,
				message:
					"tool_team_mission_log_error: RPC backend returned 500 while appending mission log",
			}),
		);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: TeamMessageType.RunProgress,
				message: "run_error: API request timed out after 120000ms",
			}),
		);
	});
});
