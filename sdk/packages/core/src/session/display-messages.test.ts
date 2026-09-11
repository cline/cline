import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { projectSessionMessagesForDisplay } from "./display-messages";

describe("projectSessionMessagesForDisplay", () => {
	it("projects completed activities into ordinary display-only tool messages", () => {
		const source: MessageWithMetadata[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: [{ type: "text", text: "Bun 1.3.14 is current." }],
				ts: 42,
				modelInfo: { id: "gpt-5", provider: "openai-native" },
				metrics: { inputTokens: 10, outputTokens: 4 },
				metadata: {
					traceId: "trace-1",
					modelToolActivities: [
						{
							toolCallId: "search-1",
							toolName: "web_search",
							execution: "provider",
							input: { query: "latest Bun release" },
							output: { sources: ["bun.sh"] },
						},
					],
				},
			},
		];

		const result = projectSessionMessagesForDisplay(source);
		const messages = result.map(({ message }) => message);

		expect(result.map(({ origin }) => origin)).toEqual([
			"model_tool_activity",
			"model_tool_activity",
			"history",
		]);
		expect(messages).toEqual([
			{
				id: "assistant-1_model_tool_0_use",
				agent: undefined,
				sessionId: undefined,
				ts: 42,
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "search-1",
						name: "web_search",
						input: { query: "latest Bun release" },
					},
				],
				metadata: {
					userRunSpan: 0,
				},
				modelInfo: { id: "gpt-5", provider: "openai-native" },
			},
			{
				id: "assistant-1_model_tool_0_result",
				agent: undefined,
				sessionId: undefined,
				ts: 42,
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "search-1",
						name: "web_search",
						content: '{"sources":["bun.sh"]}',
						is_error: undefined,
					},
				],
				metadata: {
					userRunSpan: 0,
				},
			},
			{
				...source[0],
				metadata: { traceId: "trace-1" },
			},
		]);
		expect(messages[2]?.metrics).toEqual(source[0]?.metrics);
		expect(result[0]?.execution).toBe("provider");
		expect(result[2]?.execution).toBeUndefined();
		expect(source[0]?.metadata).toHaveProperty("modelToolActivities");
	});

	it("keeps incomplete activities pending and preserves error results", () => {
		const result = projectSessionMessagesForDisplay([
			{
				id: "assistant-2",
				role: "assistant",
				content: "Search failed",
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "pending",
							toolName: "web_search",
							execution: "provider",
							input: { query: "pending" },
						},
						{
							toolCallId: "failed",
							toolName: "web_search",
							execution: "client",
							input: { query: "failed" },
							output: "network error",
							isError: true,
						},
					],
				},
			},
		]);

		expect(result.map(({ message }) => message.id)).toEqual([
			"assistant-2_model_tool_0_use",
			"assistant-2_model_tool_1_use",
			"assistant-2_model_tool_1_result",
			"assistant-2",
		]);
		expect(result[2]?.message.content).toEqual([
			{
				type: "tool_result",
				tool_use_id: "failed",
				name: "web_search",
				content: "network error",
				is_error: true,
			},
		]);
	});

	it("ignores malformed metadata and is idempotent", () => {
		const source: MessageWithMetadata[] = [
			{ role: "user", content: "hello" },
			{
				role: "assistant",
				content: "world",
				metadata: {
					modelToolActivities: [
						null,
						{ toolCallId: "missing-fields" },
						{
							toolCallId: "valid",
							toolName: "web_search",
							execution: "provider",
							output: [],
						},
					],
				},
			},
		];

		const once = projectSessionMessagesForDisplay(source);
		const twice = projectSessionMessagesForDisplay(
			once.map(({ message }) => message),
		);

		expect(twice.map(({ message }) => message)).toEqual(
			once.map(({ message }) => message),
		);
		expect(once).toHaveLength(4);
	});

	it("passes malformed transcript entries through without throwing", () => {
		const source = [
			null,
			42,
			{ content: "missing role" },
		] as unknown as MessageWithMetadata[];

		expect(projectSessionMessagesForDisplay(source)).toEqual([]);
	});

	it("uses a stable tool-call fallback when a persisted message id is malformed", () => {
		const source = [
			{
				id: 42,
				role: "assistant",
				content: "answer",
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "search-stable",
							toolName: "web_search",
							execution: "provider",
							output: [],
						},
					],
				},
			},
		] as unknown as MessageWithMetadata[];

		expect(
			projectSessionMessagesForDisplay(source).map(({ message }) => message.id),
		).toEqual([
			"model_tool_search-stable_model_tool_0_use",
			"model_tool_search-stable_model_tool_0_result",
			42,
		]);
	});
});
