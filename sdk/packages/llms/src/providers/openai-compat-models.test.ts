import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchOpenAICompatibleModels,
	getOpenAICompatibleModelFromCache,
	normalizeModelCatalog,
	resetOpenAICompatibleModelCacheForTests,
	resolveOpenAICompatibleContextWindow,
} from "./openai-compat-models";

const VLLM_MODEL_ID = "sakamakismile/Huihui-Qwen3.8-27B-abliterated-NVFP4";

function vllmModelsResponse(maxModelLen: number): Response {
	return new Response(
		JSON.stringify({
			object: "list",
			data: [
				{
					id: VLLM_MODEL_ID,
					object: "model",
					created: 1_724_000_000,
					max_model_len: maxModelLen,
					owned_by: "vllm",
				},
			],
		}),
		{
			status: 200,
			headers: { "Content-Type": "application/json" },
		},
	);
}

describe("openai-compat-models", () => {
	beforeEach(() => {
		resetOpenAICompatibleModelCacheForTests();
	});

	it("normalizes vLLM models payloads into context windows", () => {
		expect(
			normalizeModelCatalog({
				object: "list",
				data: [{ id: "gpt-4o", max_model_len: 128_000 }],
			}),
		).toEqual([{ id: "gpt-4o", contextWindow: 128_000 }]);
	});

	it("ignores entries without a usable id or numeric max_model_len", () => {
		expect(
			normalizeModelCatalog({
				object: "list",
				data: [
					{ id: "gpt-4o" },
					{ name: "no-id" },
					{ id: "", max_model_len: 8192 },
					{ id: "litellm-model", max_model_len: "not-a-number" },
				],
			}),
		).toEqual([
			{ id: "gpt-4o", contextWindow: undefined },
			{ id: "litellm-model", contextWindow: undefined },
		]);
	});

	it("fetches <baseUrl>/models and caches the result", async () => {
		const fetchMock = vi.fn().mockResolvedValue(vllmModelsResponse(8192));
		const models = await fetchOpenAICompatibleModels(
			"http://127.0.0.1:8000/v1",
			fetchMock as unknown as typeof fetch,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toBe(
			"http://127.0.0.1:8000/v1/models",
		);
		expect(models).toEqual([{ id: VLLM_MODEL_ID, contextWindow: 8192 }]);
		expect(
			getOpenAICompatibleModelFromCache(
				"http://127.0.0.1:8000/v1",
				VLLM_MODEL_ID,
			),
		).toEqual({ id: VLLM_MODEL_ID, contextWindow: 8192 });
	});

	it("dedupes concurrent fetches for the same base URL", async () => {
		let resolveFetch: (response: Response) => void;
		const pending = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});
		const fetchMock = vi.fn().mockImplementation(() => pending);
		const first = fetchOpenAICompatibleModels(
			"http://127.0.0.1:8000/v1",
			fetchMock as unknown as typeof fetch,
		);
		const second = fetchOpenAICompatibleModels(
			"http://127.0.0.1:8000/v1",
			fetchMock as unknown as typeof fetch,
		);
		resolveFetch!(vllmModelsResponse(32_768));
		expect(await first).toEqual([{ id: VLLM_MODEL_ID, contextWindow: 32_768 }]);
		expect(await second).toEqual([
			{ id: VLLM_MODEL_ID, contextWindow: 32_768 },
		]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("serves cached catalogs within the TTL without refetching", async () => {
		const fetchMock = vi.fn().mockResolvedValue(vllmModelsResponse(8192));
		expect(
			await resolveOpenAICompatibleContextWindow(
				"http://127.0.0.1:8000/v1",
				VLLM_MODEL_ID,
				fetchMock as unknown as typeof fetch,
			),
		).toBe(8192);
		expect(
			await resolveOpenAICompatibleContextWindow(
				"http://127.0.0.1:8000/v1/",
				VLLM_MODEL_ID,
				fetchMock as unknown as typeof fetch,
			),
		).toBe(8192);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("returns undefined for unknown model ids", async () => {
		const fetchMock = vi.fn().mockResolvedValue(vllmModelsResponse(8192));
		expect(
			await resolveOpenAICompatibleContextWindow(
				"http://127.0.0.1:8000/v1",
				"some-other-model",
				fetchMock as unknown as typeof fetch,
			),
		).toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("returns undefined when the endpoint is unreachable", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		expect(
			await resolveOpenAICompatibleContextWindow(
				"http://127.0.0.1:8000/v1",
				VLLM_MODEL_ID,
				fetchMock as unknown as typeof fetch,
			),
		).toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
