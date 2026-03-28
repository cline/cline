import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHandler } from "../index";
import type { ApiStreamChunk } from "../types";
import { AskSageHandler } from "./asksage";

vi.mock("../runtime/auth", async () => {
	const actual = await vi.importActual("../runtime/auth");
	return {
		...(actual as object),
		resolveApiKeyForProvider: (_providerId: string, explicitApiKey?: string) =>
			explicitApiKey?.trim() || undefined,
	};
});

describe("AskSageHandler", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("formats request payload and emits text/usage/done chunks", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				message: "final answer",
				tool_responses: [{ name: "search", ok: true }],
				usage: {
					model_tokens: {
						prompt_tokens: 123,
						completion_tokens: 45,
						total_tokens: 168,
					},
					asksage_tokens: 17.5,
				},
			}),
		}));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const handler = new AskSageHandler({
			providerId: "asksage",
			modelId: "gpt-4o",
			apiKey: "ask-key",
		});

		const chunks: ApiStreamChunk[] = [];
		for await (const chunk of handler.createMessage("system prompt", [
			{ role: "user", content: [{ type: "text", text: "hello" }] },
			{ role: "assistant", content: "hi there" },
		])) {
			chunks.push(chunk);
		}

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit & { body?: string },
		];
		expect(url).toBe("https://api.asksage.ai/server/query");
		expect(init.method).toBe("POST");
		expect(init.headers).toMatchObject({
			"Content-Type": "application/json",
			"x-access-tokens": "ask-key",
		});
		expect(JSON.parse(init.body ?? "{}")).toEqual({
			system_prompt: "system prompt",
			message: [
				{ user: "me", message: "hello" },
				{ user: "gpt", message: "hi there" },
			],
			model: "gpt-4o",
			dataset: "none",
			usage: true,
		});

		expect(chunks.map((chunk) => chunk.type)).toEqual([
			"text",
			"text",
			"usage",
			"done",
		]);
	});

	it("is used by createHandler for built-in asksage provider id", () => {
		const handler = createHandler({
			providerId: "asksage",
			modelId: "gpt-4o",
			apiKey: "ask-key",
		});
		expect(handler).toBeInstanceOf(AskSageHandler);
	});

	it("throws when API key is missing", async () => {
		const handler = new AskSageHandler({
			providerId: "asksage",
			modelId: "gpt-4o",
		});

		await expect(async () => {
			for await (const _chunk of handler.createMessage("system", [])) {
				// noop
			}
		}).rejects.toThrow("AskSage API key is required");
	});
});
