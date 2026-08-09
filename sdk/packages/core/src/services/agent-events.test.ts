import type { AgentEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { CoreSessionConfig } from "../types/config";
import type { ActiveSession } from "../types/session";
import { type AgentEventContext, handleAgentEvent } from "./agent-events";

const SESSION_MESSAGES = [
	{ role: "user", content: [{ type: "text", text: "hi" }] },
];

function createContext(options?: { liveSession?: false }): {
	ctx: AgentEventContext;
	persistMessages: ReturnType<typeof vi.fn>;
} {
	const persistMessages = vi.fn();
	const liveSession =
		options?.liveSession === false
			? undefined
			: ({
					agent: { getMessages: () => SESSION_MESSAGES },
					runtime: {},
					config: { systemPrompt: "system" },
				} as unknown as ActiveSession);
	const ctx: AgentEventContext = {
		sessionId: "session-1",
		config: {} as CoreSessionConfig,
		liveSession,
		usageBySession: new Map(),
		aggregateUsageBySession: new Map(),
		persistMessages,
		emit: vi.fn(),
	};
	return { ctx, persistMessages };
}

const iterationEnd: AgentEvent = {
	type: "iteration_end",
	iteration: 1,
	hadToolCalls: false,
	toolCallCount: 0,
};
const doneAborted: AgentEvent = {
	type: "done",
	reason: "aborted",
	text: "",
	iterations: 1,
};
const runError: AgentEvent = {
	type: "error",
	error: new Error("boom"),
	recoverable: false,
	iteration: 1,
};

describe("handleAgentEvent message persistence", () => {
	it.each([
		["iteration_end", iterationEnd],
		["done (covers aborted runs)", doneAborted],
		["error (covers failed runs)", runError],
	])("persists the conversation on %s", (_label, event) => {
		const { ctx, persistMessages } = createContext();

		handleAgentEvent(ctx, event);

		expect(persistMessages).toHaveBeenCalledTimes(1);
		expect(persistMessages).toHaveBeenCalledWith(
			"session-1",
			SESSION_MESSAGES,
			"system",
		);
	});

	it("does not persist on non-boundary events", () => {
		const { ctx, persistMessages } = createContext();

		handleAgentEvent(ctx, {
			type: "iteration_start",
			iteration: 1,
		});

		expect(persistMessages).not.toHaveBeenCalled();
	});

	it("does not persist for non-primary (sub-agent) events", () => {
		const { ctx, persistMessages } = createContext();

		handleAgentEvent(ctx, doneAborted, { isPrimaryAgentEvent: false });

		expect(persistMessages).not.toHaveBeenCalled();
	});

	it("does not overwrite the persisted conversation when the session is already deregistered", () => {
		// A straggler event after teardown has no live session; persisting
		// would write an EMPTY message list over the real conversation.
		const { ctx, persistMessages } = createContext({ liveSession: false });

		handleAgentEvent(ctx, iterationEnd);

		expect(persistMessages).not.toHaveBeenCalled();
	});
});
