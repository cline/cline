import { describe, expect, it } from "vitest";
import {
	agentMessageToMessageWithMetadata,
	messagesToAgentMessages,
	messageToAgentMessages,
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
				toolName: "",
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
			}),
		]);
	});

	it("restores tool result names from previous assistant tool uses", () => {
		const messages = messagesToAgentMessages([
			{
				id: "msg_assistant",
				role: "assistant",
				ts: 1,
				content: [
					{
						type: "tool_use",
						id: "toolu_3",
						call_id: "call_3",
						name: "editor",
						input: {
							path: "/tmp/out.txt",
							new_text: "ok",
						},
					},
				],
			},
			{
				id: "msg_result",
				role: "user",
				ts: 2,
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_3",
						content: "created",
					},
					{
						type: "tool_result",
						tool_use_id: "call_3",
						content: "created via provider call id",
					},
				],
			},
		]);

		expect(messages.at(1)?.content).toEqual([
			{
				type: "tool-result",
				toolCallId: "toolu_3",
				toolName: "editor",
				output: "created",
				isError: undefined,
			},
		]);
		expect(messages.at(2)?.content).toEqual([
			{
				type: "tool-result",
				toolCallId: "call_3",
				toolName: "editor",
				output: "created via provider call id",
				isError: undefined,
			},
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
