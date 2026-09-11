import { EMPTY_CONTENT_TEXT, type MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { projectSessionMessagesForDisplay } from "../../session/display-messages";
import {
	agentMessageToMessageWithMetadata,
	messagesToAgentMessages,
	messageToAgentMessages,
} from "./agent-message-codec";

describe("agent message codec", () => {
	it("projects provider activity with the same persisted payload as a local tool", () => {
		const nativeSearchResults = [
			{
				type: "web_search_result",
				url: "https://bun.sh/blog/bun-v1.3.14",
				title: "Bun v1.3.14",
				pageAge: "2026-08-12",
				encryptedContent: "encrypted",
			},
		];
		const localToolMessages = [
			agentMessageToMessageWithMetadata({
				id: "local-use",
				role: "assistant",
				createdAt: 1,
				content: [
					{
						type: "tool-call",
						toolCallId: "search-1",
						toolName: "web_search",
						input: { query: "answer" },
					},
				],
			}),
			agentMessageToMessageWithMetadata({
				id: "local-result",
				role: "tool",
				createdAt: 2,
				content: [
					{
						type: "tool-result",
						toolCallId: "search-1",
						toolName: "web_search",
						output: nativeSearchResults,
					},
				],
			}),
		];
		const source: MessageWithMetadata[] = [
			{
				id: "assistant-with-search",
				role: "assistant",
				content: "The answer",
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "search-1",
							toolName: "web_search",
							execution: "provider",
							input: { query: "answer" },
							output: nativeSearchResults,
						},
					],
				},
			},
		];
		const projectedToolMessages = projectSessionMessagesForDisplay(source)
			.filter(({ origin }) => origin === "model_tool_activity")
			.map(({ message }) => message);

		expect(
			projectedToolMessages.map(({ role, content }) => ({ role, content })),
		).toEqual(
			localToolMessages.map(({ role, content }) => ({ role, content })),
		);
	});

	it("loads old messages without model-tool metadata and preserves new metadata", () => {
		const oldMessage = {
			id: "old-session-message",
			role: "assistant" as const,
			ts: 1,
			content: [{ type: "text" as const, text: "Existing history" }],
		};
		const [restoredOld] = messageToAgentMessages(oldMessage);
		expect(restoredOld?.metadata).toBeUndefined();

		const metadata = {
			modelToolActivities: [
				{
					toolCallId: "search_1",
					toolName: "web_search",
					execution: "client",
					input: { query: "Cline" },
					output: { results: [] },
				},
			],
		};
		const [restoredNew] = messageToAgentMessages({
			...oldMessage,
			id: "new-session-message",
			metadata,
		});
		expect(restoredNew?.metadata).toEqual(metadata);
		if (!restoredNew) {
			throw new Error("Expected the new message to be restored");
		}
		expect(agentMessageToMessageWithMetadata(restoredNew).metadata).toEqual(
			metadata,
		);
	});

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

	it("assigns a persisted user-run span to only one split segment", () => {
		const messages = messageToAgentMessages({
			id: "compacted-mixed",
			role: "user",
			ts: 1,
			content: [
				{ type: "text", text: "Earlier user context" },
				{
					type: "tool_result",
					tool_use_id: "toolu_1",
					name: "read_files",
					content: "Tool output",
				},
				{ type: "text", text: "Later user context" },
			],
			metadata: {
				kind: "compaction",
				userRunSpan: 3,
			},
		});

		expect(messages.map((message) => message.role)).toEqual([
			"user",
			"tool",
			"user",
		]);
		expect(messages.map((message) => message.metadata?.userRunSpan)).toEqual([
			3, 0, 0,
		]);

		const persistedParts = messages.map(agentMessageToMessageWithMetadata);
		const restored = messagesToAgentMessages(persistedParts);
		expect(restored.map((message) => message.metadata?.userRunSpan)).toEqual([
			3, 0, 0,
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
