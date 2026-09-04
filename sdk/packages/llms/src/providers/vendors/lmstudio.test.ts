import { describe, expect, it, vi } from "vitest";
import { fetchLmStudioModels, toLmStudioRestModelsUrl } from "./lmstudio";

describe("LM Studio model discovery", () => {
	it.each([
		["http://localhost:1234/v1/", "http://localhost:1234/api/v1/models"],
		[
			"https://example.com/lmstudio/v1/models",
			"https://example.com/lmstudio/api/v1/models",
		],
	])("preserves the configured base path for %s", (baseUrl, expected) => {
		expect(toLmStudioRestModelsUrl(baseUrl)).toBe(expected);
	});

	it("returns loaded and maximum context windows separately", async () => {
		const fetchModels = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						models: [
							{
								key: "qwen",
								type: "llm",
								max_context_length: 183_296,
								loaded_instances: [
									{ id: "qwen", config: { context_length: 40_000 } },
								],
							},
						],
					}),
				),
		);

		await expect(
			fetchLmStudioModels("http://localhost:1234", fetchModels),
		).resolves.toEqual([
			{
				id: "qwen",
				type: "llm",
				maxContextWindow: 183_296,
				loadedContextWindow: 40_000,
			},
		]);
		expect(fetchModels).toHaveBeenCalledWith(
			"http://localhost:1234/api/v1/models",
		);
	});
});
