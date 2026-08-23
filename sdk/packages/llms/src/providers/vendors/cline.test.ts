import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { composeAiSdkProviderOptions } from "../routing/provider-options";
import { createCline, createClineProviderModule } from "./cline";

describe("createCline", () => {
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		fetchMock.mockReset();
	});

	it("exposes web search as a provider-defined client tool", () => {
		const cline = createCline({
			apiKey: "test-key",
			baseURL: "https://api.cline.bot/api/v1",
			fetch: fetchMock,
		});

		const tool = cline.tools.webSearch();

		expect(tool.type).toBe("provider");
		expect(tool.id).toBe("cline.web_search");
		expect(tool.execute).toBeTypeOf("function");
	});

	it("executes web search through the Cline search endpoint", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					data: {
						results: [{ title: "Cline", url: "https://cline.bot" }],
					},
				}),
				{ status: 200 },
			),
		);
		const cline = createCline({
			apiKey: "test-key",
			baseURL: "https://api.cline.bot/api/v1/",
			fetch: fetchMock,
		});
		const tool = cline.tools.webSearch({
			allowedDomains: [" cline.bot ", ""],
		});

		const result = await tool.execute?.(
			{ query: "latest Cline release" },
			{
				toolCallId: "call-1",
				messages: [],
			},
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.cline.bot/api/v1/search/websearch",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer test-key",
					"Content-Type": "application/json",
				}),
				body: JSON.stringify({
					query: "latest Cline release",
					allowed_domains: ["cline.bot"],
				}),
			}),
		);
		expect(result).toEqual({
			results: [{ title: "Cline", url: "https://cline.bot" }],
		});
	});

	it("rejects mutually exclusive domain filters before making a request", async () => {
		const cline = createCline({
			baseURL: "https://api.cline.bot/api/v1",
			fetch: fetchMock,
		});
		const tool = cline.tools.webSearch({
			allowedDomains: ["cline.bot"],
			blockedDomains: ["example.com"],
		});

		await expect(
			tool.execute?.(
				{ query: "Cline" },
				{ toolCallId: "call-1", messages: [] },
			),
		).rejects.toThrow("allowed domains or blocked domains");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		"openai/gpt-5.4",
		"openai/o3-mini",
	])("sends max_completion_tokens for reasoning model %s", async (modelId) => {
		fetchMock.mockResolvedValue(jsonCompletionResponse(modelId));
		const cline = createCline({
			apiKey: "test-key",
			baseURL: "https://api.cline.bot/api/v1",
			fetch: fetchMock,
		});

		await cline(modelId).doGenerate({
			prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			maxOutputTokens: 8_192,
		});

		const body = capturedRequestBody(fetchMock);
		expect(body).toMatchObject({
			model: modelId,
			max_completion_tokens: 8_192,
		});
		expect(body).not.toHaveProperty("max_tokens");
	});

	it.each([
		"cline",
		"cline-pass",
	])("routes composed %s gateway reasoning onto the request body", async (providerId) => {
		const modelId = "anthropic/claude-sonnet-4-5";
		fetchMock.mockResolvedValue(jsonCompletionResponse(modelId));
		const module = await createClineProviderModule(
			{
				providerId,
				apiKey: "test-key",
				baseUrl: "https://api.cline.bot/api/v1",
				fetch: fetchMock,
			} as unknown as GatewayResolvedProviderConfig,
			{ provider: { id: providerId } } as never,
		);
		const model = module.operations.language(modelId) as {
			doGenerate: (options: unknown) => Promise<unknown>;
		};

		// Cross-layer contract: option routing must emit gateway reasoning into
		// the providerOptions bucket the shared "cline" AI SDK provider reads.
		// Both gateway ids ("cline" and "cline-pass") hit the same Cline API
		// through this provider, so their options key to the "cline" bucket.
		// Uses an explicit budget because effort-based reasoning is portable
		// and travels via the AI SDK top-level option, not provider options.
		const request: GatewayStreamRequest = {
			providerId,
			modelId,
			messages: [
				{
					id: "msg-1",
					role: "user",
					content: [{ type: "text", text: "hi" }],
					createdAt: 0,
				},
			],
			reasoning: { enabled: true, budgetTokens: 2048 },
		};
		const context = {
			provider: {
				id: providerId,
				name: providerId,
				defaultModelId: modelId,
				models: [],
				metadata: {
					routing: {
						reasoning: {
							format: "anthropic-thinking",
							routes: [{ matcher: "anthropic-compatible" }],
						},
					},
				},
			},
			model: {
				id: modelId,
				name: modelId,
				providerId,
				metadata: { family: "claude-sonnet" },
			},
			config: { providerId },
		} as GatewayProviderContext;

		await model.doGenerate({
			prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			providerOptions: composeAiSdkProviderOptions(request, context),
		});

		const body = capturedRequestBody(fetchMock);
		expect(body.reasoning).toEqual({ enabled: true, max_tokens: 2048 });
	});

	it("keeps max_tokens for non-reasoning models", async () => {
		const modelId = "anthropic/claude-sonnet-4.6";
		fetchMock.mockResolvedValue(jsonCompletionResponse(modelId));
		const cline = createCline({
			apiKey: "test-key",
			baseURL: "https://api.cline.bot/api/v1",
			fetch: fetchMock,
		});

		await cline(modelId).doGenerate({
			prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			maxOutputTokens: 8_192,
		});

		const body = capturedRequestBody(fetchMock);
		expect(body).toMatchObject({ model: modelId, max_tokens: 8_192 });
		expect(body).not.toHaveProperty("max_completion_tokens");
	});
});

function capturedRequestBody(
	fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
): Record<string, unknown> {
	const init = fetchMock.mock.calls[0]?.[1];
	return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function jsonCompletionResponse(modelId: string): Response {
	return new Response(
		JSON.stringify({
			id: "chatcmpl-test",
			created: 0,
			model: modelId,
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: "OK" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}
