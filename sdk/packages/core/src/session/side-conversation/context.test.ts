import type { MessageWithMetadata } from "@cline/llms";
import { SIDE_REFERENCE_BUDGET_BYTES } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { countUserRunMessages } from "../user-run-messages";
import { captureSideReference } from "./context";

const exchange = (question: string, answer: string): MessageWithMetadata[] => [
	{ role: "user", content: question },
	{ role: "assistant", content: answer },
];

describe("side reference capture", () => {
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
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "a",
						name: "read_files",
						content: [
							{
								type: "text",
								text: "preview cline://cache/parent/b.result.txt",
							},
							{ type: "image", data: "TOOL_IMAGE", mediaType: "image/png" },
						],
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "mcp",
						name: "mcp_media",
						content: JSON.stringify({
							content: [
								{ type: "audio", data: "AUDIO_SECRET", mimeType: "audio/wav" },
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
										text: "Resource evidence",
									},
								},
							],
						}),
					},
				],
			},
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
		expect(capture.content).toContain("incomplete question");
		expect(capture.content).toContain("result not yet available");
		expect(capture.content).not.toMatch(
			/cline:\/\/cache|BASE64_SECRET|TOOL_IMAGE|AUDIO_SECRET|BLOB_SECRET/,
		);
	});

	it("retains requests and UTF-8 head/tail excerpts when individual blocks exceed the cap", () => {
		const messages = [
			...exchange("initial goal", "initial answer"),
			...exchange("oversized", "語".repeat(30000)),
			...exchange("recent", "語".repeat(18000)),
		];
		const capture = captureSideReference({
			messages,
			activeParentTurn: false,
		});
		expect(Buffer.byteLength(String(capture.content))).toBeLessThanOrEqual(
			SIDE_REFERENCE_BUDGET_BYTES,
		);
		expect(capture.content).toContain(
			"0 saved messages omitted; 2 saved messages partly represented; 2 excerpted blocks",
		);
		expect(capture.content).toContain("initial goal");
		expect(capture.content).toContain("recent");
		expect(capture.content).toContain("oversized");
		expect(capture.content).not.toContain("�");
		expect(capture.content).toContain("UTF-8 bytes omitted");
		expect(
			captureSideReference({
				messages: exchange("active", "partial"),
				activeParentTurn: true,
			}).content,
		).toContain("partial");
	});
});

describe("current context and provider request", () => {
	it("retains provider-owned structured search results and ordinary tools as inert text", () => {
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
							output: [
								{
									type: "web_search_result",
									title: "PR 42 changes retry scheduling",
								},
							],
						},
					],
				},
			},
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "custom", name: "custom_report", input: {} },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "custom",
						name: "custom_report",
						content: "Adds a maximum attempt count",
					},
				],
			},
		];
		const original = structuredClone(source);
		const capture = captureSideReference({
			messages: source,
			activeParentTurn: true,
		});
		expect(capture.content).toContain("PR 42 changes retry scheduling");
		expect(capture.content).toContain("Adds a maximum attempt count");
		expect(capture.content).toContain("0 saved messages omitted");
		expect(source).toEqual(original);
	});

	it("prioritizes current and original requests within the total cap, including clipped labels", () => {
		const source = Array.from({ length: 30 }, (_, index) =>
			exchange(
				`request ${index}`,
				`head ${index} ${"😀語".repeat(3000)} tail ${index}`,
			),
		).flat();
		const capture = captureSideReference({
			messages: source,
			activeParentTurn: true,
		});
		expect(Buffer.byteLength(String(capture.content))).toBeLessThanOrEqual(
			SIDE_REFERENCE_BUDGET_BYTES,
		);
		expect(capture.content).toContain("request 0");
		expect(capture.content).toContain("request 29");
		expect(capture.content).toContain("head 29");
		expect(capture.content).toContain("tail 29");
		expect(capture.content).not.toContain("�");
		expect(capture.content).toContain("intervening saved content omitted");
		expect(capture.content).toMatch(/[1-9]\d* saved messages omitted/);
		expect(capture.content).toMatch(/[1-9]\d* excerpted blocks/);
	});

	it("deduplicates only a confirmed latest run and keeps uncertain repeated requests labeled", () => {
		const source = [
			...exchange("repeat", "old answer"),
			...exchange("repeat", "new answer completed"),
		];
		const visible = {
			sessionId: "parent",
			environmentId: "local",
			capturedAt: "2026-10-28T12:00:00Z",
			omittedExcerptCount: 0,
			omittedMediaCount: 0,
			excerpts: [
				{
					messageId: "latest-user",
					role: "user" as const,
					text: "repeat",
					runCount: 2,
					submission: "observed" as const,
					omittedBytes: 0,
				},
				{
					messageId: "latest-answer",
					role: "assistant" as const,
					text: "new answer",
					runCount: 2,
					submission: "observed" as const,
					omittedBytes: 0,
				},
			],
		};
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
		const source: MessageWithMetadata[] = [
			{ role: "user", content: "Review synthetic PR 42" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "The PR adds bounded retries" },
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
							text: expect.stringContaining("The PR adds bounded retries"),
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
