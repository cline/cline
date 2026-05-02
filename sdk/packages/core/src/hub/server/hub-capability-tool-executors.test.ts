import { describe, expect, it, vi } from "vitest";
import { handleCapabilityProgress } from "./handlers/capability-handlers";
import type { HubTransportContext } from "./handlers/context";
import {
	createHubClientContributionRuntime,
	HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
} from "./hub-client-contributions";

type ClientContributionRequest = Parameters<
	typeof createHubClientContributionRuntime
>[0]["requestCapability"];

describe("hub capability custom tools", () => {
	it("proxies custom tool execution to the owning client", async () => {
		const request: ClientContributionRequest = vi.fn(
			async (
				_sessionId,
				_capabilityName,
				_payload,
				_targetClientId,
				onProgress,
			) => {
				onProgress?.({ update: { stream: "stdout", chunk: "hello\n" } });
				return { result: "done" };
			},
		);
		const runtime = createHubClientContributionRuntime({
			sessionId: "session-1",
			targetClientId: "client-1",
			contributions: [
				{
					kind: "tool",
					name: "custom_exec",
					description: "Run a custom command.",
					inputSchema: { type: "object" },
					capabilityName: "custom_tool.custom_exec",
				},
			],
			requestCapability: request,
		});
		const tools = runtime.localRuntime.extraTools ?? [];
		const updates: unknown[] = [];

		const result = await tools[0].execute(
			{ command: "echo hello" },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 2,
				emitUpdate: (update) => updates.push(update),
			},
		);

		expect(result).toBe("done");
		expect(updates).toEqual([{ stream: "stdout", chunk: "hello\n" }]);
		expect(request).toHaveBeenCalledWith(
			"session-1",
			"custom_tool.custom_exec",
			{
				toolName: "custom_exec",
				input: { command: "echo hello" },
				context: {
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 2,
					metadata: undefined,
				},
			},
			"client-1",
			expect.any(Function),
		);
	});
});

describe("handleCapabilityProgress", () => {
	it("routes progress payloads to the pending capability request", () => {
		const onProgress = vi.fn();
		const ctx = {
			pendingCapabilityRequests: new Map([
				[
					"capreq-1",
					{
						sessionId: "session-1",
						targetClientId: "client-1",
						capabilityName: "custom_tool.custom_exec",
						onProgress,
						resolve: vi.fn(),
					},
				],
			]),
		} as unknown as HubTransportContext;

		const reply = handleCapabilityProgress(ctx, {
			version: "v1",
			command: "capability.progress",
			requestId: "request-1",
			clientId: "client-1",
			sessionId: "session-1",
			payload: {
				requestId: "capreq-1",
				payload: { update: { stream: "stdout", chunk: "hello\n" } },
			},
		});

		expect(reply.ok).toBe(true);
		expect(onProgress).toHaveBeenCalledWith({
			update: { stream: "stdout", chunk: "hello\n" },
		});
	});
});

describe("hub client runtime capabilities", () => {
	it("proxies lifecycle hooks through capability requests", async () => {
		const request = vi.fn(async () => ({
			control: { context: "extra context" },
		}));
		const runtime = createHubClientContributionRuntime({
			sessionId: "session-1",
			targetClientId: "client-1",
			contributions: [
				{
					kind: "hook",
					name: "onRunStart",
					capabilityName: "hook.onRunStart",
				},
			],
			requestCapability: request,
		});
		const hooks = runtime.localRuntime.hooks;

		const result = await hooks?.onRunStart?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			userMessage: "hello",
		});

		expect(result).toEqual({ context: "extra context" });
		expect(request).toHaveBeenCalledWith(
			"session-1",
			"hook.onRunStart",
			{
				context: {
					agentId: "agent-1",
					conversationId: "conv-1",
					parentAgentId: null,
					userMessage: "hello",
				},
			},
			"client-1",
		);
	});

	it("rebuilds user instruction services from a client snapshot", async () => {
		const request = vi.fn(async () => ({
			snapshot: {
				records: {
					rule: [
						{
							type: "rule",
							id: "rule-1",
							filePath: "/rules/rule.md",
							item: {
								name: "Rule One",
								instructions: "Always be precise.",
							},
						},
					],
					skill: [],
					workflow: [],
				},
				runtimeCommands: [
					{
						id: "workflow-ship",
						name: "ship",
						instructions: "Ship it carefully.",
						kind: "workflow",
					},
				],
			},
		}));
		const runtime = createHubClientContributionRuntime({
			sessionId: "session-1",
			targetClientId: "client-1",
			contributions: [
				{
					kind: "userInstructionService",
					capabilityName: HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
				},
			],
			requestCapability: request,
		});
		const service = runtime.localRuntime.userInstructionService;

		await service?.start();

		expect(service?.resolveRuntimeSlashCommand("/ship now")).toBe(
			"Ship it carefully. now",
		);
		expect(request).toHaveBeenCalledWith(
			"session-1",
			HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
			{},
			"client-1",
		);
	});
});
