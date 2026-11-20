import type { MessageWithMetadata } from "@cline/llms";
import {
	createTool,
	type SideVisibleContext,
	SideVisibleContextSchema,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createContextCompactionPrepareTurn } from "../../extensions/context/compaction";
import { createSessionCompactionState } from "../models/session-compaction";
import { toPersistedToolResultContent } from "../persisted-tool-result-content";
import { MessageBuilder } from "../services/message-builder";
import { countUserRunMessages } from "../user-run-messages";
import { captureSideReference } from "./context";

const exchange = (question: string, answer: string): MessageWithMetadata[] => [
	{ role: "user", content: question },
	{ role: "assistant", content: answer },
];

const visibleContext = (excerpts: SideVisibleContext["excerpts"]) =>
	SideVisibleContextSchema.parse({
		sessionId: "parent",
		environmentId: "local",
		capturedAt: "2026-10-28T12:00:00Z",
		omittedExcerptCount: 0,
		omittedMediaCount: 0,
		excerpts,
	});

function toolResultMessage(
	output: unknown,
	{ name = "read_files", id = "call" } = {},
): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				name,
				tool_use_id: id,
				content: toPersistedToolResultContent(output),
			},
		],
	};
}

describe("side reference capture", () => {
	it.each([
		'"literal quotes"',
		'{"type":"image","data":"literal text"}',
	])("decodes a JSON string result only once: %s", (value) => {
		const capture = captureSideReference({
			messages: [
				toolResultMessage(JSON.stringify(value), {
					name: "report",
					id: "report",
				}),
			],
			activeParentTurn: false,
		});
		expect(capture.content).toContain(value);
	});

	it.each([
		"text",
		"json",
		"native",
	])("uses normal limits for %s tool results without unnecessary compaction", async (format) => {
		const producer = createTool({
			name: "large_report",
			description: "Synthetic large report",
			inputSchema: { type: "object", properties: {} },
			execute: async () => {
				const lines = Array.from(
					{ length: 40_000 },
					(_, index) => `line ${index}: synthetic report detail`,
				);
				const text = lines.join("\n");
				if (format === "text") return text;
				if (format === "json")
					return JSON.stringify(
						Array.from({ length: 40 }, (_, index) =>
							lines.slice(index * 1000, (index + 1) * 1000).join("\n"),
						),
					);
				return [
					{ type: "text", text },
					{ type: "text", text: `SECOND_RESULT_FACT ${text}` },
					{
						type: "image",
						data: "SNAPSHOT_MEDIA".repeat(3000),
						mediaType: "image/png",
					},
				];
			},
		});
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "Inspect report" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", name: "large_report", id: "large", input: {} },
				],
			},
			toolResultMessage(
				await producer.execute({}, { agentId: "parent", iteration: 0 }),
				{ name: "large_report", id: "large" },
			),
			{ role: "assistant", content: "Report inspected" },
		];
		const original = structuredClone(messages);
		const seed = captureSideReference({ messages, activeParentTurn: false });
		const compact = createContextCompactionPrepareTurn({
			providerId: "synthetic",
			modelId: "synthetic",
			compaction: { enabled: true, strategy: "basic" },
		});
		if (!compact) throw new Error("Expected built-in compaction");
		for (const input of [
			messages,
			[seed, { role: "user" as const, content: "What does the report say?" }],
		]) {
			expect(
				await compact({
					agentId: "test",
					conversationId: "test",
					parentAgentId: null,
					iteration: 0,
					messages: input,
					apiMessages: new MessageBuilder().buildForApi(input),
					abortSignal: new AbortController().signal,
					systemPrompt: "Answer questions",
					tools: [],
					model: {
						id: "synthetic",
						provider: "synthetic",
						info: { id: "synthetic", maxInputTokens: 64_000 },
					},
				}),
			).toBeUndefined();
		}
		expect(seed.content).toContain("line 0: synthetic report detail");
		expect(seed.content).toContain("line 39999: synthetic report detail");
		expect(seed.content).toContain("truncated");
		expect(seed.content).not.toContain("SNAPSHOT_MEDIA");
		if (format === "native")
			expect(seed.content).toContain("SECOND_RESULT_FACT");
		expect(messages).toEqual(original);
	});

	it("reuses existing compaction and its later messages without clipping or changing the source", () => {
		const earlier = exchange("old question", "old answer replaced by summary");
		const summary: MessageWithMetadata = {
			role: "user",
			content: "Existing summary: preserve the agreed architecture",
			metadata: { kind: "compaction_summary", userRunSpan: 1 },
		};
		const compactionState = createSessionCompactionState({
			sourceMessages: earlier,
			compactedMessages: [summary],
			systemPrompt: "PARENT_SYSTEM_INSTRUCTIONS",
		});
		const answer = `START ${"語".repeat(6000)} MIDDLE_FACT ${"語".repeat(6000)} END`;
		const messages = [...earlier, ...exchange("current question", answer)];
		const original = structuredClone({ messages, compactionState });
		const capture = captureSideReference({
			messages,
			compactionState,
			activeParentTurn: false,
		});
		expect(capture.content).toContain(summary.content);
		expect(capture.content).toContain("current question");
		expect(capture.content).toContain(answer);
		expect(capture.content).not.toContain("old answer replaced by summary");
		expect(capture.content).not.toContain("PARENT_SYSTEM_INSTRUCTIONS");
		expect({ messages, compactionState }).toEqual(original);
		const stale = captureSideReference({
			messages: exchange("different history", answer),
			compactionState,
			activeParentTurn: false,
		});
		expect(stale.content).toContain("different history");
		expect(stale.content).toContain(answer);
		expect(stale.content).not.toContain(summary.content);
	});

	it("captures active user/tool observations, excludes display-only notices, and preserves the source", () => {
		const messages: MessageWithMetadata[] = [
			...exchange("original goal", "answer"),
			{ role: "user", content: "read fixtures" },
			{
				role: "assistant",
				content: ["a", "b"].map((id) => ({
					type: "tool_use",
					id,
					name: "read_files",
					input: { path: `${id}.txt` },
				})),
				metrics: { cost: 9, inputTokens: 4000 },
				modelInfo: { id: "parent-model", provider: "parent-provider" },
			},
			{
				role: "user",
				content: ["a", "b"].map((id) => ({
					type: "tool_result",
					tool_use_id: id,
					name: "read_files",
					content: `${id} contents`,
					is_error: id === "b",
				})),
			},
			{ role: "assistant", content: "both inspected" },
			{
				role: "assistant",
				content: "UI notice",
				metadata: { displayOnly: true },
			},
			...exchange("active task", "still streaming"),
		];
		const original = structuredClone(messages);
		const capture = captureSideReference({
			messages,
			activeParentTurn: true,
		});
		expect(capture.content).toContain("1 saved messages omitted");
		expect(capture.content).toContain("b contents");
		expect(capture.content).toContain("Tool result read_files (b) [failed]:");
		expect(capture.content).toContain("active task");
		expect(capture.content).toContain("still streaming");
		expect(capture.content).toContain("may be partial");
		expect(capture.content).not.toContain("UI notice");
		expect(capture).not.toHaveProperty("metrics");
		expect(capture).not.toHaveProperty("modelInfo");
		expect(messages).toEqual(original);
	});

	it("includes pending tool observations while omitting media and parent cache handles", () => {
		const messages: MessageWithMetadata[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "describe" },
					{ type: "image", data: "BASE64_SECRET", mediaType: "image/png" },
				],
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "a",
						name: "read_files",
						input: { path: "cline://cache/parent/a.result.txt" },
					},
				],
			},
			toolResultMessage(
				[
					{
						type: "text",
						text: "preview cline://cache/parent/b.result.txt\nCache fact survives",
					},
					{ type: "image", data: "TOOL_IMAGE", mediaType: "image/png" },
				],
				{ id: "a" },
			),
			toolResultMessage(
				JSON.stringify({
					content: [
						{
							type: "audio",
							data: "AUDIO_SECRET".repeat(3000),
							mimeType: "audio/wav",
						},
						{
							type: "resource",
							resource: {
								uri: "fixture:image",
								mimeType: "image/png",
								blob: "BLOB_SECRET",
							},
						},
						{
							type: "resource",
							resource: {
								uri: "fixture:text",
								mimeType: "text/plain",
								text: "Resource evidence data:image/png;base64,QUJD\nMedia fact survives",
							},
						},
					],
					"cline://cache/parent/key": "Cache-key evidence",
					"data:image/png;base64,QUJD": "Media-key evidence",
				}),
				{ name: "mcp_media", id: "mcp" },
			),
			{ role: "assistant", content: "described" },
			{ role: "user", content: "incomplete question" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "missing", name: "custom_report", input: {} },
				],
			},
		];
		const capture = captureSideReference({
			messages,
			activeParentTurn: false,
		});
		expect(capture.content).toContain("0 saved messages omitted");
		expect(capture.content).toContain("4 media items omitted");
		expect(capture.content).toContain("[parent cache handle omitted]");
		expect(capture.content).toContain("Resource evidence");
		expect(capture.content).toContain("Cache fact survives");
		expect(capture.content).toContain("Media fact survives");
		expect(capture.content).toContain("Cache-key evidence");
		expect(capture.content).toContain("Media-key evidence");
		expect(capture.content).toContain("incomplete question");
		expect(capture.content).toContain("result not yet available");
		expect(capture.content).not.toMatch(
			/cline:\/\/cache|data:image|BASE64_SECRET|TOOL_IMAGE|AUDIO_SECRET|BLOB_SECRET/,
		);
	});
});

describe("current context and provider request", () => {
	it("retains provider-owned structured search results as inert text", () => {
		const source: MessageWithMetadata[] = [
			{ role: "user", content: "Explain synthetic PR 42" },
			{
				role: "assistant",
				content: "Inspecting it",
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "search",
							toolName: "web_search",
							execution: "provider",
							input: { query: "synthetic PR 42" },
							isError: true,
							output: [
								{
									type: "web_search_result",
									title: "PR 42 changes retry scheduling",
									content: `Provider head ${"p".repeat(20_000)} provider tail`,
								},
							],
						},
					],
				},
			},
		];
		const original = structuredClone(source);
		const capture = captureSideReference({
			messages: source,
			activeParentTurn: true,
		});
		expect(capture.content).toContain("PR 42 changes retry scheduling");
		expect(capture.content).toContain("Provider head");
		expect(capture.content).toContain("provider tail");
		expect(Buffer.byteLength(String(capture.content))).toBeLessThan(12_000);
		expect(capture.content).toContain(
			"Tool result web_search (search) [failed]:",
		);
		expect(capture.content).toContain("0 saved messages omitted");
		expect(source).toEqual(original);
	});

	it("keeps complete textual attachments and omits binary files", () => {
		const capture = captureSideReference({
			activeParentTurn: false,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "file",
							path: "requirements.txt",
							content: `START ${"a".repeat(5000)} MIDDLE ${"b".repeat(5000)} END`,
						},
						{
							type: "tool_result",
							name: "attachment",
							tool_use_id: "attachment",
							content: JSON.stringify([
								{
									type: "file",
									path: "cline://cache/parent/attachment.txt",
									content:
										"Nested requirement cline://cache/private/note\nNested fact survives",
									source: "attachment",
								},
								{
									type: "file",
									data: "BINARY_FILE",
									mediaType: "application/pdf",
								},
							]),
						},
					],
				},
			],
		});
		expect(capture.content).toContain('path="requirements.txt"');
		expect(capture.content).toContain("START");
		expect(capture.content).toContain("END");
		expect(capture.content).toContain("MIDDLE");
		expect(capture.content).toContain("Nested requirement");
		expect(capture.content).toContain("Nested fact survives");
		expect(capture.content).toContain("1 media items omitted");
		expect(capture.content).not.toMatch(/BINARY_FILE|cline:\/\/cache/);
	});

	it("deduplicates only a confirmed latest run and keeps uncertain repeated requests labeled", () => {
		const source = [
			...exchange("repeat", "old answer"),
			...exchange("repeat", "new answer completed"),
		];
		const visible = visibleContext([
			{
				messageId: "latest-user",
				role: "user",
				text: "repeat",
				runCount: 2,
				submission: "observed",
				omittedBytes: 0,
			},
			{
				messageId: "latest-answer",
				role: "assistant",
				text: "new answer",
				runCount: 2,
				submission: "observed",
				omittedBytes: 0,
			},
		]);
		const matched = captureSideReference({
			messages: source,
			activeParentTurn: true,
			visibleContext: visible,
		});
		expect(String(matched.content).match(/\brepeat\b/g)).toHaveLength(2);
		expect(matched.content).toContain("new answer completed");
		expect(matched.content).toContain("0 visible excerpts omitted");
		expect(matched.content).not.toContain(
			"chronology relative to saved history is unconfirmed",
		);
		const live = captureSideReference({
			messages: source,
			activeParentTurn: true,
			visibleContext: visibleContext([
				visible.excerpts[0],
				{
					...visible.excerpts[1],
					text: "new answer completed PLUS_VISIBLE_FACT",
				},
			]),
		});
		expect(live.content).toContain("PLUS_VISIBLE_FACT");
		expect(live.content).toContain("matched to the latest saved run");
		const uncertain = captureSideReference({
			messages: source,
			activeParentTurn: true,
			visibleContext: {
				...visible,
				excerpts: [
					{
						...visible.excerpts[0],
						runCount: undefined,
						submission: "unconfirmed",
					},
				],
			},
		});
		expect(String(uncertain.content).match(/\brepeat\b/g)).toHaveLength(3);
		expect(uncertain.content).toContain("submission unconfirmed");
		expect(uncertain.content).toContain(
			"chronology relative to saved history is unconfirmed and content may overlap",
		);
		const repeatedUnconfirmed = captureSideReference({
			messages: source,
			activeParentTurn: true,
			visibleContext: {
				...visible,
				excerpts: [
					visible.excerpts[0],
					{
						...visible.excerpts[0],
						messageId: "unconfirmed-repeat",
						submission: "unconfirmed",
					},
				],
			},
		});
		expect(
			String(repeatedUnconfirmed.content).match(/\brepeat\b/g),
		).toHaveLength(3);
		expect(repeatedUnconfirmed.content).toContain("submission unconfirmed");
		const repeatedObserved = captureSideReference({
			messages: source,
			activeParentTurn: true,
			visibleContext: visibleContext([
				visible.excerpts[0],
				{ ...visible.excerpts[0], messageId: "next-user", runCount: 3 },
				{ ...visible.excerpts[1], messageId: "next-answer", runCount: 3 },
			]),
		});
		expect(String(repeatedObserved.content).match(/\brepeat\b/g)).toHaveLength(
			3,
		);
		expect(repeatedObserved.content).toContain(
			"[visible assistant]\nnew answer",
		);
		expect(repeatedObserved.content).toContain(
			"chronology relative to saved history is unconfirmed",
		);
	});

	it("delivers active PR evidence to the actual API-handler request as text without parent tool protocol or usage", async () => {
		const { messagesToAgentMessages, agentMessagesToMessages } = await import(
			"../../runtime/config/agent-message-codec"
		);
		const { MessageBuilder } = await import(
			"../../session/services/message-builder"
		);
		const { createAgentModelFromApiHandler } = await import(
			"../../services/llms/apihandler-agent-model-adapter"
		);
		const answer = `The PR adds bounded retries ${"x".repeat(9000)} MIDDLE_FACT ${"y".repeat(9000)}`;
		const source: MessageWithMetadata[] = [
			{ role: "user", content: "Review synthetic PR 42" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: answer },
					{ type: "thinking", thinking: "HIDDEN_REASONING" },
					{
						type: "tool_use",
						id: "parent-read",
						name: "read_files",
						input: { path: "fixture.ts" },
					},
				],
				metrics: { cost: 99, inputTokens: 123456 },
			},
		];
		const original = structuredClone(source);
		const seed = captureSideReference({
			messages: source,
			activeParentTurn: true,
		});
		const canonical: MessageWithMetadata[] = [
			seed,
			{ role: "user", content: "What is this PR doing?" },
		];
		const working = messagesToAgentMessages(canonical);
		const prepared = new MessageBuilder().buildForApi(
			agentMessagesToMessages(working),
		);
		let requests = 0;
		const handler: import("@cline/llms").ApiHandler = {
			getMessages: () => [],
			getModel: () => ({ id: "synthetic", info: { id: "synthetic" } }),
			async *createMessage(_system, messages) {
				requests++;
				expect(messages).toHaveLength(2);
				expect(messages[0]).toMatchObject({
					role: "user",
					content: [
						{
							type: "text",
							text: expect.stringContaining(answer),
						},
					],
				});
				expect(messages[1]).toMatchObject({
					role: "user",
					content: [{ type: "text", text: "What is this PR doing?" }],
				});
				expect(JSON.stringify(messages)).not.toMatch(
					/HIDDEN_REASONING|123456|"type":"tool_use"|"type":"tool_result"/,
				);
				yield { type: "done", success: true, id: "synthetic-done" };
			},
		};
		for await (const _event of await createAgentModelFromApiHandler(
			handler,
		).stream({
			systemPrompt: "Side conversation",
			messages: messagesToAgentMessages(prepared),
			tools: [],
		})) {
			/* Consume the provider request. */
		}
		expect(requests).toBe(1);
		expect(countUserRunMessages(canonical)).toBe(1);
		expect(source).toEqual(original);
	});
});
