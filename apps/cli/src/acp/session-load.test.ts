import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { ACT_MODE_CONTINUATION_PROMPT } from "../runtime/interactive/mode";
import {
	replaySessionHistory,
	translateHistoricalMessage,
} from "./session-load";

describe("translateHistoricalMessage", () => {
	it("maps string content to a message chunk for the right role", () => {
		expect(translateHistoricalMessage({ role: "user", content: "hi" })).toEqual(
			[
				{
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "hi" },
				},
			],
		);

		expect(
			translateHistoricalMessage({ role: "assistant", content: "hello" }),
		).toEqual([
			{
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "hello" },
			},
		]);
	});

	it("strips the <user_input> wrapper from replayed user text", () => {
		// Persisted user messages keep their runtime-generated wrapper. Replaying
		// it verbatim leaked markup to the client, which rendered the unknown
		// element as bare text (a one-word prompt showed up as just its content
		// with the wrapper swallowed).
		expect(
			translateHistoricalMessage({
				role: "user",
				content: '<user_input mode="act">s</user_input>',
			}),
		).toEqual([
			{
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text: "s" },
			},
		]);

		expect(
			translateHistoricalMessage({
				role: "user",
				content: [
					{
						type: "text",
						text: '<user_input mode="plan">lets do it</user_input>',
					},
				],
			}),
		).toEqual([
			{
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text: "lets do it" },
			},
		]);
	});

	it("strips mode notices and formats slash commands for display", () => {
		expect(
			translateHistoricalMessage({
				role: "user",
				content:
					'<user_input mode="plan"><mode_notice>The user switched from act mode to plan mode before sending this message.</mode_notice>\nare you okay?</user_input>',
			}),
		).toEqual([
			{
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text: "are you okay?" },
			},
		]);

		expect(
			translateHistoricalMessage({
				role: "user",
				content:
					'<user_command slash="team">spawn a team of agents for the following task: inspect rpc startup</user_command>',
			}),
		).toEqual([
			{
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text: "/team inspect rpc startup" },
			},
		]);
	});

	it("does not replay the synthetic act-mode continuation prompt", () => {
		expect(
			translateHistoricalMessage({
				role: "user",
				content: `<user_input mode="act">${ACT_MODE_CONTINUATION_PROMPT}</user_input>`,
			}),
		).toEqual([]);
	});

	it("leaves assistant text untouched", () => {
		// Only user text carries the wrapper; agent output must replay verbatim.
		expect(
			translateHistoricalMessage({
				role: "assistant",
				content: 'Use <user_input mode="act"> to wrap prompts.',
			}),
		).toEqual([
			{
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: 'Use <user_input mode="act"> to wrap prompts.',
				},
			},
		]);
	});

	it("skips empty text and unknown blocks", () => {
		expect(
			translateHistoricalMessage({
				role: "assistant",
				content: [
					{ type: "text", text: "" },
					{ type: "redacted_thinking", data: "xxx" },
				],
			}),
		).toEqual([]);
	});

	it("maps thinking blocks to agent_thought_chunk", () => {
		expect(
			translateHistoricalMessage({
				role: "assistant",
				content: [{ type: "thinking", thinking: "pondering" }],
			}),
		).toEqual([
			{
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: "pondering" },
			},
		]);
	});

	it("maps tool_use to a pending tool_call", () => {
		const updates = translateHistoricalMessage({
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "call-1",
					name: "read_files",
					input: { file_paths: ["a.ts"] },
				},
			],
		});
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			sessionUpdate: "tool_call",
			toolCallId: "call-1",
			kind: "read",
			status: "pending",
			rawInput: { file_paths: ["a.ts"] },
		});
	});

	it("maps tool_result to a tool_call_update with flattened output", () => {
		expect(
			translateHistoricalMessage({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call-1",
						name: "read_files",
						content: [
							{ type: "text", text: "line one" },
							{ type: "image", data: "abc", mediaType: "image/png" },
						],
					},
				],
			}),
		).toEqual([
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "call-1",
				status: "completed",
				rawOutput: "line one\n[image]",
			},
		]);
	});

	it("marks errored tool results as failed", () => {
		const [update] = translateHistoricalMessage({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call-2",
					name: "run_commands",
					content: "boom",
					is_error: true,
				},
			],
		});
		expect(update).toMatchObject({
			sessionUpdate: "tool_call_update",
			toolCallId: "call-2",
			status: "failed",
			rawOutput: "boom",
		});
	});

	it("maps image blocks to image content chunks", () => {
		expect(
			translateHistoricalMessage({
				role: "user",
				content: [{ type: "image", data: "abc", mediaType: "image/png" }],
			}),
		).toEqual([
			{
				sessionUpdate: "user_message_chunk",
				content: { type: "image", data: "abc", mimeType: "image/png" },
			},
		]);
	});

	it("replays provider model tools with the ordinary ACP tool updates", () => {
		expect(
			translateHistoricalMessage({
				role: "assistant",
				content: "Found it",
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "search-1",
							toolName: "web_search",
							execution: "provider",
							input: { query: "latest Bun release" },
							output: "Bun 1.3.14",
						},
					],
				},
			} as Parameters<typeof translateHistoricalMessage>[0]),
		).toEqual([
			{
				sessionUpdate: "tool_call",
				toolCallId: "search-1",
				title: expect.any(String),
				kind: "search",
				status: "pending",
				rawInput: { query: "latest Bun release" },
			},
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "search-1",
				status: "completed",
				rawOutput: "Bun 1.3.14",
			},
			{
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Found it" },
			},
		]);
	});

	it("preserves structured native web-search results", () => {
		const nativeResult = {
			type: "web_search_result",
			url: "https://bun.sh/blog/bun-v1.3.14",
			title: "Bun v1.3.14",
			pageAge: "2026-08-12",
			encryptedContent: "encrypted",
		};
		const updates = translateHistoricalMessage({
			role: "assistant",
			content: "Found it",
			metadata: {
				modelToolActivities: [
					{
						toolCallId: "search-native",
						toolName: "web_search",
						execution: "provider",
						input: { query: "latest Bun" },
						output: [nativeResult],
					},
				],
			},
		} as Parameters<typeof translateHistoricalMessage>[0]);

		expect(updates[1]).toMatchObject({
			sessionUpdate: "tool_call_update",
			toolCallId: "search-native",
			rawOutput: JSON.stringify(nativeResult),
		});
	});
});

describe("replaySessionHistory", () => {
	it("sends one awaited notification per update, in order", async () => {
		const sent: unknown[] = [];
		const conn = {
			sessionUpdate: vi.fn(async (notification: unknown) => {
				sent.push(notification);
			}),
		} as unknown as AgentSideConnection;

		await replaySessionHistory(conn, "sess-1", [
			{ role: "user", content: "question" },
			{ role: "assistant", content: "answer" },
		]);

		expect(sent).toEqual([
			{
				sessionId: "sess-1",
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "question" },
				},
			},
			{
				sessionId: "sess-1",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "answer" },
				},
			},
		]);
	});
});
