import { describe, expect, it } from "vitest";
import { mapDotHooshModels, pickDotHooshDefaultModel } from "./dothoosh-models";

describe("mapDotHooshModels", () => {
	it("converts per-token USD strings to per-million-token prices", () => {
		const models = mapDotHooshModels({
			data: [
				{
					id: "gpt-5",
					context_length: 400_000,
					max_output_tokens: 50_000,
					pricing: {
						prompt: "0.00000125",
						completion: "0.00001",
						input_cache_read: "0.000000125",
						input_cache_write: "0.0000015625",
						request: "0",
					},
				},
			],
		});
		expect(models["gpt-5"]?.pricing).toEqual({
			input: 1.25,
			output: 10,
			cacheRead: 0.125,
			cacheWrite: 1.5625,
		});
		expect(models["gpt-5"]?.capabilities).toContain("prompt-cache");
	});

	it("maps limits, status and name", () => {
		const models = mapDotHooshModels({
			data: [
				{
					id: "deepseek-v4",
					name: "DeepSeek V4",
					context_length: 128_000,
					max_output_tokens: 16_000,
				},
			],
		});
		expect(models["deepseek-v4"]).toEqual(
			expect.objectContaining({
				id: "deepseek-v4",
				name: "DeepSeek V4",
				contextWindow: 128_000,
				maxInputTokens: 128_000,
				maxTokens: 16_000,
				status: "active",
			}),
		);
	});

	it("falls back to top_provider limits and context_window", () => {
		const models = mapDotHooshModels({
			data: [
				{
					id: "a",
					context_window: 64_000,
					top_provider: { max_completion_tokens: 8_000 },
				},
				{ id: "b", top_provider: { context_length: 32_000 } },
			],
		});
		expect(models.a?.contextWindow).toBe(64_000);
		expect(models.a?.maxTokens).toBe(8_000);
		expect(models.b?.contextWindow).toBe(32_000);
	});

	it("derives tools, reasoning and images from the listing, not constants", () => {
		const models = mapDotHooshModels({
			data: [
				{
					id: "full",
					supported_parameters: ["tools", "reasoning", "max_tokens"],
					architecture: { input_modalities: ["text", "image"] },
				},
				{ id: "bare", supported_parameters: ["max_tokens"] },
			],
		});
		expect(models.full?.capabilities).toEqual(
			expect.arrayContaining(["streaming", "tools", "reasoning", "images"]),
		);
		expect(models.bare?.capabilities).toEqual(["streaming"]);
		expect(models.bare?.pricing).toBeUndefined();
	});

	it("prefers the Responses protocol for every model whose listing includes it", () => {
		const models = mapDotHooshModels({
			data: [
				{ id: "resp", protocols: [{ protocol: "openai-responses" }] },
				{
					id: "both",
					protocols: [
						{ protocol: "openai-chat-completions" },
						{ protocol: "openai-responses" },
					],
				},
				{ id: "legacy", protocols: ["openai-responses"] },
				{ id: "chat", protocols: [{ protocol: "openai-chat-completions" }] },
				{
					id: "dual",
					protocols: [
						{ protocol: "anthropic-messages" },
						{ protocol: "openai-chat-completions" },
					],
				},
			],
		});
		expect(models.resp?.metadata?.apiProtocol).toBe("openai-responses");
		expect(models.legacy?.metadata?.apiProtocol).toBe("openai-responses");
		expect(models.both?.metadata?.apiProtocol).toBe("openai-responses");
		expect(models.chat?.metadata).toBeUndefined();
		// Chat-capable models that are also on the Anthropic route stay on chat.
		expect(models.dual?.metadata).toBeUndefined();
	});

	it("maps the listing lifecycle status instead of assuming active", () => {
		const models = mapDotHooshModels({
			data: [
				{ id: "ok", status: "active" },
				{ id: "lim", status: "limited" },
				{ id: "deg", status: "degraded" },
				{ id: "old", status: "deprecated" },
				{
					id: "going",
					status: "removal-scheduled",
					removal_at: "2026-12-01T00:00:00Z",
				},
				{ id: "gone", status: "unavailable" },
				{ id: "unset" },
			],
		});
		expect(models.ok?.status).toBe("active");
		expect(models.lim?.status).toBe("active");
		expect(models.deg?.status).toBe("active");
		expect(models.old?.status).toBe("deprecated");
		expect(models.going?.status).toBe("deprecated");
		expect(models.going?.deprecationDate).toBe("2026-12-01T00:00:00Z");
		expect(models.gone).toBeUndefined();
		expect(models.unset?.status).toBe("active");
	});

	it("maps response_format and structured_outputs to structured output", () => {
		const models = mapDotHooshModels({
			data: [
				{ id: "a", supported_parameters: ["response_format"] },
				{ id: "b", supported_parameters: ["structured_outputs"] },
				{ id: "c", supported_parameters: ["max_tokens"] },
			],
		});
		expect(models.a?.capabilities).toContain("structured_output");
		expect(models.b?.capabilities).toContain("structured_output");
		expect(models.c?.capabilities).not.toContain("structured_output");
	});

	it("tolerates fields of the wrong shape without throwing", () => {
		expect(mapDotHooshModels({ data: { a: 1 } } as never)).toEqual({});
		expect(mapDotHooshModels({ data: "abc" } as never)).toEqual({});
		const models = mapDotHooshModels({
			data: [
				{
					id: "w",
					supported_parameters: "tools",
					architecture: { input_modalities: "image" },
					protocols: "openai-responses",
				},
			],
		} as never);
		expect(models.w?.capabilities).toEqual(["streaming"]);
		expect(models.w?.metadata).toBeUndefined();
	});

	it("keeps ids such as __proto__ and constructor as plain own entries", () => {
		const models = mapDotHooshModels({
			data: [{ id: "__proto__" }, { id: "constructor" }, { id: "toString" }],
		});
		expect(Object.getPrototypeOf(models)).toBe(Object.prototype);
		expect(Object.keys(models).sort()).toEqual([
			"__proto__",
			"constructor",
			"toString",
		]);
		expect(Object.hasOwn(models, "__proto__")).toBe(true);
		expect(Object.hasOwn({}, "polluted")).toBe(false);
	});

	it("skips entries without an id and tolerates malformed payloads", () => {
		expect(
			mapDotHooshModels({ data: [{ id: " " }, {}, null] as never }),
		).toEqual({});
		expect(mapDotHooshModels(undefined)).toEqual({});
		expect(mapDotHooshModels({})).toEqual({});
	});

	it("ignores non-numeric and negative prices", () => {
		const models = mapDotHooshModels({
			data: [{ id: "x", pricing: { prompt: "abc", completion: "-1" } }],
		});
		expect(models.x?.pricing).toBeUndefined();
	});
});

describe("pickDotHooshDefaultModel", () => {
	const models = mapDotHooshModels({
		data: [
			{
				id: "gone-soon",
				status: "deprecated",
				supported_parameters: ["tools"],
			},
			{ id: "no-tools", supported_parameters: ["max_tokens"] },
			{ id: "first-good", supported_parameters: ["tools"] },
			{ id: "second-good", supported_parameters: ["tools"] },
		],
	});

	it("takes the first active model that supports tools, in listing order", () => {
		expect(pickDotHooshDefaultModel(models)).toBe("first-good");
	});

	it("falls back to the first active model, then to the first model", () => {
		expect(
			pickDotHooshDefaultModel(
				mapDotHooshModels({
					data: [{ id: "old", status: "deprecated" }, { id: "plain" }],
				}),
			),
		).toBe("plain");
		expect(
			pickDotHooshDefaultModel(
				mapDotHooshModels({ data: [{ id: "old", status: "deprecated" }] }),
			),
		).toBe("old");
	});

	it("returns undefined for an empty catalog", () => {
		expect(pickDotHooshDefaultModel({})).toBeUndefined();
	});
});
