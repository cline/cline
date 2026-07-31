import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
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
