import type { UiOutboundMessage } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	appendUserPrompt,
	createUiTranscriptState,
	reduceUiMessage,
	type UiTranscriptState,
} from "./transcript";

function reduceAll(
	messages: UiOutboundMessage[],
	initial: UiTranscriptState = createUiTranscriptState(),
): UiTranscriptState {
	return messages.reduce(reduceUiMessage, initial);
}

describe("reduceUiMessage", () => {
	it("accumulates assistant deltas into one streaming block", () => {
		const state = reduceAll([
			{ type: "assistant_delta", text: "Hel" },
			{ type: "assistant_delta", text: "lo " },
			{ type: "assistant_delta", text: "world" },
		]);
		expect(state.blocks).toEqual([
			{ kind: "assistant_text", text: "Hello world", streaming: true },
		]);
		expect(state.running).toBe(true);
	});

	it("splits assistant text around an interleaved reasoning stream", () => {
		const state = reduceAll([
			{ type: "assistant_delta", text: "first" },
			{ type: "reasoning_delta", text: "thinking" },
			{ type: "assistant_delta", text: "second" },
		]);
		expect(state.blocks).toEqual([
			{ kind: "assistant_text", text: "first", streaming: false },
			{ kind: "reasoning", text: "thinking", streaming: false, redacted: undefined },
			{ kind: "assistant_text", text: "second", streaming: true },
		]);
	});

	it("marks redacted reasoning and substitutes a placeholder for empty chunks", () => {
		const state = reduceAll([
			{ type: "reasoning_delta", text: "", redacted: true },
		]);
		expect(state.blocks).toEqual([
			{ kind: "reasoning", text: "[redacted]", streaming: true, redacted: true },
		]);
	});

	it("keeps accumulating reasoning across redacted and plain chunks", () => {
		const state = reduceAll([
			{ type: "reasoning_delta", text: "a" },
			{ type: "reasoning_delta", text: "b", redacted: true },
		]);
		expect(state.blocks).toEqual([
			{ kind: "reasoning", text: "ab", streaming: true, redacted: true },
		]);
	});

	it("tracks the tool lifecycle by toolCallId", () => {
		const running = reduceAll([
			{
				type: "tool_event",
				text: "read_files",
				event: {
					toolCallId: "t1",
					toolName: "read_files",
					status: "running",
					input: { file_paths: ["a.ts"] },
				},
			},
		]);
		expect(running.blocks).toEqual([
			{
				kind: "tool",
				toolCallId: "t1",
				toolName: "read_files",
				status: "running",
				text: "read_files",
				input: { file_paths: ["a.ts"] },
				output: undefined,
				error: undefined,
			},
		]);

		const completed = reduceAll(
			[
				{
					type: "tool_event",
					text: "read_files",
					event: {
						toolCallId: "t1",
						toolName: "read_files",
						status: "completed",
						output: "contents",
					},
				},
			],
			running,
		);
		expect(completed.blocks).toHaveLength(1);
		expect(completed.blocks[0]).toMatchObject({
			kind: "tool",
			status: "completed",
			output: "contents",
			// The completion event carries no input; the running input persists.
			input: { file_paths: ["a.ts"] },
		});
	});

	it("records tool failure with the error message", () => {
		const state = reduceAll([
			{
				type: "tool_event",
				text: "run_commands",
				event: {
					toolCallId: "t2",
					toolName: "run_commands",
					status: "failed",
					error: "exit 1",
				},
			},
		]);
		expect(state.blocks[0]).toMatchObject({
			kind: "tool",
			status: "failed",
			error: "exit 1",
		});
	});

	it("stops the run on fatal errors but keeps running on recoverable ones", () => {
		const busy = appendUserPrompt(createUiTranscriptState(), "go");
		const recoverable = reduceUiMessage(busy, {
			type: "error",
			text: "mistake",
			recoverable: true,
		});
		expect(recoverable.running).toBe(true);

		const fatal = reduceUiMessage(busy, { type: "error", text: "boom" });
		expect(fatal.running).toBe(false);
		expect(fatal.blocks.at(-1)).toEqual({
			kind: "error",
			text: "boom",
			recoverable: undefined,
		});
	});

	it("finalizes streams and records usage on turn completion", () => {
		const state = reduceAll([
			{ type: "assistant_delta", text: "done" },
			{
				type: "turn_done",
				finishReason: "completed",
				iterations: 2,
				usage: { inputTokens: 10, outputTokens: 20, totalCost: 0.5 },
			},
		]);
		expect(state.running).toBe(false);
		expect(state.blocks[0]).toMatchObject({
			kind: "assistant_text",
			streaming: false,
		});
		expect(state.lastTurn).toEqual({
			finishReason: "completed",
			iterations: 2,
			usage: { inputTokens: 10, outputTokens: 20, totalCost: 0.5 },
		});
	});

	it("clears the transcript but keeps catalog data on reset", () => {
		const populated = reduceAll([
			{
				type: "providers",
				providers: [{ id: "p", name: "P", enabled: true }],
			},
			{
				type: "defaults",
				defaults: { workspaceRoot: "/w", cwd: "/w" },
			},
			{ type: "assistant_delta", text: "hi" },
			{ type: "reset_done" },
		]);
		expect(populated.blocks).toEqual([]);
		expect(populated.providers).toHaveLength(1);
		expect(populated.defaults).toEqual({ workspaceRoot: "/w", cwd: "/w" });
	});

	it("hydrates a session into ordered blocks", () => {
		const state = reduceAll([
			{
				type: "session_hydrated",
				sessionId: "s1",
				messages: [
					{ id: "m1", role: "user", text: "hi" },
					{
						id: "m2",
						role: "assistant",
						text: "hello",
						reasoning: "think",
						toolEvents: [
							{
								id: "te1",
								name: "read_files",
								text: "read_files",
								state: "output-available",
								output: "ok",
							},
						],
					},
					{ id: "m3", role: "error", text: "late failure" },
				],
			},
		]);
		expect(state.sessionId).toBe("s1");
		expect(state.blocks.map((block) => block.kind)).toEqual([
			"user",
			"reasoning",
			"tool",
			"assistant_text",
			"error",
		]);
	});

	it("tracks pending prompts and drops them on submission", () => {
		const queued = reduceAll([
			{
				type: "pending_prompts",
				sessionId: "s1",
				prompts: [
					{ id: "q1", prompt: "later", delivery: "queue", attachmentCount: 0 },
				],
			},
		]);
		expect(queued.pendingPrompts).toHaveLength(1);

		const submitted = reduceUiMessage(queued, {
			type: "pending_prompt_submitted",
			sessionId: "s1",
			id: "q1",
			prompt: "later",
			delivery: "queue",
			attachmentCount: 0,
		});
		expect(submitted.pendingPrompts).toEqual([]);
		expect(submitted.blocks.at(-1)).toEqual({ kind: "user", text: "later" });
	});

	it("marks the session ended", () => {
		const state = reduceAll([
			{ type: "session_ended", sessionId: "s1", reason: "shutdown" },
		]);
		expect(state.running).toBe(false);
		expect(state.status).toBe("ended");
	});
});
