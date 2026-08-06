import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	appendOptimisticUserMessage,
	applyCloudSessionEvent,
	type CloudChatState,
	type CloudSessionEventPayload,
	createCloudChatState,
} from "@/lib/cloud-live-events";

function event(
	name: string,
	payload: Record<string, unknown> | null = null,
	agentSessionId: string | null = "agent-1",
): CloudSessionEventPayload {
	return { event: name, agentSessionId, payload };
}

function apply(
	state: CloudChatState,
	...events: CloudSessionEventPayload[]
): CloudChatState {
	return events.reduce(
		(current, next) => applyCloudSessionEvent(current, next),
		state,
	);
}

describe("createCloudChatState", () => {
	it("starts idle with the hydrated transcript", () => {
		const messages: ChatMessage[] = [
			{
				id: "m1",
				sessionId: "agent-1",
				role: "user",
				content: "hello",
				createdAt: 1,
			},
		];
		const state = createCloudChatState(messages);
		expect(state.messages).toHaveLength(1);
		expect(state.runStatus).toBe("idle");
		expect(state.streamingAssistantId).toBeNull();
	});

	it("marks a running agent session as running", () => {
		expect(createCloudChatState([], "running").runStatus).toBe("running");
	});
});

describe("assistant streaming", () => {
	it("accumulates deltas into one streaming message", () => {
		const state = apply(
			createCloudChatState(),
			event("run.started"),
			event("assistant.delta", { text: "Hello" }),
			event("assistant.delta", { text: ", world" }),
		);
		expect(state.runStatus).toBe("running");
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0].role).toBe("assistant");
		expect(state.messages[0].content).toBe("Hello, world");
		expect(state.streamingAssistantId).toBe(state.messages[0].id);
	});

	it("finalizes the streaming message with the full text", () => {
		const state = apply(
			createCloudChatState(),
			event("assistant.delta", { text: "partial" }),
			event("assistant.finished", { text: "partial plus tail" }),
		);
		expect(state.messages[0].content).toBe("partial plus tail");
		expect(state.streamingAssistantId).toBeNull();
	});

	it("renders a finished block without prior deltas as one message", () => {
		const state = apply(
			createCloudChatState(),
			event("assistant.finished", { text: "complete answer" }),
		);
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0].content).toBe("complete answer");
	});

	it("attaches reasoning deltas to the streaming assistant message", () => {
		const state = apply(
			createCloudChatState(),
			event("reasoning.delta", { text: "think " }),
			event("reasoning.delta", { text: "harder" }),
			event("assistant.delta", { text: "answer" }),
		);
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0].reasoning).toBe("think harder");
		expect(state.messages[0].content).toBe("answer");
	});

	it("marks redacted reasoning", () => {
		const state = apply(
			createCloudChatState(),
			event("reasoning.delta", { text: "", redacted: true }),
		);
		expect(state.messages[0].reasoningRedacted).toBe(true);
	});
});

describe("tool events", () => {
	it("pairs tool.finished output with the started row", () => {
		const state = apply(
			createCloudChatState(),
			event("tool.started", {
				toolCallId: "call-1",
				toolName: "bash",
				input: { command: "ls" },
			}),
			event("tool.finished", {
				toolCallId: "call-1",
				toolName: "bash",
				output: "file.txt",
			}),
		);
		expect(state.messages).toHaveLength(1);
		const parsed = JSON.parse(state.messages[0].content) as {
			toolName: string;
			input: unknown;
			result: unknown;
			isError: boolean;
		};
		expect(parsed.toolName).toBe("bash");
		expect(parsed.input).toEqual({ command: "ls" });
		expect(parsed.result).toBe("file.txt");
		expect(parsed.isError).toBe(false);
	});

	it("flags tool errors", () => {
		const state = apply(
			createCloudChatState(),
			event("tool.started", { toolCallId: "call-2", toolName: "bash" }),
			event("tool.finished", {
				toolCallId: "call-2",
				toolName: "bash",
				error: "exit 1",
			}),
		);
		const parsed = JSON.parse(state.messages[0].content) as {
			result: unknown;
			isError: boolean;
		};
		expect(parsed.isError).toBe(true);
		expect(parsed.result).toBe("exit 1");
	});

	it("starts a new assistant bubble after a tool call", () => {
		const state = apply(
			createCloudChatState(),
			event("assistant.delta", { text: "before tool" }),
			event("tool.started", { toolCallId: "call-3", toolName: "read" }),
			event("assistant.delta", { text: "after tool" }),
		);
		expect(state.messages).toHaveLength(3);
		expect(state.messages[0].content).toBe("before tool");
		expect(state.messages[1].role).toBe("tool");
		expect(state.messages[2].content).toBe("after tool");
	});
});

describe("approvals", () => {
	it("tracks requested approvals and clears them when resolved", () => {
		let state = apply(
			createCloudChatState(),
			event("approval.requested", {
				approvalId: "appr-1",
				toolCallId: "call-9",
				toolName: "bash",
				inputJson: JSON.stringify({ command: "rm -rf /tmp/x" }),
			}),
		);
		expect(state.pendingApprovals).toHaveLength(1);
		expect(state.pendingApprovals[0].requestId).toBe("appr-1");
		expect(state.pendingApprovals[0].input).toEqual({
			command: "rm -rf /tmp/x",
		});

		state = apply(state, event("approval.resolved", { approvalId: "appr-1" }));
		expect(state.pendingApprovals).toHaveLength(0);
	});

	it("ignores duplicate approval requests", () => {
		const request = event("approval.requested", {
			approvalId: "appr-dup",
			toolName: "bash",
		});
		const state = apply(createCloudChatState(), request, request);
		expect(state.pendingApprovals).toHaveLength(1);
	});
});

describe("run lifecycle", () => {
	it("completes the run and clears streaming state", () => {
		const state = apply(
			createCloudChatState(),
			event("run.started"),
			event("assistant.delta", { text: "done soon" }),
			event("run.completed", { reason: "completed" }),
		);
		expect(state.runStatus).toBe("completed");
		expect(state.streamingAssistantId).toBeNull();
	});

	it("captures failures with their error", () => {
		const state = apply(
			createCloudChatState(),
			event("run.failed", { error: "sandbox crashed" }),
		);
		expect(state.runStatus).toBe("failed");
		expect(state.lastError).toBe("sandbox crashed");
	});

	it("records aborts", () => {
		const state = apply(createCloudChatState(), event("run.aborted"));
		expect(state.runStatus).toBe("aborted");
	});

	it("records usage totals", () => {
		const state = apply(
			createCloudChatState(),
			event("usage.updated", {
				totals: { inputTokens: 100, outputTokens: 50, totalCost: 0.01 },
			}),
		);
		expect(state.usageTotals).toEqual({
			inputTokens: 100,
			outputTokens: 50,
			totalCost: 0.01,
		});
	});

	it("appends session notices as status messages", () => {
		const state = apply(
			createCloudChatState(),
			event("session.notice", {
				message: "Compacting context",
				noticeType: "info",
			}),
		);
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0].role).toBe("status");
		expect(state.messages[0].content).toBe("Compacting context");
	});
});

describe("appendOptimisticUserMessage", () => {
	it("appends the prompt and marks the run active", () => {
		const state = appendOptimisticUserMessage(
			createCloudChatState(),
			"do the thing",
			"agent-1",
		);
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0].role).toBe("user");
		expect(state.messages[0].content).toBe("do the thing");
		expect(state.runStatus).toBe("running");
		expect(state.streamingAssistantId).toBeNull();
	});
});
