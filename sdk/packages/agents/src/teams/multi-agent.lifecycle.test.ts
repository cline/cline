import { describe, expect, it, vi } from "vitest";
import {
	AgentTeamsRuntime,
	type TeamEvent,
	TeamMessageType,
} from "./multi-agent";

const { createAgentMock } = vi.hoisted(() => ({
	createAgentMock: vi.fn(),
}));

vi.mock("../agent.js", () => ({
	createAgent: createAgentMock,
}));

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
			},
		});
	});

	it("includes tool and run error details in run_progress activity", async () => {
		const events: TeamEvent[] = [];
		let wrappedOnEvent:
			| ((event: import("../types.js").AgentEvent) => void)
			| undefined;
		createAgentMock.mockImplementationOnce((config) => {
			wrappedOnEvent = config.onEvent;
			return {
				abort: vi.fn(),
				run: vi.fn(async () => {
					wrappedOnEvent?.({
						type: "content_end",
						contentType: "tool",
						toolName: "team_log_update",
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
					"tool_team_log_update_error: RPC backend returned 500 while appending mission log",
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
