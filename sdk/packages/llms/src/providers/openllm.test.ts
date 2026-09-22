import { describe, expect, it } from "vitest";
import { BUILTIN_PROVIDER_COLLECTIONS_BY_ID } from "./builtins";
import { isBuiltInProviderId } from "./ids";
import {
	buildOpenLlmFallbackModels,
	parseOpenLlmModels,
	resolveOpenLlmModelsUrl,
	toOpenLlmModelInfo,
} from "./openllm";

describe("OpenLLM provider registration", () => {
	it("is a built-in openai-compatible chat provider on the local daemon", () => {
		expect(isBuiltInProviderId("openllm")).toBe(true);
		const collection = BUILTIN_PROVIDER_COLLECTIONS_BY_ID.openllm;
		expect(collection?.provider).toEqual(
			expect.objectContaining({
				name: "OpenLLM",
				baseUrl: "http://127.0.0.1:8787/v1",
				protocol: "openai-chat",
				client: "openai-compatible",
			}),
		);
		expect(collection?.provider.defaultModelId).toBe("ultra");
		expect(Object.keys(collection?.models ?? {})).toEqual([
			"ultra",
			"plus",
			"lite",
		]);
	});
});

describe("toOpenLlmModelInfo", () => {
	it("maps limits and typed capabilities and keeps slash ids verbatim", () => {
		expect(
			toOpenLlmModelInfo({
				id: "chatgpt/gpt-5.5",
				display_name: "GPT-5.5",
				capabilities: ["chat", "tools", "vision", "reasoning", "streaming"],
				context_window: 272_000,
				max_input_tokens: 272_000,
				max_output_tokens: 128_000,
			}),
		).toEqual({
			id: "chatgpt/gpt-5.5",
			name: "GPT-5.5",
			status: "active",
			contextWindow: 272_000,
			maxInputTokens: 272_000,
			maxTokens: 128_000,
			capabilities: ["streaming", "tools", "images", "reasoning"],
			modalities: { input: ["text", "image"], output: ["text"] },
		});
	});

	it("does not infer capabilities from names", () => {
		const info = toOpenLlmModelInfo({
			id: "claude-opus-vision-reasoner",
			capabilities: ["chat"],
		});
		expect(info?.capabilities).toEqual(["streaming"]);
		expect(info?.contextWindow).toBeUndefined();
	});

	it("uses meta.n_ctx when no other context budget is present", () => {
		expect(
			toOpenLlmModelInfo({
				id: "m",
				capabilities: ["chat"],
				meta: { n_ctx: 32_768 },
			})?.contextWindow,
		).toBe(32_768);
	});

	it.each([
		["embedding"],
		["transcription"],
		["speech"],
		["image_generation", "image_editing"],
		["video_generation"],
		["realtime"],
	])("filters media-only card %j", (...capabilities) => {
		expect(toOpenLlmModelInfo({ id: "x", capabilities })).toBeUndefined();
	});

	it("keeps chat models that also advertise media and cards without capabilities", () => {
		expect(
			toOpenLlmModelInfo({ id: "omni", capabilities: ["chat", "speech"] }),
		).toBeDefined();
		expect(toOpenLlmModelInfo({ id: "custom-alias" })).toEqual({
			id: "custom-alias",
			name: "custom-alias",
			status: "active",
		});
	});

	it("ignores invalid limits and blank ids", () => {
		expect(toOpenLlmModelInfo({ id: "  " })).toBeUndefined();
		const info = toOpenLlmModelInfo({
			id: "m",
			context_window: -1,
			max_output_tokens: "big",
		});
		expect(info?.contextWindow).toBeUndefined();
		expect(info?.maxTokens).toBeUndefined();
	});
});

describe("parseOpenLlmModels", () => {
	it("skips malformed entries", () => {
		expect(
			Object.keys(
				parseOpenLlmModels({
					data: [null, "x", { id: "ultra", capabilities: ["chat"] }],
				}),
			),
		).toEqual(["ultra"]);
	});

	it("throws on a payload without a data array", () => {
		expect(() => parseOpenLlmModels({ models: [] })).toThrow(/data array/);
		expect(() => parseOpenLlmModels(null)).toThrow(/data array/);
	});
});

describe("fallback and URLs", () => {
	it("offline aliases claim no limits or capabilities", () => {
		expect(buildOpenLlmFallbackModels()).toEqual({
			ultra: { id: "ultra", name: "ultra" },
			plus: { id: "plus", name: "plus" },
			lite: { id: "lite", name: "lite" },
		});
	});

	it("resolves the models URL under the configured prefix", () => {
		expect(resolveOpenLlmModelsUrl(undefined)).toBe(
			"http://127.0.0.1:8787/v1/models",
		);
		expect(resolveOpenLlmModelsUrl("https://gw.example.com/openllm/v1/")).toBe(
			"https://gw.example.com/openllm/v1/models",
		);
	});
});
