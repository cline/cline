import { EMPTY_CONTENT_TEXT } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	agentMessageToMessageWithMetadata,
	messagesToAgentMessages,
	messageToAgentMessages,
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

	it("keeps tool result message ids stable across restore/persist round-trips", () => {
		// Regression: the tool-id suffix used to be re-appended on every
		// conversion, so each agent.restore() mutated the id. Ids feed the
		// compaction source-prefix hash, so the drift silently invalidated
		// saved compaction state and the model kept receiving the full
		// transcript after a successful /compact.
		const persisted = {
			id: "msg_result_1",
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_abc_1",
					name: "read_files",
					content: "file contents",
				},
			],
			ts: 1_784_249_275_514,
		};

		const [firstPass] = messagesToAgentMessages([persisted]);
		expect(firstPass?.id).toBe("msg_result_1");

		const roundTripped = agentMessageToMessageWithMetadata(firstPass!);
		const [secondPass] = messagesToAgentMessages([roundTripped]);
		expect(secondPass?.id).toBe("msg_result_1");
		expect(agentMessageToMessageWithMetadata(secondPass!)).toEqual(
			roundTripped,
		);
	});

	it("still disambiguates tool results split out of a mixed message", () => {
		const mixed = {
			id: "msg_mixed",
			role: "user" as const,
			content: [
				{ type: "text" as const, text: "feedback" },
				{
					type: "tool_result" as const,
					tool_use_id: "call_a",
					name: "read_files",
					content: "a",
				},
				{
					type: "tool_result" as const,
					tool_use_id: "call_b",
					name: "read_files",
					content: "b",
				},
			],
			ts: 1,
		};

		const split = messagesToAgentMessages([mixed]);
		expect(split.map((message) => message.id)).toEqual([
			"msg_mixed",
			"msg_mixed_tool_call_a",
			"msg_mixed_tool_call_b",
		]);

		// A second round-trip of the split parts must not grow the ids.
		const persistedParts = split.map(agentMessageToMessageWithMetadata);
		const secondPass = messagesToAgentMessages(persistedParts);
		expect(secondPass.map((message) => message.id)).toEqual([
			"msg_mixed",
			"msg_mixed_tool_call_a",
			"msg_mixed_tool_call_b",
		]);
	});
});
