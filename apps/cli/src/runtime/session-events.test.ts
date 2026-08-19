import type { AgentEvent } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import { subscribeToAgentEvents } from "./session-events";

type AgentDoneEvent = Extract<AgentEvent, { type: "done" }>;

describe("subscribeToAgentEvents", () => {
	const done = ({
		iterations,
		text = "ok",
		usage,
	}: {
		iterations: number;
		text?: string;
		usage?: AgentDoneEvent["usage"];
	}): AgentDoneEvent => ({
		type: "done",
		reason: "completed",
		iterations,
		text,
		...(usage ? { usage } : {}),
	});

	it("suppresses duplicate structured done events", () => {
		const sessionManager = {
			subscribe: vi.fn((listener: (event: unknown) => void) => {
				listener({
					type: "agent_event",
					payload: {
						event: done({ iterations: 5 }),
					},
				});
				listener({
					type: "agent_event",
					payload: {
						event: done({ iterations: 0, text: "" }),
					},
				});
				return () => {};
			}),
		};
		const onAgentEvent = vi.fn();

		subscribeToAgentEvents(sessionManager, onAgentEvent);

		expect(onAgentEvent).toHaveBeenCalledTimes(1);
		expect(onAgentEvent).toHaveBeenCalledWith(
			expect.objectContaining({ iterations: 5 }),
		);
	});

	it("suppresses duplicate chunk-parsed done events", () => {
		const sessionManager = {
			subscribe: vi.fn((listener: (event: unknown) => void) => {
				listener({
					type: "chunk",
					payload: {
						stream: "agent",
						chunk: JSON.stringify(done({ iterations: 5 })),
					},
				});
				listener({
					type: "chunk",
					payload: {
						stream: "agent",
						chunk: JSON.stringify(done({ iterations: 0 })),
					},
				});
				return () => {};
			}),
		};
		const onAgentEvent = vi.fn();

		subscribeToAgentEvents(sessionManager, onAgentEvent);

		expect(onAgentEvent).toHaveBeenCalledTimes(1);
		expect(onAgentEvent).toHaveBeenCalledWith(
			expect.objectContaining({ iterations: 5 }),
		);
	});

	it("emits a later richer structured done event", () => {
		const richUsage: AgentDoneEvent["usage"] = {
			inputTokens: 10,
			outputTokens: 20,
		};
		const sessionManager = {
			subscribe: vi.fn((listener: (event: unknown) => void) => {
				listener({
					type: "agent_event",
					payload: {
						event: done({ iterations: 0, text: "" }),
					},
				});
				listener({
					type: "agent_event",
					payload: {
						event: done({
							iterations: 5,
							text: "final answer",
							usage: richUsage,
						}),
					},
				});
				return () => {};
			}),
		};
		const onAgentEvent = vi.fn();

		subscribeToAgentEvents(sessionManager, onAgentEvent);

		expect(onAgentEvent).toHaveBeenCalledTimes(2);
		expect(onAgentEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				iterations: 5,
				text: "final answer",
				usage: richUsage,
			}),
		);
	});

	it("emits a richer structured done after a chunk fallback done", () => {
		const sessionManager = {
			subscribe: vi.fn((listener: (event: unknown) => void) => {
				listener({
					type: "chunk",
					payload: {
						stream: "agent",
						chunk: JSON.stringify(done({ iterations: 0, text: "" })),
					},
				});
				listener({
					type: "agent_event",
					payload: {
						event: done({ iterations: 5, text: "final answer" }),
					},
				});
				return () => {};
			}),
		};
		const onAgentEvent = vi.fn();

		subscribeToAgentEvents(sessionManager, onAgentEvent);

		expect(onAgentEvent).toHaveBeenCalledTimes(2);
		expect(onAgentEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({ iterations: 5, text: "final answer" }),
		);
	});

	it("emits done events for separate turns", () => {
		const sessionManager = {
			subscribe: vi.fn((listener: (event: unknown) => void) => {
				listener({
					type: "agent_event",
					payload: {
						event: done({ iterations: 5 }),
					},
				});
				listener({
					type: "agent_event",
					payload: {
						event: { type: "iteration_start", iteration: 1 },
					},
				});
				listener({
					type: "agent_event",
					payload: {
						event: done({ iterations: 1 }),
					},
				});
				return () => {};
			}),
		};
		const onAgentEvent = vi.fn();

		subscribeToAgentEvents(sessionManager, onAgentEvent);

		expect(onAgentEvent).toHaveBeenCalledTimes(3);
		expect(onAgentEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: "done", iterations: 1 }),
		);
	});

	it("keeps teammate usage while suppressing teammate output", () => {
		const teammateText: AgentEvent = {
			type: "content_start",
			contentType: "text",
			text: "hidden teammate output",
		};
		const teammateUsage: AgentEvent = {
			type: "usage",
			inputTokens: 7,
			outputTokens: 5,
			cost: 0.12,
			totalInputTokens: 7,
			totalOutputTokens: 5,
			totalCost: 0.12,
		};
		const leadText: AgentEvent = {
			type: "content_start",
			contentType: "text",
			text: "lead output",
		};
		const sessionManager = {
			subscribe: vi.fn((listener: (event: unknown) => void) => {
				listener({
					type: "agent_event",
					payload: {
						teamRole: "teammate",
						event: teammateText,
					},
				});
				listener({
					type: "agent_event",
					payload: {
						teamRole: "teammate",
						event: teammateUsage,
					},
				});
				listener({
					type: "agent_event",
					payload: {
						teamRole: "lead",
						event: leadText,
					},
				});
				return () => {};
			}),
		};
		const onAgentEvent = vi.fn();

		subscribeToAgentEvents(sessionManager, onAgentEvent);

		expect(onAgentEvent).toHaveBeenCalledTimes(2);
		expect(onAgentEvent).toHaveBeenNthCalledWith(1, teammateUsage);
		expect(onAgentEvent).toHaveBeenNthCalledWith(2, leadText);
	});
});
