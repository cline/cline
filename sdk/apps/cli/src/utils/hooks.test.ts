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
		await runtimeHooks.hooks?.onRunStart?.({
			agentId: "agent-1",
			conversationId: "session-1",
			parentAgentId: null,
			userMessage: "hello",
		});

		expect(dispatchHookEvent).toHaveBeenCalledTimes(2);
		expect(dispatchHookEvent).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				hookName: "agent_start",
				taskId: "session-1",
				workspaceRoots: ["/workspace"],
			}),
		);
		expect(dispatchHookEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				hookName: "prompt_submit",
				taskId: "session-1",
				workspaceRoots: ["/workspace"],
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

		await runtimeHooks.hooks?.onRunStart?.({
			agentId: "agent-1",
			conversationId: "session-1",
			parentAgentId: null,
			userMessage: "hello",
		});

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

		await runtimeHooks.hooks?.onRunStart?.({
			agentId: "agent-1",
			conversationId: "session-1",
			parentAgentId: null,
			userMessage: "hello",
		});

		expect(outputMocks.write).toHaveBeenCalledWith("\n[hook:agent_start]\n");
		expect(outputMocks.write).toHaveBeenCalledWith("\n[hook:prompt_submit]\n");
		expect(eventMocks.closeInlineStreamIfNeeded).toHaveBeenCalledTimes(2);
	});
});
