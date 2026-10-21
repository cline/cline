import type { ApiStreamChunk } from "@cline/llms";
import type {
	MessageWithMetadata,
	ToolResultContent,
	ToolUseContent,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toPersistedToolResultContent } from "../../session/persisted-tool-result-content";
import { buildSummaryMessage, estimateTokens } from "./compaction-shared";
import { summarizeConversation } from "./summarize-conversation";

const { createHandlerMock, createMessageMock } = vi.hoisted(() => ({
	createHandlerMock: vi.fn(),
	createMessageMock: vi.fn(),
}));

vi.mock("@cline/llms", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/llms")>()),
	createHandlerAsync: createHandlerMock,
}));

const config = {
	providerId: "anthropic",
	modelId: "test-model",
	apiKey: "fresh-token",
};
const messages: MessageWithMetadata[] = [
	{ role: "user", content: "Fix the parser." },
];
const text = (value: string): ApiStreamChunk => ({
	type: "text",
	id: "summary",
	text: value,
});
const done: ApiStreamChunk = { type: "done", id: "summary", success: true };

function respond(chunks: ApiStreamChunk[]) {
	createMessageMock.mockImplementation(async function* () {
		yield* chunks;
	});
}

function toolExchange(
	call: ToolUseContent,
	result: ToolResultContent["content"],
): MessageWithMetadata[] {
	return [
		{ role: "assistant", content: [call] },
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: call.id,
					name: call.name,
					content: result,
				},
			],
		},
	];
}

beforeEach(() => {
	createHandlerMock.mockReset();
	createMessageMock.mockReset();
	createHandlerMock.mockResolvedValue({ createMessage: createMessageMock });
	respond([
		text(
			"Fix the parser. The failing case is isolated; implementation remains.",
		),
		done,
	]);
});

describe("summarizeConversation", () => {
	it("retains structured tool outcomes without sending nested image data", async () => {
		const output = toPersistedToolResultContent([
			{
				query: "test",
				result: "Parser failed",
				error: "Exit code 1",
				success: false,
			},
			{ type: "image", mediaType: "image/png", data: "synthetic-image-data" },
		]);
		const history = [
			...messages,
			...toolExchange(
				{
					type: "tool_use",
					id: "check",
					name: "run_commands",
					input: { commands: ["test"] },
				},
				output,
			),
		];
		const original = structuredClone(history);
		await summarizeConversation({ messages: history, config });
		const request = createMessageMock.mock.calls[0][1][0].content;
		expect(request).toContain("Parser failed");
		expect(request).toContain("Exit code 1");
		expect(request).toContain('"success":false');
		expect(request).not.toContain("synthetic-image-data");
		expect(history).toEqual(original);
	});

	it.each([
		2000, 2001, 100_000,
	])("budgets the full latest tool response (%s characters)", async (length) => {
		const verdict = " FINAL_VERDICT_FAILED";
		const result = "x".repeat(length - verdict.length) + verdict;
		const history = [
			...messages,
			...toolExchange(
				{ type: "tool_use", id: "check", name: "custom_check", input: {} },
				result,
			),
		];
		const summary = summarizeConversation({ messages: history, config });
		if (length === 100_000) {
			await expect(summary).rejects.toThrow("could not fit");
			expect(createHandlerMock).not.toHaveBeenCalled();
		} else {
			await summary;
			expect(createMessageMock.mock.calls[0][1][0].content).toContain(result);
		}
	});

	it("summarizes the current context including the latest turn without changing history or connection", async () => {
		const currentFile = `${"x".repeat(2100)} final constraint`;
		const history: MessageWithMetadata[] = [
			{ role: "user", content: "Obsolete history before compaction" },
			buildSummaryMessage({
				summary: "Goal: fix the parser. Preserve Unicode support.",
				fileOps: { readFiles: ["parser.ts"], modifiedFiles: [] },
				tokensBefore: 100,
				userRunSpan: 1,
			}),
			{
				role: "user",
				content: [
					{ type: "text", text: "Also handle empty input." },
					{ type: "file", path: "constraints.txt", content: currentFile },
					{
						type: "image",
						mediaType: "image/png",
						data: "historical-image-data",
					},
				],
			},
			{
				role: "assistant",
				content: "Empty-input test now passes; Unicode test still fails.",
			},
		];
		const connection = {
			...config,
			providerConfig: {
				...config,
				apiKey: "stale-token",
				thinking: true,
				maxOutputTokens: 100_000,
			},
		};
		const original = structuredClone({ history, connection });
		await expect(
			summarizeConversation({ messages: history, config: connection }),
		).resolves.toContain("Fix the parser.");
		const [, request, tools] = createMessageMock.mock.calls[0];
		expect(request[0].content).toContain("Preserve Unicode support");
		expect(request[0].content).toContain("Also handle empty input");
		expect(request[0].content).toContain(currentFile);
		expect(request[0].content).toContain("Unicode test still fails");
		expect(request[0].content).not.toContain("Obsolete history");
		expect(request[0].content).not.toContain("historical-image-data");
		expect(tools).toBeUndefined();
		expect(createHandlerMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "fresh-token",
				thinking: false,
				maxOutputTokens: 8192,
			}),
		);
		expect({ history, connection }).toEqual(original);
	});

	it("preserves prior constraints when a large completed tool call must be dropped", async () => {
		const prior = buildSummaryMessage({
			summary: "Preserve the legacy delimiter.",
			fileOps: { readFiles: [], modifiedFiles: [] },
			tokensBefore: 1000,
			userRunSpan: 1,
		});
		const history: MessageWithMetadata[] = [
			prior,
			{ role: "user", content: "Implement it." },
			...toolExchange(
				{
					type: "tool_use",
					id: "call",
					name: "apply_patch",
					input: { patch: "x".repeat(96_000) },
				},
				"Applied.",
			),
			{ role: "user", content: "Continue." },
			{ role: "assistant", content: "Tests remain." },
		];
		await summarizeConversation({ messages: history, config });
		expect(createMessageMock.mock.calls[0][1][0].content).toContain(
			"Preserve the legacy delimiter.",
		);
	});

	it.each([
		false,
		true,
	])("summarizes a long tool run (compacted: %s)", async (compacted) => {
		const start = compacted
			? buildSummaryMessage({
					summary: "Fix the parser; preserve Unicode support.",
					fileOps: { readFiles: [], modifiedFiles: [] },
					tokensBefore: 1000,
					userRunSpan: 1,
				})
			: messages[0];
		const history: MessageWithMetadata[] = [
			{ role: "user", content: `Old context: ${"x".repeat(120_000)}` },
			{ role: "assistant", content: "Old investigation. ".repeat(60) },
			start,
		];
		for (let index = 0; index < 100; index += 1) {
			history.push(
				...toolExchange(
					{
						type: "tool_use",
						id: `call-${index}`,
						name: "read_files",
						input: { path: "parser.ts" },
					},
					"x".repeat(1300),
				),
			);
		}
		const latestResult = `${"Investigation detail. ".repeat(40)} Unicode tests still fail.`;
		history.push({
			role: "assistant",
			content: latestResult,
		});
		const original = structuredClone(history);
		await summarizeConversation({ messages: history, config });
		const [systemPrompt, request] = createMessageMock.mock.calls[0];
		expect(
			estimateTokens(systemPrompt.length + request[0].content.length),
		).toBeLessThanOrEqual(32_000);
		expect(request[0].content).toContain("Fix the parser");
		expect(request[0].content).toContain(latestResult);
		expect(history).toEqual(original);
	});

	it.each([
		"active",
		"switched",
	])("uses the %s model's input and output limits", async (source) => {
		const current = {
			id: "current-model",
			contextWindow: 4096,
			maxTokens: 512,
		};
		await expect(
			summarizeConversation({
				messages: [{ role: "user", content: "x".repeat(6000) }],
				config: {
					...config,
					modelId: current.id,
					providerConfig: {
						...config,
						maxOutputTokens: 8192,
						modelInfo:
							source === "active"
								? current
								: { id: "old-model", contextWindow: 2048, maxTokens: 512 },
						knownModels:
							source === "switched" ? { [current.id]: current } : undefined,
					},
				},
			}),
		).resolves.toContain("Fix the parser.");
		expect(createHandlerMock).toHaveBeenCalledWith(
			expect.objectContaining({ modelInfo: current, maxOutputTokens: 512 }),
		);
	});

	it("accepts normal stream completion without an optional done chunk", async () => {
		respond([
			text("Complete continuation note."),
			{ type: "usage", id: "summary", inputTokens: 20, outputTokens: 10 },
		]);
		await expect(summarizeConversation({ messages, config })).resolves.toBe(
			"Complete continuation note.",
		);
	});

	it.each([
		"claude-code",
		"openai-codex-cli",
		"opencode",
		"dify",
	])("refuses %s before starting its native agent, including routed connections", async (providerId) => {
		for (const connection of [
			{ ...config, providerId },
			{
				...config,
				providerId: "custom-agent",
				providerConfig: {
					...config,
					providerId: "custom-agent",
					routingProviderId: providerId,
				},
			},
		]) {
			await expect(
				summarizeConversation({ messages, config: connection }),
			).rejects.toThrow("text-only model connection");
		}
		expect(createHandlerMock).not.toHaveBeenCalled();
	});

	it("rejects empty and unbudgetable context before requesting a summary", async () => {
		await expect(
			summarizeConversation({ messages: [], config }),
		).rejects.toThrow("no context");
		await expect(
			summarizeConversation({
				messages: [{ role: "user", content: "x".repeat(200_000) }],
				config,
			}),
		).rejects.toThrow("could not fit");
		await expect(
			summarizeConversation({
				messages: [
					...messages,
					{ role: "assistant", content: "x".repeat(200_000) },
				],
				config,
			}),
		).rejects.toThrow("could not fit");
		expect(createHandlerMock).not.toHaveBeenCalled();
	});

	it.each<{ name: string; chunks: ApiStreamChunk[] }>([
		{ name: "empty", chunks: [text("  "), done] },
		{
			name: "incomplete",
			chunks: [
				text("Partial summary"),
				{ ...done, incompleteReason: "max_tokens" },
			],
		},
		{
			name: "failed without an error message",
			chunks: [text("Partial summary"), { ...done, success: false }],
		},
		{
			name: "failed with an error",
			chunks: [{ ...done, success: false, error: "Provider failed" }],
		},
		{ name: "oversized", chunks: [text("x".repeat(12_001)), done] },
		{
			name: "tool call",
			chunks: [
				{
					type: "tool_calls",
					id: "summary",
					tool_call: { function: { name: "run_commands" } },
				},
				done,
			],
		},
	])("rejects $name output", async ({ chunks }) => {
		respond(chunks);
		await expect(summarizeConversation({ messages, config })).rejects.toThrow();
	});

	it("propagates cancellation to the provider and never accepts partial output", async () => {
		const controller = new AbortController();
		createHandlerMock.mockImplementation(async () => ({
			createMessage: async function* () {
				yield text("Partial summary");
				controller.abort();
				yield done;
			},
		}));
		await expect(
			summarizeConversation({ messages, config, signal: controller.signal }),
		).rejects.toThrow();
		expect(createHandlerMock.mock.calls[0][0].abortSignal?.aborted).toBe(true);
		createHandlerMock.mockClear();
		await expect(
			summarizeConversation({ messages, config, signal: controller.signal }),
		).rejects.toThrow();
		expect(createHandlerMock).not.toHaveBeenCalled();
	});
});
