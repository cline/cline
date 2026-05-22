import { describe, expect, it } from "vitest";
import {
	agentMessageToMessageWithMetadata,
	messageToAgentMessages,
	messagesToAgentMessages,
} from "./agent-message-codec";

describe("agent message codec", () => {
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
				thoughtSignature: "sig_4",
			},
		});
	});
});
