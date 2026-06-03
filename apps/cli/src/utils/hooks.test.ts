import { beforeEach, describe, expect, it, vi } from "vitest";

const outputMocks = vi.hoisted(() => ({
	write: vi.fn(),
	writeErr: vi.fn(),
	emitJsonLine: vi.fn(),
	getCurrentOutputMode: vi.fn(() => "text"),
	getActiveCliSession: vi.fn(() => undefined),
}));

vi.mock("./output", () => ({
	c: {
		reset: "",
		dim: "",
		cyan: "",
	},
	emitJsonLine: outputMocks.emitJsonLine,
	getActiveCliSession: outputMocks.getActiveCliSession,
	getCurrentOutputMode: outputMocks.getCurrentOutputMode,
	write: outputMocks.write,
	writeErr: outputMocks.writeErr,
}));

const eventMocks = vi.hoisted(() => ({
	closeInlineStreamIfNeeded: vi.fn(),
}));

vi.mock("./events", () => ({
	closeInlineStreamIfNeeded: eventMocks.closeInlineStreamIfNeeded,
}));

import { createRuntimeHooks } from "./hooks";

async function emitRunStartAndPrompt(
	hooks: NonNullable<ReturnType<typeof createRuntimeHooks>["hooks"]>,
): Promise<void> {
	const snapshot = {
		agentId: "agent-1",
		conversationId: "conversation-1",
		runId: "run-1",
		parentAgentId: null,
		status: "running" as const,
		iteration: 0,
		messages: [],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	};
	await hooks.beforeRun?.({ snapshot });
	await hooks.onEvent?.({
		type: "message-added",
		snapshot,
		message: {
			id: "msg-1",
			role: "user",
			content: [{ type: "text", text: "hello" }],
			createdAt: 0,
		},
	});
}

async function emitToolResult(
	hooks: NonNullable<ReturnType<typeof createRuntimeHooks>["hooks"]>,
): Promise<void> {
	await hooks.afterTool?.({
		snapshot: {
			agentId: "agent-1",
			conversationId: "conversation-1",
			runId: "run-1",
			parentAgentId: null,
			status: "running",
			iteration: 1,
			messages: [],
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		tool: {
			name: "read_file",
			description: "",
			inputSchema: {},
			execute: async () => "ok",
		},
		toolCall: {
			type: "tool-call",
			toolCallId: "call-1",
			toolName: "read_file",
			input: { path: "README.md" },
		},
		input: { path: "README.md" },
		result: { output: "ok" },
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:00.042Z"),
		durationMs: 42,
	});
}

describe("createRuntimeHooks", () => {
	beforeEach(() => {
		outputMocks.write.mockReset();
		outputMocks.writeErr.mockReset();
		outputMocks.emitJsonLine.mockReset();
		outputMocks.getCurrentOutputMode.mockReset();
		outputMocks.getCurrentOutputMode.mockReturnValue("text");
		outputMocks.getActiveCliSession.mockReset();
		outputMocks.getActiveCliSession.mockReturnValue(undefined);
		eventMocks.closeInlineStreamIfNeeded.mockReset();
	});

	it("disables runtime hooks in yolo mode", async () => {
		const runtimeHooks = createRuntimeHooks({
			yolo: true,
			dispatchHookEvent: vi.fn(),
		});

		expect(runtimeHooks.hooks).toBeUndefined();
		await expect(runtimeHooks.shutdown()).resolves.toBeUndefined();
	});

	it("returns in-process hooks when dispatch is available", async () => {
		const dispatchHookEvent = vi.fn().mockResolvedValue(undefined);
		const runtimeHooks = createRuntimeHooks({
			yolo: false,
			cwd: "/workspace",
			workspaceRoot: "/workspace",
			dispatchHookEvent,
		});

		expect(runtimeHooks.hooks).toBeDefined();
		await emitRunStartAndPrompt(runtimeHooks.hooks!);

		expect(dispatchHookEvent).toHaveBeenCalledTimes(2);
		expect(dispatchHookEvent).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				hookName: "agent_start",
				taskId: "conversation-1",
				workspaceRoots: ["/workspace"],
			}),
		);
		expect(dispatchHookEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				hookName: "prompt_submit",
				taskId: "conversation-1",
				workspaceRoots: ["/workspace"],
			}),
		);
	});

	it("forwards runtime tool timing to tool_result hook payloads", async () => {
		const dispatchHookEvent = vi.fn().mockResolvedValue(undefined);
		const runtimeHooks = createRuntimeHooks({
			yolo: false,
			cwd: "/workspace",
			workspaceRoot: "/workspace",
			dispatchHookEvent,
		});

		await emitToolResult(runtimeHooks.hooks!);

		expect(dispatchHookEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				hookName: "tool_result",
				tool_result: expect.objectContaining({
					durationMs: 42,
					startedAt: new Date("2026-01-01T00:00:00.000Z"),
					endedAt: new Date("2026-01-01T00:00:00.042Z"),
				}),
				postToolUse: expect.objectContaining({
					executionTimeMs: 42,
				}),
			}),
		);
	});

	it("suppresses text hook output when verbose is disabled", async () => {
		const dispatchHookEvent = vi.fn().mockResolvedValue(undefined);
		const runtimeHooks = createRuntimeHooks({
			yolo: false,
			cwd: "/workspace",
			workspaceRoot: "/workspace",
			verbose: false,
			dispatchHookEvent,
		});

		await emitRunStartAndPrompt(runtimeHooks.hooks!);

		expect(dispatchHookEvent).toHaveBeenCalledTimes(2);
		expect(outputMocks.write).not.toHaveBeenCalled();
		expect(eventMocks.closeInlineStreamIfNeeded).not.toHaveBeenCalled();
	});

	it("prints text hook output when verbose is enabled", async () => {
		const dispatchHookEvent = vi.fn().mockResolvedValue(undefined);
		const runtimeHooks = createRuntimeHooks({
			yolo: false,
			cwd: "/workspace",
			workspaceRoot: "/workspace",
			verbose: true,
			dispatchHookEvent,
		});

		await emitRunStartAndPrompt(runtimeHooks.hooks!);

		expect(outputMocks.write).toHaveBeenCalledWith("\n[hook:agent_start]\n");
		expect(outputMocks.write).toHaveBeenCalledWith("\n[hook:prompt_submit]\n");
		expect(eventMocks.closeInlineStreamIfNeeded).toHaveBeenCalledTimes(2);
	});
});
