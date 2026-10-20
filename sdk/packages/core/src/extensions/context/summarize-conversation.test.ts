import type { ApiStreamChunk, ProviderConfig } from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
	it("summarizes the current context including the latest turn without changing history or connection", async () => {
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
		const [systemPrompt, request, tools] = createMessageMock.mock.calls[0];
		expect(systemPrompt).toContain("verification performed or still missing");
		expect(request[0].content).toContain("Preserve Unicode support");
		expect(request[0].content).toContain("Also handle empty input");
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

	it("bounds large input while retaining the latest instruction and result", async () => {
		const history: MessageWithMetadata[] = [
			...messages,
			{ role: "assistant", content: "Old investigation. ".repeat(50_000) },
			{ role: "user", content: "Now fix empty input." },
			{
				role: "assistant",
				content: "Latest result: empty input is fixed; tests remain.",
			},
		];
		await summarizeConversation({ messages: history, config });
		const [systemPrompt, request] = createMessageMock.mock.calls[0];
		expect(
			estimateTokens(systemPrompt.length + request[0].content.length),
		).toBeLessThanOrEqual(32_000);
		expect(request[0].content).toContain("Now fix empty input");
		expect(request[0].content).toContain("Latest result");
		expect(history[1].content).toBe("Old investigation. ".repeat(50_000));
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
		expect(createHandlerMock).not.toHaveBeenCalled();
	});

	it("reserves the model's smaller output allowance within its context window", async () => {
		await summarizeConversation({
			messages,
			config: {
				...config,
				providerConfig: {
					...config,
					maxOutputTokens: 8192,
					modelInfo: {
						id: config.modelId,
						contextWindow: 4096,
						maxTokens: 512,
					},
				},
			},
		});
		expect(createHandlerMock).toHaveBeenCalledWith(
			expect.objectContaining({ maxOutputTokens: 512 }),
		);
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
		{
			name: "stream ended without completion",
			chunks: [text("Partial summary")],
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
		createHandlerMock.mockImplementation(async (provider: ProviderConfig) => ({
			createMessage: async function* () {
				yield text("Partial summary");
				controller.abort();
				expect(provider.abortSignal?.aborted).toBe(true);
				yield done;
			},
		}));
		await expect(
			summarizeConversation({ messages, config, signal: controller.signal }),
		).rejects.toThrow();
		createHandlerMock.mockClear();
		await expect(
			summarizeConversation({ messages, config, signal: controller.signal }),
		).rejects.toThrow();
		expect(createHandlerMock).not.toHaveBeenCalled();
	});
});
