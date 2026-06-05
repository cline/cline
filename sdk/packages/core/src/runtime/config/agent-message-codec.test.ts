import { EMPTY_CONTENT_TEXT } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { messageToAgentMessages } from "./agent-message-codec";

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
});
