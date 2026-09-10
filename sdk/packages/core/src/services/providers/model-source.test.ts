import { describe, expect, it } from "vitest";

import {
	extractModelEntriesFromPayload,
	extractModelIdsFromPayload,
	resolveModelsSourceUrl,
} from "./model-source";

describe("extractModelEntriesFromPayload", () => {
	it("keeps LM Studio's per-model context length from an OpenAI-shaped payload", () => {
		const payload = {
			object: "list",
			data: [
				{
					id: "qwen-3.8-27b",
					object: "model",
					owned_by: "organization",
					max_context_length: 200_000,
				},
				{ id: "gemma-4-26b", object: "model", max_context_length: 131_072 },
			],
		};

		expect(extractModelEntriesFromPayload(payload, "lmstudio")).toEqual([
			{ id: "qwen-3.8-27b", contextWindow: 200_000 },
			{ id: "gemma-4-26b", contextWindow: 131_072 },
		]);
	});

	it("recognizes the alternative context-length key spellings", () => {
		const payload = {
			data: [
				{ id: "a", max_model_len: 8192 },
				{ id: "b", context_length: 4096 },
			],
		};

		expect(extractModelEntriesFromPayload(payload, "lmstudio")).toEqual([
			{ id: "a", contextWindow: 8192 },
			{ id: "b", contextWindow: 4096 },
		]);
	});

	it("ignores non-positive or non-numeric context lengths", () => {
		const payload = {
			data: [
				{ id: "a", max_context_length: 0 },
				{ id: "b", max_context_length: "many" },
				{ id: "c", max_context_length: Number.NaN },
			],
		};

		expect(extractModelEntriesFromPayload(payload, "lmstudio")).toEqual([
			{ id: "a" },
			{ id: "b" },
			{ id: "c" },
		]);
	});

	it("falls back to the name/model fields like the id-only extractor", () => {
		const payload = { models: [{ name: "local-llama" }, { model: "other" }] };

		expect(extractModelEntriesFromPayload(payload, "ollama")).toEqual([
			{ id: "local-llama" },
			{ id: "other" },
		]);
	});

	it("handles Ollama's /api/tags shape with per-model context", () => {
		const payload = {
			models: [
				{ name: "llama3.2", context_length: 131_072 },
				{ name: "nemo" },
			],
		};

		expect(extractModelEntriesFromPayload(payload, "ollama")).toEqual([
			{ id: "llama3.2", contextWindow: 131_072 },
			{ id: "nemo" },
		]);
	});

	it("keeps the id-only behavior for plain string arrays and object maps", () => {
		expect(extractModelEntriesFromPayload(["a", "b"], "lmstudio")).toEqual([
			{ id: "a" },
			{ id: "b" },
		]);
		expect(
			extractModelEntriesFromPayload({ models: { first: {}, second: {} } }, "lmstudio"),
		).toEqual([{ id: "first" }, { id: "second" }]);
	});

	it("extractModelIdsFromPayload matches the entry ids", () => {
		const payload = {
			data: [{ id: "x", max_context_length: 8192 }],
		};

		expect(extractModelIdsFromPayload(payload, "lmstudio")).toEqual(["x"]);
	});
});

describe("resolveModelsSourceUrl", () => {
	it("replaces the default base path with the configured one", () => {
		expect(
			resolveModelsSourceUrl(
				"http://remote-host:1234/v1",
				"http://localhost:1234/v1",
				"http://localhost:1234/v1/models",
			),
		).toBe("http://remote-host:1234/v1/models");
	});
});
