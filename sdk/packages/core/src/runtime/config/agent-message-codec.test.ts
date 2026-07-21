import type { MessageWithMetadata } from "@cline/shared";
import { EMPTY_CONTENT_TEXT } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	agentMessageToMessageWithMetadata,
	messageToAgentMessages,
	messagesToAgentMessages,
} from "./agent-message-codec";

describe("agent message codec", () => {
	it("replaces empty persisted messages with an explicit error text part", () => {
		expect(
			messageToAgentMessages({
				id: "empty",
				role: "assistant",
				ts: 1,
				content: [],
			}),
		).toEqual([
			{
				id: "empty",
				role: "assistant",
				content: [{ type: "text", text: EMPTY_CONTENT_TEXT }],
				createdAt: 1,
				metadata: undefined,
				modelInfo: undefined,
				metrics: undefined,
			},
		]);
		expect(
			messageToAgentMessages({
				id: "blank",
				role: "user",
				ts: 1,
				content: "",
			}),
		).toEqual([
			{
				id: "blank",
				role: "user",
				content: [{ type: "text", text: EMPTY_CONTENT_TEXT }],
				createdAt: 1,
				metadata: undefined,
				modelInfo: undefined,
				metrics: undefined,
			},
		]);
		expect(
			messageToAgentMessages({
				id: "whitespace",
				role: "assistant",
				ts: 1,
				content: "   \n\t  ",
			}),
		).toEqual([
			{
				id: "whitespace",
				role: "assistant",
				content: [{ type: "text", text: EMPTY_CONTENT_TEXT }],
				createdAt: 1,
				metadata: undefined,
				modelInfo: undefined,
				metrics: undefined,
			},
		]);
	});

	it("preserves mixed tool result and user text order", () => {
		const messages = messageToAgentMessages({
			id: "msg_mixed",
			role: "user",
			ts: 1,
			content: [
				{
					type: "tool_result",
					tool_use_id: "toolu_1",
					name: "run_commands",
					content: "tool output",
				},
				{
					type: "text",
					text: "steer this next",
				},
			],
		});

		expect(messages.map((message) => message.role)).toEqual(["tool", "user"]);
		expect(messages[0]?.content).toEqual([
			{
				type: "tool-result",
				toolCallId: "toolu_1",
				toolName: "run_commands",
				output: "tool output",
				isError: undefined,
			},
		]);
		expect(messages[1]?.content).toEqual([
			{
				type: "text",
				text: "steer this next",
			},
		]);
	});

	it("keeps user text before later tool results", () => {
		const messages = messageToAgentMessages({
			id: "msg_text_first",
			role: "user",
			ts: 1,
			content: [
				{
					type: "text",
					text: "before",
				},
				{
					type: "tool_result",
					tool_use_id: "toolu_2",
					name: "read_files",
					content: "tool output",
				},
			],
		});

		expect(messages.map((message) => message.role)).toEqual(["user", "tool"]);
		expect(messages[0]?.content).toEqual([{ type: "text", text: "before" }]);
		expect(messages[1]?.content).toEqual([
			expect.objectContaining({
				type: "tool-result",
				toolCallId: "toolu_2",
				toolName: "read_files",
			}),
		]);
	});

	it("round-trips Gemini tool call thought signatures", () => {
		const persisted = agentMessageToMessageWithMetadata({
			id: "msg_tool_call",
			role: "assistant",
			createdAt: 1,
			content: [
				{
					type: "tool-call",
					toolCallId: "toolu_4",
					toolName: "editor",
					input: { path: "/tmp/out.txt" },
					metadata: {
						thoughtSignature: "sig_4",
					},
				},
			],
		});

		expect(persisted.content).toEqual([
			expect.objectContaining({
				type: "tool_use",
				id: "toolu_4",
				name: "editor",
				signature: "sig_4",
			}),
		]);

		const [restored] = messagesToAgentMessages([persisted]);
		expect(restored?.content[0]).toMatchObject({
			type: "tool-call",
			toolCallId: "toolu_4",
			toolName: "editor",
			metadata: {
				signature: "sig_4",
			},
		});
	});

	it("keeps tool-result ids stable across repeated encode/decode cycles", () => {
		// One encode -> decode round trip. Returns the decoded message so the
		// caller can feed it back in and prove re-encoding does not grow the id.
		const cycle = (message: MessageWithMetadata): MessageWithMetadata => {
			const [encoded] = messageToAgentMessages(message);
			expect(encoded?.id).toBe("msg_x_tool_call_abc");
			return agentMessageToMessageWithMetadata(
				encoded ?? { id: "", role: "user", content: [], createdAt: 0 },
			);
		};

		const source: MessageWithMetadata = {
			id: "msg_x",
			role: "user",
			ts: 1,
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_abc",
					name: "run_commands",
					content: "tool output",
				},
			],
		};

		let persisted = source;
		for (let pass = 0; pass < 3; pass += 1) {
			persisted = cycle(persisted);
			expect(persisted.id).toBe("msg_x_tool_call_abc");
		}
	});

	it("keeps ids stable for a message with multiple tool results", () => {
		const first = messageToAgentMessages({
			id: "msg_multi",
			role: "user",
			ts: 1,
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_a",
					name: "read_files",
					content: "a",
				},
				{
					type: "tool_result",
					tool_use_id: "call_b",
					name: "read_files",
					content: "b",
				},
			],
		});

		const firstIds = first.map((message) => message.id);
		expect(firstIds).toEqual([
			"msg_multi_tool_call_a",
			"msg_multi_tool_call_b",
		]);

		const reEncodedIds = first.flatMap((message) =>
			messageToAgentMessages(agentMessageToMessageWithMetadata(message)).map(
				(re) => re.id,
			),
		);
		expect(reEncodedIds).toEqual(firstIds);
	});

	it("keeps ids distinct across re-encode when text surrounds a tool result", () => {
		// A tool result with non-tool blocks on BOTH sides splits into three
		// AgentMessages: baseId, baseId_tool_<id>, baseId_part_1. Only the
		// `_tool_` suffix may be stripped on re-encode — stripping `_part_1`
		// would collapse the trailing text segment back onto the base id and
		// collide with the leading one.
		const first = messageToAgentMessages({
			id: "msg_mixed_id",
			role: "user",
			ts: 1,
			content: [
				{ type: "text", text: "before" },
				{
					type: "tool_result",
					tool_use_id: "call_c",
					name: "editor",
					content: "done",
				},
				{ type: "text", text: "after" },
			],
		});

		expect(first.map((message) => message.id)).toEqual([
			"msg_mixed_id",
			"msg_mixed_id_tool_call_c",
			"msg_mixed_id_part_1",
		]);

		const reEncoded = first.flatMap((message) =>
			messageToAgentMessages(agentMessageToMessageWithMetadata(message)).map(
				(re) => re.id,
			),
		);
		expect(reEncoded).toEqual([
			"msg_mixed_id",
			"msg_mixed_id_tool_call_c",
			"msg_mixed_id_part_1",
		]);
		expect(new Set(reEncoded).size).toBe(reEncoded.length);
	});

	it("does not strip a base id that contains _tool_ but is not an encoded suffix", () => {
		// The base id legitimately ends in `_tool_summary`, which is NOT the
		// message's tool_use_id (`call_d`). Only a `_tool_<toolUseId>` that
		// matches an actual tool_use_id in the message is treated as an encoded
		// suffix, so the base id must survive untouched.
		const [encoded] = messageToAgentMessages({
			id: "msg_tool_summary",
			role: "user",
			ts: 1,
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_d",
					name: "editor",
					content: "done",
				},
			],
		});

		expect(encoded?.id).toBe("msg_tool_summary_tool_call_d");

		const [reEncoded] = messageToAgentMessages(
			agentMessageToMessageWithMetadata(
				encoded ?? { id: "", role: "user", content: [], createdAt: 0 },
			),
		);
		expect(reEncoded?.id).toBe("msg_tool_summary_tool_call_d");
	});

	it("preserves an empty-string message id", () => {
		// An empty-string id is a real (if unusual) value, distinct from a
		// missing id. It must be preserved, not replaced with a generated id.
		const [encoded] = messageToAgentMessages({
			id: "",
			role: "user",
			ts: 1,
			content: [{ type: "text", text: "hi" }],
		});

		expect(encoded?.id).toBe("");
	});
});
