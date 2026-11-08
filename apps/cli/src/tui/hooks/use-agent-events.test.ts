import type { AgentEvent } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import type { ChatEntry, InlineStream } from "../types";
import { useAgentEventHandlers } from "./use-agent-events";

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: <T>(callback: T) => callback,
	useRef: <T>(current: T) => ({ current }),
}));

function setup() {
	const entries: ChatEntry[] = [];
	const activeInlineStreamRef = { current: undefined as InlineStream };
	const updateLastEntry = (updater: (entry: ChatEntry) => ChatEntry) => {
		const last = entries.at(-1);
		if (last) entries[entries.length - 1] = updater(last);
	};
	// biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked to exercise event handling without a renderer.
	const { handleAgentEvent } = useAgentEventHandlers({
		appendEntry: (entry) => entries.push(entry),
		updateLastEntry,
		updateEntry: (updater) => {
			entries.forEach((entry, index) => {
				entries[index] = updater(entry);
			});
		},
		closeInlineStream: () => {
			activeInlineStreamRef.current = undefined;
			updateLastEntry((entry) =>
				"streaming" in entry && entry.streaming
					? { ...entry, streaming: false }
					: entry,
			);
		},
		activeInlineStreamRef,
		setIsRunning: vi.fn(),
		setIsStreaming: vi.fn(),
		addUsageDelta: vi.fn(),
		onTurnErrorReported: vi.fn(),
		verbose: false,
	});
	return {
		entries,
		activeInlineStreamRef,
		send: (...events: AgentEvent[]) => events.forEach(handleAgentEvent),
	};
}

const text = (chunk: string): AgentEvent => ({
	type: "content_start",
	contentType: "text",
	text: chunk,
});

const reasoning = (chunk: string): AgentEvent => ({
	type: "content_start",
	contentType: "reasoning",
	reasoning: chunk,
});

describe("interleaved assistant reasoning", () => {
	it("keeps text contiguous when reasoning arrives after text starts", () => {
		const { entries, send, activeInlineStreamRef } = setup();

		send(text("Not"), reasoning("list."), text(" complete."));

		expect(entries).toEqual([
			{ kind: "assistant_text", text: "Not complete.", streaming: true },
		]);
		expect(activeInlineStreamRef.current).toBe("text");

		send({ type: "content_end", contentType: "text", text: "Not complete." });
		expect(entries).toEqual([
			{ kind: "assistant_text", text: "Not complete.", streaming: false },
		]);
	});

	it("preserves leading reasoning without inserting late reasoning into text", () => {
		const { entries, send } = setup();

		send(
			reasoning("Let me "),
			reasoning("check."),
			text("The answer"),
			reasoning("One more thought."),
			text(" is 4."),
		);

		expect(entries).toEqual([
			{ kind: "reasoning", text: "Let me check.", streaming: false },
			{ kind: "assistant_text", text: "The answer is 4.", streaming: true },
		]);
	});

	it("does not close active text when a reasoning block finishes", () => {
		const { entries, send, activeInlineStreamRef } = setup();

		send(
			reasoning("Checking."),
			text("Not"),
			{ type: "content_end", contentType: "reasoning", reasoning: "Checking." },
			text(" complete."),
		);

		expect(entries).toEqual([
			{ kind: "reasoning", text: "Checking.", streaming: false },
			{ kind: "assistant_text", text: "Not complete.", streaming: true },
		]);
		expect(activeInlineStreamRef.current).toBe("text");
	});

	it("still closes reasoning when it is the active stream", () => {
		const { entries, send, activeInlineStreamRef } = setup();

		send(reasoning("Checking."), {
			type: "content_end",
			contentType: "reasoning",
			reasoning: "Checking.",
		});

		expect(entries).toEqual([
			{ kind: "reasoning", text: "Checking.", streaming: false },
		]);
		expect(activeInlineStreamRef.current).toBeUndefined();
	});

	it("preserves leading redacted reasoning but does not interrupt text with it", () => {
		const { entries, send } = setup();
		const redacted: AgentEvent = {
			type: "content_start",
			contentType: "reasoning",
			redacted: true,
		};

		send(redacted, text("Not"), redacted, text(" complete."));

		expect(entries).toEqual([
			{ kind: "reasoning", text: "[redacted]", streaming: false },
			{ kind: "assistant_text", text: "Not complete.", streaming: true },
		]);
	});

	it.each<AgentEvent>([
		{ type: "iteration_start", iteration: 2 },
		{
			type: "iteration_end",
			iteration: 1,
			hadToolCalls: false,
			toolCallCount: 0,
		},
		{ type: "content_start", contentType: "tool", toolName: "read_files" },
		{
			type: "done",
			reason: "completed",
			text: "First message.",
			iterations: 1,
		},
		{
			type: "error",
			error: new Error("Request failed"),
			recoverable: false,
			iteration: 1,
		},
	])("allows reasoning again after a $type boundary", (boundary) => {
		const { entries, send } = setup();

		send(text("First message."), boundary, reasoning("Next thought."));

		expect(entries[0]).toEqual({
			kind: "assistant_text",
			text: "First message.",
			streaming: false,
		});
		expect(entries.at(-1)).toEqual({
			kind: "reasoning",
			text: "Next thought.",
			streaming: true,
		});
	});

	it("does not merge assistant text across iterations", () => {
		const { entries, send } = setup();

		send(
			text("First message."),
			{ type: "iteration_start", iteration: 2 },
			text("Second message."),
		);

		expect(entries).toEqual([
			{ kind: "assistant_text", text: "First message.", streaming: false },
			{ kind: "assistant_text", text: "Second message.", streaming: true },
		]);
	});
});
